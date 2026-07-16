import { describe, it, expect } from 'vitest'
import { gopayStateToAction } from './gopay-state'

describe('gopayStateToAction', () => {
  it('maps every documented GoPay state', () => {
    expect(gopayStateToAction('PAID')).toBe('fulfill')
    expect(gopayStateToAction('REFUNDED')).toBe('refund_full')
    expect(gopayStateToAction('PARTIALLY_REFUNDED')).toBe('refund_partial')
    expect(gopayStateToAction('CANCELED')).toBe('cancel')
    expect(gopayStateToAction('TIMEOUTED')).toBe('cancel')
    expect(gopayStateToAction('CREATED')).toBe('none')
    expect(gopayStateToAction('PAYMENT_METHOD_CHOSEN')).toBe('none')
    expect(gopayStateToAction('AUTHORIZED')).toBe('none')
  })

  it('treats unknown states as no-op (forward-compatible)', () => {
    expect(gopayStateToAction('SOMETHING_NEW')).toBe('none')
    expect(gopayStateToAction('')).toBe('none')
  })
})
