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

// Pre-confirmed test organizer login (dev only). Fixed password so re-seeding
// keeps the same credentials.
const TEST_EMAIL = 'test@ticketio.sk'
const TEST_PASSWORD = 'ticketio-dev-2026'

function assertOk(label: string, error: { message: string } | null) {
  if (error) {
    console.error(`✗ ${label}: ${error.message}`)
    process.exit(1)
  }
  console.log(`✓ ${label}`)
}

/**
 * Create (or refresh) a pre-confirmed test organizer user and attach it to the
 * seed organizer as owner. Idempotent across re-seeds.
 */
async function ensureTestOrganizerUser(): Promise<string> {
  // Find an existing user with this email (admin API has no get-by-email).
  const { data: list, error: listErr } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (listErr) {
    console.error(`✗ test user (list): ${listErr.message}`)
    process.exit(1)
  }
  const existing = list.users.find((u) => u.email === TEST_EMAIL)

  let userId: string
  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing.id, {
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    assertOk('test user (updated, confirmed)', error)
    userId = existing.id
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    if (error) {
      console.error(`✗ test user (create): ${error.message}`)
      process.exit(1)
    }
    assertOk('test user (created, confirmed)', null)
    userId = data.user.id
  }

  // Attach as owner of the seed organizer.
  const { error: memberErr } = await db
    .from('organizer_members')
    .upsert(
      { organizer_id: ORG_ID, user_id: userId, role: 'owner' },
      { onConflict: 'organizer_id,user_id' },
    )
  assertOk('test user → owner of seed organizer', memberErr)
  return userId
}

/** Grant the test account platform super-admin rights (dev only). Idempotent. */
async function ensurePlatformAdmin(userId: string): Promise<void> {
  const { error } = await db
    .from('platform_admins')
    .upsert(
      { user_id: userId, note: 'Seed dev platform admin' },
      { onConflict: 'user_id' },
    )
  assertOk('test user → platform admin', error)
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

  // 5. Pre-confirmed test organizer account (also platform super-admin in dev)
  const testUserId = await ensureTestOrganizerUser()
  await ensurePlatformAdmin(testUserId)

  console.log('\nHotovo. Preklikaj flow tu:')
  console.log(`  Event:  ${appUrl}/e/${EVENT_SLUG}`)
  console.log(`  Kupón:  ${COUPON_CODE} (−10 %)`)
  console.log('  Tip: vstupenka „Vstup zdarma“ prejde celým flow bez GoPay.')
  console.log('\nPrihlásenie do organizátorského portálu (/app):')
  console.log(`  e-mail: ${TEST_EMAIL}`)
  console.log(`  heslo:  ${TEST_PASSWORD}`)
  console.log('  (tento účet je zároveň platform super-admin → /admin)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
