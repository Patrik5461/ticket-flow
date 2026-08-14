/**
 * Restore a backup written by backup-db.ts into a Supabase project.
 *
 * Until now the restore was prose in CLAUDE.md and had never been performed.
 * That is the half of a backup nobody tests: verify-backup.ts proves the bytes
 * are intact, but intact bytes you have never put back are still a hypothesis.
 * This turns the procedure into something that can be rehearsed.
 *
 * WHAT IT DOES NOT DO: create the schema. Tables, RLS, grants, functions and
 * triggers all live in supabase/migrations and must be applied to the target
 * project FIRST — this only refills them. It also cannot restore pg_cron jobs
 * (not in the public schema, so never backed up) or password hashes (the GoTrue
 * admin API does not return them, so restored users must set a new password).
 *
 * SAFETY. A restore aimed at the wrong project overwrites live data, so:
 *   - it is a DRY RUN unless --write is given;
 *   - the target is never taken from SUPABASE_URL. It must be passed as
 *     RESTORE_SUPABASE_URL + RESTORE_SERVICE_ROLE_KEY, and if the target
 *     matches SUPABASE_URL the run is refused outright.
 * Rows are written with `Prefer: resolution=merge-duplicates`, which upserts on
 * the primary key rather than duplicating, so a re-run is safe and an
 * interrupted restore can simply be repeated.
 *
 * ORDER. Tables go in manifest.restoreOrder, which backup-db.ts derived from
 * the foreign keys, so a child never lands before its parent. Auth users go
 * FIRST of all, because rows carry user ids that point at them.
 *
 * Run:
 *   node --env-file=~/ticketio-secrets.env scripts/restore-db.ts            # dry run
 *   node --env-file=~/ticketio-secrets.env scripts/restore-db.ts --write
 *   ... --from ~/backups/db/20260814-031501 --only venues,seats
 *
 * Exit 0 on success, 1 on any failure.
 */

import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import path from 'node:path'

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const ONLY = flag('--only')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const BACKUP_ROOT = `${process.env.HOME}/backups/db`
const TARGET_URL = process.env.RESTORE_SUPABASE_URL
const TARGET_KEY = process.env.RESTORE_SERVICE_ROLE_KEY
const PRODUCTION_URL = process.env.SUPABASE_URL

/** Rows per request. Large enough to be quick, small enough to stay well
 *  inside request limits on wide tables like seats. */
const BATCH = 500
const HTTP_TIMEOUT_MS = 60_000

interface Manifest {
  projectRef: string
  finishedAt: string
  totals: { rows: number; authUsers: number; storageObjects: number }
  restoreOrder: string[]
  tables: Record<string, { table: string; rows: number }>
}

function fail(message: string): never {
  console.error(`\n${message}`)
  process.exit(1)
}

