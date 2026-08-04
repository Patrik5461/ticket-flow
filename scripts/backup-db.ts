/**
 * Logical backup of the Ticketio Supabase database.
 *
 * This exists because there is no other backup. The schema is safe — it lives
 * in supabase/migrations — but the DATA does not: a free-plan Supabase project
 * has no automatic backups, and the hall library (456 halls, ~254k seats) can
 * otherwise only be rebuilt from an export that sits on this very VM. One dead
 * disk used to mean losing both copies.
 *
 * What it writes, per run, into <out>/<timestamp>/:
 *
 *   tables/<table>.ndjson.gz   every row of every public table, one JSON object
 *                              per line, gzipped
 *   auth-users.json            the GoTrue users (see the caveat below)
 *   storage/<bucket>/<path>    every storage object, byte for byte
 *   manifest.json              row counts, sizes, sha256, the git commit that
 *                              was deployed, and `restoreOrder` — the tables
 *                              sorted so a restore never violates a foreign key
 *
 * The table list is NOT hardcoded: it is discovered from the PostgREST OpenAPI
 * spec, so a table added by a future migration lands in the backup without
 * anyone remembering to edit this file. The same spec carries the foreign keys,
 * which is where `restoreOrder` comes from.
 *
 * Two things this deliberately does not capture, because PostgREST cannot see
 * them (CLAUDE.md, "Supabase — ktorý projekt a ako ho sondovať"):
 *
 *  - password hashes. The GoTrue admin API returns users without
 *    `encrypted_password`, so a restore recreates the accounts but everyone has
 *    to set a new password. With 3 users that is a phone call, not a disaster.
 *  - anything outside `public` + auth users + storage: pg_cron schedules,
 *    RLS policies, grants, functions. All of those are in migrations, except
 *    the pg_cron jobs and `app_settings`, and `app_settings` IS a public table
 *    and therefore in here.
 *
 * Run:
 *   node --env-file=~/ticketio-secrets.env scripts/backup-db.ts
 *   node --env-file=~/ticketio-secrets.env scripts/backup-db.ts --dry-run
 *
 * Flags: --out <dir> (default ~/backups/db), --keep <n> (default 14),
 *        --tables a,b (subset), --dry-run (counts only, writes nothing),
 *        --quiet (one summary line; for cron).
 *
 * Exit code is non-zero if any table failed or came out short, so cron mail and
 * the log say so instead of leaving a truncated directory that looks fine.
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Rows asked for per request. PostgREST caps this server-side (`db-max-rows`,
 * 1000 on Supabase cloud) and answers a short page without saying so, which is
 * why the dump loop below stops on an EMPTY page and never on a short one.
 */
const PAGE_SIZE = 1000

/**
 * Pagination key, in order of preference. Every public table currently has a
 * single-column primary key and all of them are in this list; the fallback is
 * only there so a new table without one still gets dumped (loudly).
 */
const KEY_PREFERENCE = ['id', 'key', 'user_id', 'day', 'created_at']

type Column = { name: string; fk: string | null }
type Table = { name: string; columns: Column[]; refs: string[] }

type TableResult = {
  table: string
  rows: number
  expected: number
  bytes: number
  sha256: string
  key: string
}

type Options = {
  out: string
  keep: number
  tables: string[] | null
  dryRun: boolean
  quiet: boolean
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    out: path.join(homedir(), 'backups', 'db'),
    keep: 14,
    tables: null,
    dryRun: false,
    quiet: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--quiet') opts.quiet = true
    else if (arg === '--out') opts.out = path.resolve(argv[++i] ?? '')
    else if (arg === '--keep') opts.keep = Number(argv[++i])
    else if (arg === '--tables') {
      opts.tables = (argv[++i] ?? '').split(',').filter(Boolean)
    } else fail(`Neznámy prepínač: ${arg}`)
  }
  if (!Number.isInteger(opts.keep) || opts.keep < 1) {
    fail('--keep musí byť celé číslo >= 1')
  }
  if (!opts.out) fail('--out potrebuje cestu')
  return opts
}

function env(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    fail(
      'Chýba SUPABASE_URL alebo SUPABASE_SERVICE_ROLE_KEY.\n' +
        '  node --env-file=~/ticketio-secrets.env scripts/backup-db.ts',
    )
  }
  return { url: url.replace(/\/+$/, ''), key }
}

/**
 * A nightly job must not die on one dropped connection, so every request gets
 * three tries. 4xx other than 429 is not retried — that is a bug, not weather.
 */
