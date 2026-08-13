/**
 * Check that a backup directory contains what its manifest claims.
 *
 * backup-db.ts already refuses to finish quietly when a table comes back short,
 * but that is the writer marking its own homework: it checks what it received
 * from PostgREST, not what ended up on disk, and never again afterwards. A
 * backup nobody has read since the night it was written is a hypothesis. This
 * reads one back.
 *
 * What it verifies, per table:
 *   - the file exists, and its size and sha256 match the manifest
 *   - every line is valid JSON (a truncated gzip stream fails here)
 *   - the number of lines equals the row count recorded
 *   - the recorded count equals what the database said to expect
 *   - the pagination key is present and UNIQUE on every row
 *
 * That last one is the point. backup-db.ts pages by a column it picks per
 * table, and warns when it cannot prove the column is unique — but a warning in
 * a cron log at 03:15 is not read by anyone. A duplicate key means the cursor
 * can step over rows, so the file is short in a way row counts alone would not
 * reveal if the count was taken the same wrong way.
 *
 * And across the whole backup: restoreOrder covers exactly the tables present,
 * the auth users and storage objects are there in the promised number, and the
 * failures list is empty.
 *
 * This does NOT prove a restore works — that needs an empty project to restore
 * into. It proves the bytes are intact and internally consistent, which is the
 * half that can be checked every night for free.
 *
 * Run:
 *   node scripts/verify-backup.ts                    # newest under ~/backups/db
 *   node scripts/verify-backup.ts <dir>
 *   node scripts/verify-backup.ts --all              # every retained backup
 *
 * Exit code 0 = trustworthy, 1 = something is wrong. No network, no secrets.
 */

import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'

interface TableEntry {
  table: string
  rows: number
  expected: number
  bytes: number
  sha256: string
  key: string
}

interface Manifest {
  startedAt: string
  finishedAt: string
  projectRef: string
  gitCommit: string
  totals: {
    tables: number
    rows: number
    bytes: number
    authUsers: number
    storageObjects: number
  }
  restoreOrder: string[]
  tables: Record<string, TableEntry>
  failures: unknown[]
}

const DEFAULT_ROOT = `${process.env.HOME}/backups/db`

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

/** Read the gzipped ndjson back, one line at a time. */
async function readTable(
  file: string,
  keyColumn: string,
): Promise<{
  lines: number
  badJson: number
  missingKey: number
  dupes: number
}> {
  const rl = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  })
  const seen = new Set<string>()
  let lines = 0
  let badJson = 0
  let missingKey = 0
  let dupes = 0
  for await (const line of rl) {
    if (line.trim() === '') continue
    lines++
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      badJson++
      continue
    }
    const v = row[keyColumn]
    if (v === undefined || v === null) {
      missingKey++
      continue
    }
    const k = String(v)
    if (seen.has(k)) dupes++
    else seen.add(k)
  }
  return { lines, badJson, missingKey, dupes }
}

