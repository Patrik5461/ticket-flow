import { describe, it, expect } from 'vitest'
import { bulkJobRows } from './bulk-messages'

describe('bulkJobRows', () => {
  it('builds one deduped bulk job per recipient', () => {
    const rows = bulkJobRows({
      campaignId: 'camp-1',
      eventId: 'ev-1',
      emails: ['a@x.sk', 'b@x.sk'],
      subject: 'Predmet',
      html: '<p>Ahoj</p>',
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      kind: 'bulk',
      recipient: 'a@x.sk',
      event_id: 'ev-1',
      campaign_id: 'camp-1',
      subject: 'Predmet',
      html: '<p>Ahoj</p>',
      dedup_key: 'bulk:camp-1:a@x.sk',
    })
    expect(rows.map((r) => r.dedup_key)).toEqual([
      'bulk:camp-1:a@x.sk',
      'bulk:camp-1:b@x.sk',
    ])
  })

  it('returns nothing for no recipients', () => {
    expect(
      bulkJobRows({
        campaignId: 'c',
        eventId: 'e',
        emails: [],
        subject: 's',
        html: 'h',
      }),
    ).toEqual([])
  })
})
