// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup } from '@testing-library/react'
import type { SalesSnapshot } from '../server/sales-live'

// The polling fallback goes through a server fn; replace the module so the test
// never pulls the server graph in.
const getSalesSnapshotFn = vi.fn()
vi.mock('../server/dashboard', () => ({
  getSalesSnapshotFn: (args: unknown) => getSalesSnapshotFn(args),
}))

// --- Fake EventSource -------------------------------------------------------

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  closed = false
  onerror: (() => void) | null = null
  private listeners = new Map<string, ((ev: MessageEvent<string>) => void)[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (ev: MessageEvent<string>) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }
  close() {
    this.closed = true
  }
  /** Push a frame from the "server". */
  emit(snapshot: SalesSnapshot) {
    for (const fn of this.listeners.get('snapshot') ?? []) {
      fn(new MessageEvent('snapshot', { data: JSON.stringify(snapshot) }))
    }
  }
  fail() {
    this.onerror?.()
  }
  static get last() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1]
  }
  static get open() {
    return FakeEventSource.instances.filter((i) => !i.closed)
  }
}

function snap(over: Partial<SalesSnapshot> = {}): SalesSnapshot {
  return {
    grossCents: 1000,
    feeCents: 40,
    netCents: 960,
    paidOrderCount: 1,
    ticketCount: 2,
    checkedIn: 0,
    at: '2026-07-22T10:00:00.000Z',
    series: {
      hourly: [],
      daily: [],
      eventDay: '2026-07-20',
      timezone: 'Europe/Bratislava',
    },
    ...over,
  }
}

const { useLiveSales } = await import('./use-live-sales')

/** Renders the hook and exposes its latest value. */
function mount(eventId = 'event-1', onChange?: () => void) {
  const state: { current: ReturnType<typeof useLiveSales> | null } = {
    current: null,
  }
  function Probe() {
    state.current = useLiveSales(eventId, onChange)
    return null
  }
  const utils = render(<Probe />)
  return { state, ...utils }
}

describe('useLiveSales', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    getSalesSnapshotFn.mockReset()
    getSalesSnapshotFn.mockResolvedValue(snap())
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('opens one stream for the event and reports live on the first frame', async () => {
    const { state } = mount('event-1')
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.last.url).toContain('/api/events/event-1/sales-stream')
    expect(state.current?.mode).toBe('connecting')

    await act(async () => {
      FakeEventSource.last.emit(snap({ grossCents: 2500 }))
    })

    expect(state.current?.mode).toBe('live')
    expect(state.current?.snapshot?.grossCents).toBe(2500)
    expect(state.current?.updatedAt).not.toBeNull()
    // Nothing was polled while the stream works.
    expect(getSalesSnapshotFn).not.toHaveBeenCalled()
  })

  it('falls back to polling after two stream failures, and keeps updating', async () => {
    const { state } = mount()

    await act(async () => {
      FakeEventSource.last.fail()
    })
    expect(state.current?.mode).not.toBe('polling') // one failure is tolerated

    getSalesSnapshotFn.mockResolvedValue(snap({ grossCents: 7777 }))
    await act(async () => {
      FakeEventSource.last.fail()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(state.current?.mode).toBe('polling')
    expect(state.current?.snapshot?.grossCents).toBe(7777)

    // It keeps polling on its own.
    getSalesSnapshotFn.mockResolvedValue(snap({ grossCents: 8888 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(state.current?.snapshot?.grossCents).toBe(8888)
  })

  it('retries the stream with backoff and returns to live when it works', async () => {
    const { state } = mount()

    await act(async () => {
      FakeEventSource.last.fail()
      FakeEventSource.last.fail()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(state.current?.mode).toBe('polling')
    const afterFailures = FakeEventSource.instances.length

    // First backoff step (5 s) opens a fresh stream.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(FakeEventSource.instances.length).toBe(afterFailures + 1)

    // It works this time -> back to live, and polling stops.
    await act(async () => {
      FakeEventSource.last.emit(snap({ grossCents: 4242 }))
    })
    expect(state.current?.mode).toBe('live')

    getSalesSnapshotFn.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(getSalesSnapshotFn).not.toHaveBeenCalled()
  })

  it('closes the connection on unmount — no dangling stream', async () => {
    const { unmount } = mount()
    const es = FakeEventSource.last
    expect(es.closed).toBe(false)

    unmount()

    expect(es.closed).toBe(true)
    expect(FakeEventSource.open).toHaveLength(0)
  })

  it('drops the connection while the tab is hidden and reopens on return', async () => {
    mount()
    const first = FakeEventSource.last

    await act(async () => {
      Object.defineProperty(document, 'hidden', {
        value: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(first.closed).toBe(true)

    await act(async () => {
      Object.defineProperty(document, 'hidden', {
        value: false,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(FakeEventSource.open).toHaveLength(1)
    // Returning also resyncs immediately instead of waiting for a frame.
    expect(getSalesSnapshotFn).toHaveBeenCalled()
  })

  it('notifies the page only when the numbers actually change', async () => {
    const onChange = vi.fn()
    mount('event-1', onChange)

    await act(async () => {
      FakeEventSource.last.emit(snap({ grossCents: 1000 }))
    })
    // First frame is the baseline, not a change.
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      FakeEventSource.last.emit(snap({ grossCents: 1000, at: 'later' }))
    })
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      FakeEventSource.last.emit(snap({ grossCents: 3000 }))
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('survives a malformed frame without dying', async () => {
    const { state } = mount()
    await act(async () => {
      FakeEventSource.last.emit(snap({ grossCents: 1234 }))
    })
    await act(async () => {
      // A truncated frame — must not throw or wipe the last good numbers.
      for (const fn of (FakeEventSource.last as never as {
        listeners: Map<string, ((ev: MessageEvent<string>) => void)[]>
      }).listeners.get('snapshot') ?? []) {
        fn(new MessageEvent('snapshot', { data: '{"grossCents":' }))
      }
    })
    expect(state.current?.snapshot?.grossCents).toBe(1234)
  })
})
