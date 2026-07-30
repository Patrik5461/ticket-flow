/**
 * Live anon-probe for public-read RLS + column privileges.
 *
 * CLAUDE.md requires an anon probe after every RLS/grant migration. Run this
 * BEFORE and AFTER applying a migration that touches public reads.
 *
 *   node --env-file=~/ticketio-secrets.env scripts/rls-anon-probe.mjs
 *
 * It uses ONLY the public anon key (never the service role) — it verifies what a
 * browser can and cannot read straight from PostgREST. Exit code 0 = all good,
 * 1 = a security or regression check failed.
 *
 * Checks:
 *   1. anon CANNOT read events.qr_secret            (the fix)
 *   2. anon CAN still read published events (title)  (public visibility intact)
 *   3. anon stays blocked on orders / tickets        (unchanged, sanity)
 */

const url = process.env.SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY
if (!url || !anon) {
  console.error('Chýba SUPABASE_URL alebo SUPABASE_ANON_KEY v prostredí.')
  process.exit(1)
}

const H = { apikey: anon, Authorization: `Bearer ${anon}` }
const q = async (path) => {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: H })
  const text = await r.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: r.status, json }
}

let failures = 0
const pass = (m) => console.log(`  ✅ ${m}`)
const fail = (m) => {
  console.log(`  ‼  ${m}`)
  failures++
}

console.log('Anon-probe proti', url)

// 1. qr_secret must NOT be readable. Post-fix PostgREST returns 42501
//    (permission denied for column) on an explicit select of a non-granted col.
{
  const r = await q('events?select=id,qr_secret&limit=5')
  const leaked =
    r.status === 200 &&
    Array.isArray(r.json) &&
    r.json.some((row) => 'qr_secret' in row && row.qr_secret != null)
  if (leaked) fail('anon PREČÍTAL events.qr_secret — diera je otvorená')
  else pass(`anon nemôže čítať events.qr_secret (status ${r.status})`)
}

// Also guard select=* — must not smuggle qr_secret through.
{
  const r = await q('events?select=*&limit=5')
  const leaked =
    r.status === 200 &&
    Array.isArray(r.json) &&
    r.json.some((row) => 'qr_secret' in row)
  if (leaked) fail('anon dostal qr_secret cez select=*')
  else pass(`anon select=* neobsahuje qr_secret (status ${r.status})`)
}

// 2. Public visibility must survive: a published event's title is still readable.
{
  const r = await q('events?select=id,title,slug&status=eq.published&limit=1')
  if (r.status === 200 && Array.isArray(r.json)) {
    pass(`anon stále vidí publikované eventy (${r.json.length} riadok/ov)`)
  } else {
    fail(`anon stratil verejné čítanie eventov (status ${r.status})`)
  }
}

// 3. Sanity: sensitive tables stay closed to anon.
for (const t of ['orders', 'tickets', 'refunds', 'organizers']) {
  const r = await q(`${t}?select=*&limit=1`)
  const rows = Array.isArray(r.json) ? r.json.length : -1
  if (r.status === 200 && rows === 0) pass(`${t}: anon nič nevidí`)
  else if (r.status >= 400) pass(`${t}: anon blokovaný (status ${r.status})`)
  else fail(`${t}: anon PREČÍTAL ${rows} riadkov`)
}

console.log(failures === 0 ? '\nVŠETKO OK.' : `\nZLYHALO: ${failures} kontrol.`)
process.exit(failures === 0 ? 0 : 1)
