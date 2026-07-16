import { describe, it, expect } from 'vitest'
import { RateLimiter } from './rate-limit'

describe('RateLimiter', () => {
  it('allows up to the limit, then blocks within the window', () => {
    const t = 1000
    const rl = new RateLimiter(3, 1000, () => t)
    expect(rl.check('k').ok).toBe(true)
    expect(rl.check('k').ok).toBe(true)
    const third = rl.check('k')
    expect(third.ok).toBe(true)
    expect(third.remaining).toBe(0)
    expect(rl.check('k').ok).toBe(false)
  })

  it('resets after the window elapses', () => {
    let t = 0
    const rl = new RateLimiter(1, 1000, () => t)
    expect(rl.check('k').ok).toBe(true)
    expect(rl.check('k').ok).toBe(false)
    t = 1000
    expect(rl.check('k').ok).toBe(true)
  })

  it('tracks keys independently', () => {
    const t = 0
    const rl = new RateLimiter(1, 1000, () => t)
    expect(rl.check('a').ok).toBe(true)
    expect(rl.check('b').ok).toBe(true)
    expect(rl.check('a').ok).toBe(false)
  })

  it('reports resetAt at the window end', () => {
    const rl = new RateLimiter(5, 60000, () => 5000)
    expect(rl.check('k').resetAt).toBe(65000)
  })
})
