import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prefStore } from '../test/preferences-mock'
import type { QueuedScan } from './queue'
import type { ScanResult } from './types'

vi.mock('@capacitor/preferences', async () => await import('../test/preferences-mock'))

class FakeAuthError extends Error {}
const checkinScan =
  vi.fn<
    (eventId: string, qr: string, clientScanId?: string) => Promise<ScanResult>
  >()

vi.mock('./api', () => ({
  AuthError: FakeAuthError,
  checkinScan: (eventId: string, qr: string, clientScanId?: string) =>
    checkinScan(eventId, qr, clientScanId),
  fetchOfflineBundlePage: vi.fn(),
}))

const { enqueueScan, readQueue } = await import('./queue')
const { runSync, refreshSyncState, dismissConflicts, getSyncState } =
  await import('./sync')

const EVENT = '11111111-1111-1111-1111-111111111111'

const result = (r: ScanResult['result']): ScanResult => ({
  result: r,
  holderName: 'Jana Nováková',
  ticketType: 'VIP',
  usedAt: '2026-07-20T19:00:00.000Z',
  ref: 'AAAAAAAA',
  seat: null,
})

async function queueScans(n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    const entry: QueuedScan = {
      id: `local-${i}`,
      eventId: EVENT,
      ticketId: `ticket-${i}`,
      ref: `REF${i}`,
      holderName: `Hosť ${i}`,
      qr: `TIK.ticket-${i}.sig`,
      scannedAt: `2026-07-20T19:0${i}:00.000Z`,
      deviceLabel: 'Ticketio Scan · TEST01',
    }
    await enqueueScan(entry)
  }
}

describe('runSync', () => {
  beforeEach(async () => {
    prefStore.clear()
    checkinScan.mockReset()
    await refreshSyncState()
  })

  it('sends every queued admission and empties the queue', async () => {
    await queueScans(3)
    checkinScan.mockResolvedValue(result('ok'))

    const state = await runSync()

    expect(checkinScan).toHaveBeenCalledTimes(3)
    expect(await readQueue()).toHaveLength(0)
    expect(state.pending).toBe(0)
    expect(state.conflicts).toHaveLength(0)
    expect(state.error).toBeNull()
  })

  it('replays each admission under its own scan id (server-side dedup)', async () => {
    await queueScans(2)
    checkinScan.mockResolvedValue(result('ok'))

    await runSync()

    expect(checkinScan).toHaveBeenNthCalledWith(
      1,
      EVENT,
      'TIK.ticket-1.sig',
      'local-1',
    )
    expect(checkinScan).toHaveBeenNthCalledWith(
      2,
      EVENT,
      'TIK.ticket-2.sig',
      'local-2',
    )
  })

  it('a re-entry is an accepted admission, not a conflict', async () => {
    await queueScans(1)
    checkinScan.mockResolvedValue(result('reentry'))

    const state = await runSync()
    expect(state.conflicts).toHaveLength(0)
    expect(await readQueue()).toHaveLength(0)
  })

  it('reports a ticket used elsewhere as a conflict, naming it', async () => {
    await queueScans(3)
    checkinScan
      .mockResolvedValueOnce(result('ok'))
      .mockResolvedValueOnce(result('already_used'))
      .mockResolvedValueOnce(result('ok'))

    const state = await runSync()

    // The server answered for all three, so none stay queued…
    expect(await readQueue()).toHaveLength(0)
    // …but the refused one is reported, not swallowed.
    expect(state.conflicts).toHaveLength(1)
    expect(state.conflicts[0]).toMatchObject({
      ticketId: 'ticket-2',
      ref: 'REF2',
      holderName: 'Hosť 2',
      result: 'already_used',
      scannedAt: '2026-07-20T19:02:00.000Z',
    })
  })

  it('conflicts survive an app restart and clear only when acknowledged', async () => {
    await queueScans(1)
    checkinScan.mockResolvedValue(result('already_used'))
    await runSync()

    vi.resetModules()
    const fresh = await import('./sync')
    expect(fresh.getSyncState().conflicts).toHaveLength(0) // not loaded yet
    await fresh.refreshSyncState()
    expect(fresh.getSyncState().conflicts).toHaveLength(1)

    await fresh.dismissConflicts()
    expect(fresh.getSyncState().conflicts).toHaveLength(0)
    await fresh.refreshSyncState()
    expect(fresh.getSyncState().conflicts).toHaveLength(0)
  })

  it('a connection lost mid-sync keeps the unsent rest and resumes later', async () => {
    await queueScans(3)
    checkinScan
      .mockResolvedValueOnce(result('ok'))
      .mockRejectedValueOnce(new Error('Network request failed'))

    const first = await runSync()

    // Only the acknowledged entry left the queue — nothing was lost.
    const remaining = await readQueue()
    expect(remaining.map((e) => e.id)).toEqual(['local-2', 'local-3'])
    expect(first.pending).toBe(2)
    expect(first.error).toMatch(/Spojenie/)

    // Second attempt finishes the job.
    checkinScan.mockResolvedValue(result('ok'))
    const second = await runSync()
    expect(await readQueue()).toHaveLength(0)
    expect(second.pending).toBe(0)
    expect(second.error).toBeNull()
  })

  it('an expired session stops the run without signing out or losing data', async () => {
    await queueScans(2)
    checkinScan.mockRejectedValue(new FakeAuthError('UNAUTHORIZED'))

    const state = await runSync()

    expect(await readQueue()).toHaveLength(2)
    expect(state.pending).toBe(2)
    expect(state.error).toMatch(/prihlásenie/)
  })

  it('does nothing when the queue is empty', async () => {
    const state = await runSync()
    expect(checkinScan).not.toHaveBeenCalled()
    expect(state.pending).toBe(0)
  })

  it('exposes the pending count for the UI', async () => {
    await queueScans(2)
    await refreshSyncState()
    expect(getSyncState().pending).toBe(2)
    await dismissConflicts()
  })
})
