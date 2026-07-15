/**
 * Seed the linked Supabase project with test data so the whole public flow can
 * be clicked through on localhost. Idempotent: fixed UUIDs + upsert, and
 * sold_count is reset to 0 on every run so capacity is fresh for re-testing.
 *
 * Run: npm run db:seed   (loads .env via node --env-file)
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const appUrl = process.env.APP_URL ?? 'http://localhost:3000'

if (!url || !serviceKey) {
  console.error(
    'Chýba SUPABASE_URL alebo SUPABASE_SERVICE_ROLE_KEY v .env — seed prerušený.',
  )
  process.exit(1)
}

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Deterministic ids so re-running upserts instead of duplicating.
const ORG_ID = '00000000-0000-4000-8000-000000000001'
const EVENT_ID = '00000000-0000-4000-8000-000000000010'
const TT_STANDARD = '00000000-0000-4000-8000-000000000011'
const TT_VIP = '00000000-0000-4000-8000-000000000012'
const TT_FREE = '00000000-0000-4000-8000-000000000013'
const COUPON_ID = '00000000-0000-4000-8000-000000000020'

const EVENT_SLUG = 'letny-festival-2026'
const COUPON_CODE = 'LETO10'

function assertOk(label: string, error: { message: string } | null) {
  if (error) {
    console.error(`✗ ${label}: ${error.message}`)
    process.exit(1)
  }
  console.log(`✓ ${label}`)
}

async function main() {
  // 1. Organizer
  assertOk(
    'organizer',
    (
      await db.from('organizers').upsert(
        {
          id: ORG_ID,
          name: 'Tobify Events',
          slug: 'tobify-events',
          email: 'info@tobify.sk',
          fee_percent: 4.0,
          fee_min_cents: 40,
        },
        { onConflict: 'id' },
      )
    ).error,
  )

  // 2. Published event, starting in ~14 days
  const startsAt = new Date(Date.now() + 14 * 24 * 3600 * 1000)
  const endsAt = new Date(startsAt.getTime() + 5 * 3600 * 1000)
  assertOk(
    'event (published)',
    (
      await db.from('events').upsert(
        {
          id: EVENT_ID,
          organizer_id: ORG_ID,
          title: 'Letný festival 2026',
          slug: EVENT_SLUG,
          description:
            'Testovacie podujatie pre lokálny vývoj. Vyber si vstupenky, vyskúšaj kupón aj vstupenku zdarma.',
          venue_name: 'Amfiteáter Košice',
          venue_address: 'Festivalová 1, Košice',
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          status: 'published',
          // qr_secret intentionally omitted: keep the DB default on insert,
          // and don't churn it on re-seed.
        },
        { onConflict: 'id' },
      )
    ).error,
  )

  // 3. Ticket types — different prices incl. one free. sold_count reset to 0.
  assertOk(
    'ticket types',
    (
      await db.from('ticket_types').upsert(
        [
          {
            id: TT_STANDARD,
            event_id: EVENT_ID,
            name: 'Štandard',
            description: 'Bežný vstup na celý festival.',
            price_cents: 1500,
            capacity: 100,
            sold_count: 0,
            max_per_order: 10,
            sort_order: 1,
            hidden: false,
          },
          {
            id: TT_VIP,
            event_id: EVENT_ID,
            name: 'VIP',
            description: 'VIP zóna, samostatný bar a sedenie.',
            price_cents: 3500,
            capacity: 20,
            sold_count: 0,
            max_per_order: 6,
            sort_order: 2,
            hidden: false,
          },
          {
            id: TT_FREE,
            event_id: EVENT_ID,
            name: 'Vstup zdarma (deti do 12 r.)',
            description: 'Bezplatná vstupenka — otestuje flow bez platby.',
            price_cents: 0,
            capacity: 50,
            sold_count: 0,
            max_per_order: 4,
            sort_order: 3,
            hidden: false,
          },
        ],
        { onConflict: 'id' },
      )
    ).error,
  )

  // 4. Percentage coupon
  assertOk(
    `coupon (${COUPON_CODE}, -10%)`,
    (
      await db.from('coupons').upsert(
        {
          id: COUPON_ID,
          event_id: EVENT_ID,
          code: COUPON_CODE,
          type: 'percent',
          value: 10,
          max_uses: 100,
          used_count: 0,
          valid_from: null,
          valid_until: null,
        },
        { onConflict: 'id' },
      )
    ).error,
  )

  console.log('\nHotovo. Preklikaj flow tu:')
  console.log(`  Event:  ${appUrl}/e/${EVENT_SLUG}`)
  console.log(`  Kupón:  ${COUPON_CODE} (−10 %)`)
  console.log('  Tip: vstupenka „Vstup zdarma“ prejde celým flow bez GoPay.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
