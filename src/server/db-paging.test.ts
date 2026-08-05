/**
 * The bug these guard against: PostgREST answers with at most `db-max-rows`
 * (1000) whatever `limit` says, so "fewer rows than I asked for" does NOT mean
 * "that was the last page". Reading an 11 604-seat hall used to stop at 1000 —
 * and the editor then wrote those 1000 back as the whole map.
 */

import { describe, it, expect, vi } from 'vitest'
import { readAllRows, readAllByKeys, IN_CHUNK } from './db-paging'

/**
 * A stand-in for the query builder: holds `total` rows and never returns more
 * than `cap` of them at a time, exactly like the server's row cap.
 */
function fakeTable(total: number, cap = 1000) {
  const calls: [number, number][] = []
  const build = () => ({
    range: (from: number, to: number) => {
      calls.push([from, to])
      const rows = []
      for (let i = from; i <= Math.min(to, from + cap - 1) && i < total; i++) {
        rows.push({ id: i })
      }
      return Promise.resolve({ data: rows, error: null })
    },
  })
  return { build, calls }
}

describe('readAllRows', () => {
  it('reads everything when the server caps pages below the requested size', async () => {
    // 2500 rows, server hands out 400 at a time: the naive loop would stop at
    // the first short page and report 400.
    const { build, calls } = fakeTable(2500, 400)
    const rows = await readAllRows(build, 'test')
    expect(rows).toHaveLength(2500)
    expect(rows[0]).toEqual({ id: 0 })
    expect(rows[2499]).toEqual({ id: 2499 })
    // Each request starts where the previous one really ended.
    expect(calls.map(([from]) => from)).toEqual([
      0, 400, 800, 1200, 1600, 2000, 2400, 2500,
    ])
  })

  it('reads a hall bigger than one page', async () => {
    const { build } = fakeTable(11_604)
    await expect(readAllRows(build, 'test')).resolves.toHaveLength(11_604)
  })

  it('stops on the empty page, not on a short one', async () => {
    const { build, calls } = fakeTable(1500)
    await readAllRows(build, 'test')
    expect(calls).toHaveLength(3) // 1000 + 500 + the empty probe
  })

  it('handles an empty table without a second request', async () => {
    const { build, calls } = fakeTable(0)
    await expect(readAllRows(build, 'test')).resolves.toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('surfaces the query error instead of returning a partial read', async () => {
    const build = () => ({
      range: () =>
        Promise.resolve({ data: null, error: { message: 'spojenie zlyhalo' } }),
    })
    await expect(readAllRows(build, 'sedadlá')).rejects.toThrow(
      'sedadlá: spojenie zlyhalo',
    )
  })

  it('gives up rather than looping forever past the guard', async () => {
    const { build } = fakeTable(5000)
    await expect(readAllRows(build, 'test', 2000)).rejects.toThrow(
      /viac než 2000 riadkov/,
    )
  })

  it('asks for the pages in order, one round trip each', async () => {
    const { build } = fakeTable(3000)
    const spy = vi.fn(build)
    await readAllRows(spy, 'test')
    expect(spy).toHaveBeenCalledTimes(4)
  })
})

/**
 * The second half of the same trap. Once a parent read is paged correctly it
 * returns 10 000 orders instead of a capped 1000, and passing every id to a
 * single `in.(…)` turns the silent truncation into a 414 — the query string
 * outgrows what the server will accept. So the key list is chunked, and each
 * chunk still has to be paged, because one chunk can match more than 1000 rows.
 */
describe('readAllByKeys', () => {
  /**
   * Records the chunks it was handed; each key matches `perKey` rows.
   *
   * `build` runs once per page, so a chunk is only recorded on its first page —
   * otherwise the log would count round trips, not chunks.
   */
  function fakeChildTable(perKey: number, cap = 1000) {
    const chunks: string[][] = []
    const build = (chunk: string[]) => {
      const all = chunk.flatMap((k) =>
        Array.from({ length: perKey }, (_, i) => ({ key: k, i })),
      )
      return {
        range: (from: number, to: number) => {
          if (from === 0) chunks.push(chunk)
          return Promise.resolve({
            data: all.slice(from, Math.min(to + 1, from + cap)),
            error: null,
          })
        },
      }
    }
    return { build, chunks }
  }

  it('splits the key list so the query string stays inside the limit', async () => {
    const keys = Array.from({ length: 250 }, (_, i) => `k${i}`)
    const { build, chunks } = fakeChildTable(1)
    const rows = await readAllByKeys(keys, build, 'test')

    expect(rows).toHaveLength(250)
    expect(chunks.map((c) => c.length)).toEqual([IN_CHUNK, IN_CHUNK, 50])
    // Every key is asked for exactly once, in order.
    expect(chunks.flat()).toEqual(keys)
  })

  it('pages within a chunk when one chunk matches more than a page', async () => {
    // 100 keys × 30 rows = 3000 rows for a single chunk.
    const keys = Array.from({ length: IN_CHUNK }, (_, i) => `k${i}`)
    const { build } = fakeChildTable(30)
    await expect(readAllByKeys(keys, build, 'test')).resolves.toHaveLength(3000)
  })

  it('does not query at all when there are no keys', async () => {
    const { build, chunks } = fakeChildTable(1)
    await expect(readAllByKeys([], build, 'test')).resolves.toEqual([])
    expect(chunks).toHaveLength(0)
  })

  it('surfaces a failing chunk instead of returning the chunks that worked', async () => {
    const build = vi.fn(() => ({
      range: () =>
        Promise.resolve({ data: null, error: { message: 'spojenie zlyhalo' } }),
    }))
    await expect(readAllByKeys(['a'], build, 'refundácie')).rejects.toThrow(
      'refundácie: spojenie zlyhalo',
    )
  })
})
