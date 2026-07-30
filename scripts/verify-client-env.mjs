// Post-build guard: nothing server-only may reach the browser bundle.
//
// Two checks over every JS chunk in `.output/public`:
//   1. names of server-only env vars (src/lib/env.ts) — their mere presence means
//      a server module leaked into the client graph, which is how the whole env
//      schema (the list of every integration we use) once shipped to visitors;
//   2. any JWT whose payload says `service_role` — the key itself must never ship.
//
// The anon key is deliberately NOT flagged: Supabase ships it to browsers by
// design and access is gated by RLS. Run: `node scripts/verify-client-env.mjs`.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PUBLIC_DIR = '.output/public'

/** Server-only env var names — none of these belongs in a browser chunk. */
const FORBIDDEN_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOPAY_CLIENT_SECRET',
  'GOPAY_CLIENT_ID',
  'GOPAY_GOID',
  'CRON_SECRET',
  'FAKTERO_API_KEY',
  'RESEND_API_KEY',
  'ANTHROPIC_API_KEY',
  'APPLE_PASS_CERT_PEM',
  'APPLE_PASS_KEY_PEM',
  'APPLE_WWDR_PEM',
  'GOOGLE_WALLET_SA_KEY',
  'GOOGLE_WALLET_SA_EMAIL',
]

const JWT_RE =
  /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g

if (!existsSync(PUBLIC_DIR)) {
  console.error(
    `[verify-client-env] ${PUBLIC_DIR} not found — run \`npm run build\` first.`,
  )
  process.exit(1)
}

/** Every .js file under dir, recursively. */
function jsFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return jsFiles(path)
    return path.endsWith('.js') ? [path] : []
  })
}

function isServiceRoleJwt(payload) {
  try {
    return (
      JSON.parse(Buffer.from(payload, 'base64url').toString()).role ===
      'service_role'
    )
  } catch {
    return false
  }
}

const failures = []
let scanned = 0

for (const file of jsFiles(PUBLIC_DIR)) {
  scanned++
  const source = readFileSync(file, 'utf8')

  for (const name of FORBIDDEN_NAMES) {
    if (source.includes(name))
      failures.push(`${file}: server-only env name \`${name}\``)
  }
  for (const [, payload] of source.matchAll(JWT_RE)) {
    if (isServiceRoleJwt(payload)) failures.push(`${file}: SERVICE ROLE JWT`)
  }
}

if (failures.length) {
  console.error(
    '[verify-client-env] FAIL: server-only material in the client bundle:',
  )
  for (const failure of failures) console.error(`  ‼  ${failure}`)
  console.error(
    'Import src/lib/env.ts (and anything reading it) only from server code, and keep the ' +
      'zod schema inside buildSchema() so it stays unreachable from the client graph.',
  )
  process.exit(1)
}

console.log(`[verify-client-env] OK: ${scanned} client chunks clean.`)