async function request(
  url: string,
  key: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(init.headers as Record<string, string> | undefined),
  }
  let lastError = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers })
      if (res.ok || (res.status < 500 && res.status !== 429)) return res
      lastError = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt < 3) await sleep(attempt * 3000)
  }
  throw new Error(`${url.split('?')[0]} zlyhalo po 3 pokusoch: ${lastError}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  )
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * The OpenAPI spec at /rest/v1/ lists every table PostgREST exposes, its
 * columns, and — inside the column description, as `<fk table='x' column='y'/>`
 * — its foreign keys. That is the whole schema map this script needs, and it is
 * always current, which a hardcoded list would not be.
 */
async function discover(url: string, key: string): Promise<Table[]> {
  const res = await request(`${url}/rest/v1/`, key, {
    headers: { Accept: 'application/openapi+json' },
  })
  if (!res.ok) throw new Error(`OpenAPI spec: HTTP ${res.status}`)
  const spec = (await res.json()) as {
    definitions?: Record<
      string,
      { properties?: Record<string, { description?: string }> }
    >
  }
  const definitions = spec.definitions ?? {}
  const tables: Table[] = []
  for (const [name, def] of Object.entries(definitions)) {
    const columns: Column[] = Object.entries(def.properties ?? {}).map(
      ([column, prop]) => ({
        name: column,
        fk: /<fk table='([^']+)'/.exec(prop.description ?? '')?.[1] ?? null,
      }),
    )
    const refs = [
      ...new Set(
        columns
          .map((c) => c.fk)
          .filter((t): t is string => t !== null && t !== name),
      ),
    ]
    tables.push({ name, columns, refs })
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Tables sorted parents-first, so a restore can insert straight down the list.
 * A cycle (none today) would leave tables unplaced; they go last with a note in
 * the manifest rather than being silently dropped.
 */
function restoreOrder(tables: Table[]): { order: string[]; cyclic: string[] } {
  const pending = new Map(tables.map((t) => [t.name, new Set(t.refs)]))
  const order: string[] = []
  let progress = true
  while (pending.size > 0 && progress) {
    progress = false
    for (const [name, refs] of [...pending].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      if ([...refs].every((r) => !pending.has(r))) {
        order.push(name)
        pending.delete(name)
        progress = true
      }
    }
  }
  return { order, cyclic: [...pending.keys()] }
}

function paginationKey(table: Table): { key: string; certain: boolean } {
  const names = new Set(table.columns.map((c) => c.name))
  for (const candidate of KEY_PREFERENCE) {
    if (names.has(candidate)) {
      return { key: candidate, certain: candidate !== 'created_at' }
    }
  }
  return { key: table.columns[0]?.name ?? 'id', certain: false }
}

// ---------------------------------------------------------------------------
// Dumping
// ---------------------------------------------------------------------------

async function countRows(
  url: string,
  key: string,
  table: string,
): Promise<number> {
  const res = await request(`${url}/rest/v1/${table}?select=*`, key, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', Range: '0-0' },
  })
  if (!res.ok) throw new Error(`count ${table}: HTTP ${res.status}`)
  const total = res.headers.get('content-range')?.split('/')[1]
  if (!total || total === '*')
    throw new Error(`count ${table}: bez Content-Range`)
  return Number(total)
}

/**
 * Keyset pagination, not offset: rows written while the dump runs shift every
 * offset after them, which silently duplicates and skips rows. Ordering by a
 * unique key and asking for "greater than the last one I saw" cannot do that.
 */
async function* dumpRows(
  url: string,
  key: string,
  table: string,
  pageKey: string,
): AsyncGenerator<{ line: string; last: unknown }> {
  let cursor: unknown = null
  for (;;) {
    // The cursor value goes in RAW (url-encoded, not quoted). PostgREST's
    // double-quoted form is a trap here: on a uuid column it reaches Postgres
    // with the quotes still in the literal and 400s (22P02), and on a text
    // column the comparison quietly matches every row — which is an infinite
    // loop, not an error.
    const filter =
      cursor === null
        ? ''
        : `&${pageKey}=gt.${encodeURIComponent(String(cursor))}`
    const res = await request(
      `${url}/rest/v1/${table}?select=*&order=${pageKey}.asc&limit=${PAGE_SIZE}${filter}`,
      key,
    )
    if (!res.ok) {
      throw new Error(
        `${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
      )
    }
    const rows = (await res.json()) as Record<string, unknown>[]
    if (rows.length === 0) return
    for (const row of rows)
      yield { line: `${JSON.stringify(row)}\n`, last: row[pageKey] }
    const next = rows[rows.length - 1][pageKey]
    if (next === null || next === undefined) {
      throw new Error(
        `${table}: stránkovací kľúč ${pageKey} je NULL, dump by cyklil`,
      )
    }
    // A cursor that does not move means the filter is not filtering. Better to
    // fail the backup than to write the same page until the disk is full.
    if (cursor !== null && String(next) === String(cursor)) {
      throw new Error(
        `${table}: kurzor sa nepohol z ${String(next)}, stránkovanie je rozbité`,
      )
    }
    cursor = next
  }
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