async function verify(dir: string): Promise<string[]> {
  const problems: string[] = []
  const say = (s: string) => problems.push(`${path.basename(dir)}: ${s}`)

  let manifest: Manifest
  try {
    manifest = JSON.parse(
      await readFile(path.join(dir, 'manifest.json'), 'utf8'),
    ) as Manifest
  } catch (e) {
    // A directory without a manifest is an interrupted run, not a backup —
    // the manifest is written last, on purpose.
    say(
      `manifest.json sa nedá prečítať (${msg(e)}) — prerušený beh, nie záloha`,
    )
    return problems
  }

  if (manifest.failures.length > 0) {
    say(`manifest hlási ${manifest.failures.length} zlyhaní počas zálohovania`)
  }

  const names = Object.values(manifest.tables).map((t) => t.table)
  const inOrder = new Set(manifest.restoreOrder)
  for (const n of names) {
    if (!inOrder.has(n))
      say(`${n} chýba v restoreOrder — nebolo by kam ju vložiť`)
  }
  for (const n of manifest.restoreOrder) {
    if (!names.includes(n))
      say(`restoreOrder spomína ${n}, ktorá v zálohe nie je`)
  }

  let rowSum = 0
  for (const t of Object.values(manifest.tables)) {
    const file = path.join(dir, 'tables', `${t.table}.ndjson.gz`)
    let size: number
    try {
      size = (await stat(file)).size
    } catch {
      say(`${t.table}: súbor chýba`)
      continue
    }
    if (size !== t.bytes) {
      say(`${t.table}: veľkosť ${size} B, manifest hovorí ${t.bytes} B`)
    }
    const digest = await sha256File(file)
    if (digest !== t.sha256) {
      say(
        `${t.table}: sha256 nesedí — súbor sa po zálohe zmenil alebo je poškodený`,
      )
      continue // no point reading a file we know is not the one that was written
    }

    const r = await readTable(file, t.key)
    rowSum += r.lines
    if (r.badJson > 0)
      say(`${t.table}: ${r.badJson} riadkov nie je platný JSON`)
    if (r.lines !== t.rows) {
      say(`${t.table}: v súbore ${r.lines} riadkov, manifest hovorí ${t.rows}`)
    }
    if (t.rows !== t.expected) {
      say(`${t.table}: zálohovaných ${t.rows} z ${t.expected} riadkov v DB`)
    }
    if (r.missingKey > 0) {
      say(
        `${t.table}: ${r.missingKey} riadkov nemá stránkovací kľúč '${t.key}'`,
      )
    }
    if (r.dupes > 0) {
      // Paging by a non-unique column can step over rows, so the file may be
      // short in a way the row count cannot show.
      say(
        `${t.table}: stránkovací kľúč '${t.key}' sa opakuje ${r.dupes}× — záloha môže byť neúplná`,
      )
    }
  }

  if (rowSum !== manifest.totals.rows) {
    say(`spolu ${rowSum} riadkov, manifest hovorí ${manifest.totals.rows}`)
  }

  try {
    const users = JSON.parse(
      await readFile(path.join(dir, 'auth-users.json'), 'utf8'),
    ) as unknown[]
    if (users.length !== manifest.totals.authUsers) {
      say(
        `auth-users.json má ${users.length} používateľov, manifest hovorí ${manifest.totals.authUsers}`,
      )
    }
  } catch (e) {
    say(`auth-users.json sa nedá prečítať: ${msg(e)}`)
  }

  const objects = await countFiles(path.join(dir, 'storage'))
  if (objects !== manifest.totals.storageObjects) {
    say(
      `v storage/ je ${objects} súborov, manifest hovorí ${manifest.totals.storageObjects}`,
    )
  }

  return problems
}

async function countFiles(dir: string): Promise<number> {
  let n = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    if (e.isDirectory()) n += await countFiles(path.join(dir, e.name))
    else n++
  }
  return n
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function newestBackup(root: string): Promise<string | null> {
  try {
    const dirs = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
    return dirs.length > 0 ? path.join(root, dirs[dirs.length - 1]) : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const all = args.includes('--all')
  const explicit = args.find((a) => !a.startsWith('--'))

  let dirs: string[]
  if (explicit) {
    dirs = [explicit]
  } else if (all) {
    dirs = (await readdir(DEFAULT_ROOT, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => path.join(DEFAULT_ROOT, d.name))
      .sort()
  } else {
    const newest = await newestBackup(DEFAULT_ROOT)
    if (!newest) {
      console.error(`Žiadna záloha v ${DEFAULT_ROOT}`)
      process.exit(1)
    }
    dirs = [newest]
  }

  const problems: string[] = []
  for (const dir of dirs) {
    const found = await verify(dir)
    problems.push(...found)
    console.log(
      `${path.basename(dir)}: ${found.length === 0 ? 'v poriadku' : `${found.length} problém(ov)`}`,
    )
  }

  if (problems.length > 0) {
    console.error('')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log(`\nOverené: ${dirs.length} záloh(y), bez chyby.`)
}

await main()
