/**
 * OpenAPI 3.0 spec for the public REST API. Pure builder (server URL injected) so
 * the /api/v1/openapi.json route and tests can share it.
 */

const listParams = [
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    description: 'Počet záznamov (max 100).',
  },
  {
    name: 'offset',
    in: 'query',
    schema: { type: 'integer', minimum: 0, default: 0 },
    description: 'Posun pre stránkovanie.',
  },
]

const statusParam = {
  name: 'status',
  in: 'query',
  schema: { type: 'string' },
  description: 'Filter podľa stavu.',
}

export function openApiSpec(serverUrl: string): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Ticketio API',
      version: '1.0.0',
      description:
        'Verejné REST API pre organizátorov. Autentifikácia cez API kľúč (Bearer). ' +
        'Limit 120 požiadaviek za minútu na kľúč. Všetky sumy sú v centoch (EUR).',
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'API kľúč vo formáte tik_live_… (Authorization: Bearer …).',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        Event: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            slug: { type: 'string' },
            title: { type: 'string' },
            status: {
              type: 'string',
              enum: ['draft', 'published', 'archived'],
            },
            starts_at: { type: 'string', format: 'date-time' },
            ends_at: { type: 'string', format: 'date-time', nullable: true },
            timezone: { type: 'string' },
            venue_name: { type: 'string', nullable: true },
            venue_address: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        TicketType: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            price_cents: { type: 'integer' },
            currency: { type: 'string' },
            capacity: { type: 'integer' },
            sold_count: { type: 'integer' },
            hidden: { type: 'boolean' },
          },
        },
        Order: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            ref: { type: 'string' },
            event_id: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
            buyer_email: { type: 'string' },
            buyer_name: { type: 'string', nullable: true },
            subtotal_cents: { type: 'integer' },
            discount_cents: { type: 'integer' },
            total_cents: { type: 'integer' },
            currency: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            paid_at: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        Ticket: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            ref: { type: 'string' },
            order_id: { type: 'string', format: 'uuid' },
            ticket_type_id: { type: 'string', format: 'uuid' },
            event_id: { type: 'string', format: 'uuid' },
            holder_name: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['valid', 'used', 'cancelled'] },
            checked_in: { type: 'boolean' },
            checked_in_at: {
              type: 'string',
              format: 'date-time',
              nullable: true,
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Chýbajúci alebo neplatný API kľúč.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        NotFound: {
          description: 'Zdroj sa nenašiel.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
    paths: {
      '/me': {
        get: {
          summary: 'Info o organizátorovi kľúča',
          responses: {
            '200': { description: 'OK' },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/events': {
        get: {
          summary: 'Zoznam podujatí',
          parameters: [statusParam, ...listParams],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Event' },
                      },
                      limit: { type: 'integer' },
                      offset: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/events/{id}': {
        get: {
          summary: 'Detail podujatia + typy vstupeniek',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': { description: 'OK' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/events/{id}/tickets': {
        get: {
          summary: 'Vstupenky podujatia s check-in stavom',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            statusParam,
            ...listParams,
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Ticket' },
                      },
                    },
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/orders': {
        get: {
          summary: 'Zoznam objednávok',
          parameters: [
            statusParam,
            {
              name: 'event_id',
              in: 'query',
              schema: { type: 'string' },
              description: 'Filter podľa podujatia.',
            },
            ...listParams,
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Order' },
                      },
                    },
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
    },
  }
}