async function dumpTable(
  url: string,
  key: string,
  table: Table,
  dir: string,
): Promise<TableResult> {
  const { key: pageKey, certain } = paginationKey(table)
  if (!certain) {
    console.warn(
      `  ! ${table.name}: stránkujem podľa '${pageKey}', ktorý nemusí byť unikátny — over počet riadkov`,
    )
  }
  const expected = await countRows(url, key, table.name)
  const file = path.join(dir, `${table.name}.ndjson.gz`)
  let rows = 0
  const source = Readable.from(
    (async function* () {
      for await (const { line } of dumpRows(url, key, table.name, pageKey)) {
        rows++
        yield line
      }
    })(),
  )
  await pipeline(
    source,
    createGzip({ level: 6 }),
    createWriteStream(file, { mode: 0o600 }),
  )
  const { size } = await stat(file)
  return {
    table: table.name,
    rows,
    expected,
    bytes: size,
    sha256: await sha256(file),
    key: pageKey,
  }
}

// ---------------------------------------------------------------------------
// Auth users and storage
// ---------------------------------------------------------------------------

/** Users come without password hashes — the admin API does not return them. */
async function dumpAuthUsers(
  url: string,
  key: string,
  dir: string,
): Promise<number> {
  const users: unknown[] = []
  for (let page = 1; ; page++) {
    const res = await request(
      `${url}/auth/v1/admin/users?page=${page}&per_page=200`,
      key,
    )
    if (!res.ok) throw new Error(`auth users: HTTP ${res.status}`)
    const body = (await res.json()) as { users?: unknown[] }
    const batch = body.users ?? []
    users.push(...batch)
    if (batch.length < 200) break
  }
  await writeFile(
    path.join(dir, 'auth-users.json'),
    JSON.stringify(users, null, 2),
    {
      mode: 0o600,
    },
  )
  return users.length
}

async function listObjects(
  url: string,
  key: string,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const found: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const res = await request(`${url}/storage/v1/object/list/${bucket}`, key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    })
    if (!res.ok) throw new Error(`storage list ${bucket}: HTTP ${res.status}`)
    const entries = (await res.json()) as { name: string; id: string | null }[]
    for (const entry of entries) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name
      // id === null marks a folder placeholder, not an object.
      if (entry.id === null)
        found.push(...(await listObjects(url, key, bucket, full)))
      else found.push(full)
    }
    if (entries.length < 1000) return found
  }
}

async function dumpStorage(
  url: string,
  key: string,
  dir: string,
): Promise<{ objects: number; bytes: number }> {
  const res = await request(`${url}/storage/v1/bucket`, key)
  if (!res.ok) throw new Error(`storage buckets: HTTP ${res.status}`)
  const buckets = (await res.json()) as { name: string }[]
  let objects = 0
  let bytes = 0
  for (const bucket of buckets) {
    for (const objectPath of await listObjects(url, key, bucket.name, '')) {
      const target = path.join(dir, bucket.name, objectPath)
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      const download = await request(
        `${url}/storage/v1/object/${bucket.name}/${objectPath.split('/').map(encodeURIComponent).join('/')}`,
        key,
      )
      if (!download.ok || !download.body) {
        throw new Error(
          `storage ${bucket.name}/${objectPath}: HTTP ${download.status}`,
        )
      }
      await pipeline(
        Readable.fromWeb(download.body as never),
        createWriteStream(target, { mode: 0o600 }),
      )
      bytes += (await stat(target)).size
      objects++
    }
  }
  return { objects, bytes }
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Only ever deletes directories this script made: <out>/<8 digits>-<6 digits>,
 * and only those carrying a manifest.json — a run without one was interrupted,
 * and deleting a good old backup to make room for a broken new one is the one
 * thing retention must never do.
 */
async function prune(out: string, keep: number, quiet: boolean): Promise<void> {
  const entries = await readdir(out, { withFileTypes: true })
  const complete: string[] = []
  const abandoned: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{8}-\d{6}$/.test(entry.name)) continue
    const dir = path.join(out, entry.name)
    const done = await stat(path.join(dir, 'manifest.json')).then(
      () => true,
      () => false,
    )
    if (done) complete.push(entry.name)
    // No manifest and untouched for hours: a run that died. A run still going
    // (someone started one by hand) is left alone — hence the age check.
    else if (Date.now() - (await stat(dir)).mtimeMs > 6 * 3600 * 1000) {
      abandoned.push(entry.name)
    }
  }
  complete.sort()
  const drop = [
    ...complete.slice(0, Math.max(0, complete.length - keep)),
    ...abandoned,
  ]
  for (const old of drop) {
    await rm(path.join(out, old), { recursive: true, force: true })
    if (!quiet) console.log(`  – zmazaná stará záloha ${old}`)
  }
}