async function newestBackup(): Promise<string> {
  const dirs = (await readdir(BACKUP_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  if (dirs.length === 0) fail(`Žiadna záloha v ${BACKUP_ROOT}`)
  return path.join(BACKUP_ROOT, dirs[dirs.length - 1])
}

async function post(
  urlPath: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const res = await fetch(`${TARGET_URL}${urlPath}`, {
    method: 'POST',
    headers: {
      apikey: TARGET_KEY!,
      Authorization: `Bearer ${TARGET_KEY}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(
      `${urlPath}: ${res.status} ${(await res.text()).slice(0, 300)}`,
    )
  }
}

/** Stream a gzipped ndjson file in batches, so seats never lands in memory. */
async function eachBatch(
  file: string,
  onBatch: (rows: unknown[]) => Promise<void>,
): Promise<number> {
  const rl = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  })
  let batch: unknown[] = []
  let total = 0
  for await (const line of rl) {
    if (line.trim() === '') continue
    batch.push(JSON.parse(line))
    total++
    if (batch.length >= BATCH) {
      await onBatch(batch)
      batch = []
    }
  }
  if (batch.length > 0) await onBatch(batch)
  return total
}

async function restoreUsers(dir: string, manifest: Manifest): Promise<void> {
  const users = JSON.parse(
    await readFile(path.join(dir, 'auth-users.json'), 'utf8'),
  ) as Record<string, unknown>[]

  console.log(`\nPoužívatelia: ${users.length}`)
  if (users.length !== manifest.totals.authUsers) {
    fail(
      `auth-users.json má ${users.length}, manifest hovorí ${manifest.totals.authUsers} — nesúlad, obnovu zastavujem`,
    )
  }
  if (!WRITE) {
    console.log('  (dry run — nič sa nezapisuje)')
    return
  }
  for (const u of users) {
    // The id is kept on purpose: every table that references a user stores it,
    // so a new id would orphan those rows.
    await post('/auth/v1/admin/users', {
      id: u.id,
      email: u.email,
      email_confirm: Boolean(u.email_confirmed_at),
      app_metadata: u.app_metadata,
      user_metadata: u.user_metadata,
    })
  }
  console.log(
    '  hotovo — bez hesiel, každý si musí nastaviť nové (GoTrue ich nevracia)',
  )
}

async function restoreTables(dir: string, manifest: Manifest): Promise<void> {
  const order = manifest.restoreOrder.filter((t) => !ONLY || ONLY.includes(t))
  if (ONLY) {
    const unknown = ONLY.filter((t) => !manifest.restoreOrder.includes(t))
    if (unknown.length > 0) fail(`Neznáme tabuľky: ${unknown.join(', ')}`)
    console.log(`\nObmedzené na: ${order.join(', ')}`)
  }

  // manifest.tables is keyed by position, not by name, so index it once.
  const expectedRows = new Map<string, number>()
  for (const t of Object.values(manifest.tables)) {
    expectedRows.set(t.table, t.rows)
  }

  console.log(`\nTabuľky (${order.length}), v poradí podľa cudzích kľúčov:`)
  let grand = 0
  for (const table of order) {
    const file = path.join(dir, 'tables', `${table}.ndjson.gz`)
    try {
      await stat(file)
    } catch {
      fail(`${table}: súbor chýba (${file})`)
    }

    const rows = await eachBatch(file, async (batch) => {
      if (WRITE) {
        // merge-duplicates upserts on the primary key, so a repeated run is
        // harmless and an interrupted one can just be run again.
        await post(`/rest/v1/${table}`, batch, {
          Prefer: 'resolution=merge-duplicates,return=minimal',
        })
      }
    })
    grand += rows

    // Read what the manifest promised BEFORE trusting the file: a short file
    // here means the restore would silently rebuild less than was backed up.
    const expected = expectedRows.get(table)
    if (expected !== undefined && rows !== expected) {
      fail(`${table}: v súbore ${rows} riadkov, manifest čakal ${expected}`)
    }
    console.log(
      `  ${table.padEnd(24)} ${String(rows).padStart(7)} riadkov${WRITE ? '' : ' (dry run)'}`,
    )
  }
  console.log(`  spolu ${grand} riadkov`)
}

async function restoreStorage(dir: string, manifest: Manifest): Promise<void> {
  const root = path.join(dir, 'storage')
  const files: string[] = []
  async function walk(d: string): Promise<void> {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else files.push(p)
    }
  }
  await walk(root)

  console.log(`\nStorage: ${files.length} súborov`)
  if (files.length !== manifest.totals.storageObjects) {
    console.warn(
      `  ! manifest hovorí ${manifest.totals.storageObjects} — nesúlad`,
    )
  }
  if (!WRITE) {
    console.log('  (dry run — nič sa nenahráva)')
    return
  }
  for (const f of files) {
    const rel = path.relative(root, f)
    const slash = rel.indexOf(path.sep)
    const bucket = rel.slice(0, slash)
    const objectPath = rel
      .slice(slash + 1)
      .split(path.sep)
      .join('/')
    const body = await readFile(f)
    const res = await fetch(
      `${TARGET_URL}/storage/v1/object/${bucket}/${objectPath}`,
      {
        method: 'POST',
        headers: {
          apikey: TARGET_KEY!,
          Authorization: `Bearer ${TARGET_KEY}`,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      fail(`storage ${bucket}/${objectPath}: ${res.status} ${await res.text()}`)
    }
  }
  console.log('  hotovo')
}

async function main(): Promise<void> {
  if (!TARGET_URL || !TARGET_KEY) {
    fail(
      'Chýba RESTORE_SUPABASE_URL a/alebo RESTORE_SERVICE_ROLE_KEY.\n' +
        'Cieľ sa zámerne NEberie zo SUPABASE_URL — obnova mierená na produkciu\n' +
        'by prepísala živé dáta. Nastav ich na prázdny projekt.',
    )
  }
  if (
    PRODUCTION_URL &&
    TARGET_URL.replace(/\/$/, '') === PRODUCTION_URL.replace(/\/$/, '')
  ) {
    fail(
      `Cieľ je ten istý projekt ako SUPABASE_URL (${TARGET_URL}).\n` +
        'To je produkcia. Obnovu odmietam.',
    )
  }

  const dir = flag('--from') ?? (await newestBackup())
  const manifest = JSON.parse(
    await readFile(path.join(dir, 'manifest.json'), 'utf8'),
  ) as Manifest

  console.log(WRITE ? '=== OBNOVA (zápis) ===' : '=== OBNOVA (dry run) ===')
  console.log(`záloha : ${dir}`)
  console.log(
    `z projektu: ${manifest.projectRef}, dokončená ${manifest.finishedAt}`,
  )
  console.log(`cieľ   : ${TARGET_URL}`)
  console.log(
    '\nPredpoklad: migrácie zo supabase/migrations sú na cieli UŽ aplikované.\n' +
      'Tento skript schému nevytvára, iba dopĺňa dáta.',
  )

  await restoreUsers(dir, manifest)
  await restoreTables(dir, manifest)
  await restoreStorage(dir, manifest)

  if (!WRITE) {
    console.log(
      '\nDry run prešiel. Skutočnú obnovu spustíš tým istým príkazom s --write.',
    )
  } else {
    console.log(
      '\nHotovo. Čo TENTO skript neobnovil a treba dorobiť ručne:\n' +
        '  - heslá používateľov (nie sú v zálohe) — každý si nastaví nové\n' +
        '  - pg_cron joby (nie sú v schéme public) — z migrácií\n' +
        '  - app_settings ukazujú na pôvodné URL, ak obnovuješ inam',
    )
  }
}

await main()
