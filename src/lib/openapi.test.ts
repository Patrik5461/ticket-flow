import { describe, it, expect } from 'vitest'
import { openApiSpec } from './openapi'

describe('openApiSpec', () => {
  const spec = openApiSpec('https://ticketio.sk/api/v1') as any

  it('sets the server url and bearer security', () => {
    expect(spec.openapi).toBe('3.0.3')
    expect(spec.servers[0].url).toBe('https://ticketio.sk/api/v1')
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer')
    expect(spec.security).toEqual([{ bearerAuth: [] }])
  })

  it('documents the v1 endpoints', () => {
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/events',
      '/events/{id}',
      '/events/{id}/tickets',
      '/me',
      '/orders',
    ])
    expect(spec.paths['/events'].get.responses['200']).toBeDefined()
    expect(spec.paths['/events/{id}'].get.responses['404']).toBeDefined()
  })

  it('defines the core schemas', () => {
    expect(Object.keys(spec.components.schemas)).toEqual(
      expect.arrayContaining([
        'Event',
        'TicketType',
        'Order',
        'Ticket',
        'Error',
      ]),
    )
  })
})