async function deployedCommit(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(import.meta.dirname, '..'),
    })
    return stdout.trim()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const { url, key } = env()
  const projectRef = new URL(url).hostname.split('.')[0]
  const started = new Date()
  const log = (line: string) => {
    if (!opts.quiet) console.log(line)
  }

  log(`\nZáloha Ticketio DB — projekt ${projectRef}`)

  let tables = await discover(url, key)
  if (opts.tables) {
    const known = new Set(tables.map((t) => t.name))
    const unknown = opts.tables.filter((t) => !known.has(t))
    if (unknown.length > 0) fail(`Neznáme tabuľky: ${unknown.join(', ')}`)
    tables = tables.filter((t) => opts.tables!.includes(t.name))
  }
  log(`Tabuliek: ${tables.length}`)

  if (opts.dryRun) {
    let total = 0
    for (const table of tables) {
      const rows = await countRows(url, key, table.name)
      total += rows
      log(`  ${table.name.padEnd(24)} ${String(rows).padStart(8)} riadkov`)
    }
    log(`\nDry run — nič sa nezapísalo. Spolu ${total} riadkov.\n`)
    return
  }

  const runDir = path.join(opts.out, stamp(started))
  const tablesDir = path.join(runDir, 'tables')
  const storageDir = path.join(runDir, 'storage')
  await mkdir(tablesDir, { recursive: true, mode: 0o700 })
  await mkdir(storageDir, { recursive: true, mode: 0o700 })

  const results: TableResult[] = []
  const failures: string[] = []
  for (const table of tables) {
    try {
      const result = await dumpTable(url, key, table, tablesDir)
      results.push(result)
      const short = result.rows < result.expected
      log(
        `  ${short ? '!' : '✓'} ${table.name.padEnd(24)} ${String(result.rows).padStart(8)} riadkov  ${human(result.bytes).padStart(9)}` +
          (short ? `  ← čakal som ${result.expected}` : ''),
      )
      if (short) {
        failures.push(
          `${table.name}: ${result.rows} z ${result.expected} riadkov`,
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`  ✖ ${table.name}: ${message}`)
      failures.push(`${table.name}: ${message}`)
    }
  }

  let authUsers = 0
  let storage = { objects: 0, bytes: 0 }
  try {
    authUsers = await dumpAuthUsers(url, key, runDir)
    log(
      `  ✓ auth.users               ${String(authUsers).padStart(8)} účtov (bez hesiel)`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`  ✖ auth.users: ${message}`)
    failures.push(`auth.users: ${message}`)
  }
  try {
    storage = await dumpStorage(url, key, storageDir)
    log(
      `  ✓ storage                  ${String(storage.objects).padStart(8)} súborov  ${human(storage.bytes).padStart(9)}`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`  ✖ storage: ${message}`)
    failures.push(`storage: ${message}`)
  }

  const { order, cyclic } = restoreOrder(tables)
  const totalBytes =
    results.reduce((sum, r) => sum + r.bytes, 0) + storage.bytes
  const totalRows = results.reduce((sum, r) => sum + r.rows, 0)
  await writeFile(
    path.join(runDir, 'manifest.json'),
    `${JSON.stringify(
      {
        startedAt: started.toISOString(),
        finishedAt: new Date().toISOString(),
        projectRef,
        gitCommit: await deployedCommit(),
        format: 'ndjson.gz, jeden JSON objekt na riadok, gzip',
        totals: {
          tables: results.length,
          rows: totalRows,
          bytes: totalBytes,
          authUsers,
          storageObjects: storage.objects,
        },
        restoreOrder: order,
        cyclicTables: cyclic,
        tables: results,
        failures,
        notes: [
          'Schéma tu nie je — je v supabase/migrations, obnova ide cez ne.',
          'auth-users.json je bez password hashov (GoTrue admin API ich nevracia) — po obnove musia používatelia nastaviť nové heslo.',
          'pg_cron joby a app_settings sekvencia: app_settings je v zálohe, pg_cron joby nie (nie sú v schéme public).',
        ],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  )

  await prune(opts.out, opts.keep, opts.quiet)

  const seconds = Math.round((Date.now() - started.getTime()) / 1000)
  const summary =
    `${started.toISOString()} záloha ${path.basename(runDir)}: ` +
    `${results.length} tabuliek, ${totalRows} riadkov, ${human(totalBytes)}, ${seconds} s` +
    (failures.length > 0 ? ` — ${failures.length} CHÝB` : '')
  console.log(opts.quiet ? summary : `\n${summary}\n→ ${runDir}\n`)

  if (failures.length > 0) {
    console.error(`Chyby:\n${failures.map((f) => `  - ${f}`).join('\n')}`)
    process.exit(1)
  }
}

main().catch((err) => {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err))
})
