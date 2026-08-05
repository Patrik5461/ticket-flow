/**
 * Copy the nightly database backups to a Hetzner Storage Box.
 *
 * scripts/backup-db.ts solved "Supabase keeps no backups". It did not solve the
 * other half: the backups, the database dump they came from, and the MaxiTicket
 * hall export all sit on this one VM. A dead disk, a wrong `rm -rf`, or a
 * ransomed machine still took every copy at once. This is the second location.
 *
 * Design notes, both of which are the point rather than details:
 *
 *  - NO `--delete`. rsync's usual mirroring is exactly wrong here. If something
 *    wipes ~/backups locally — the failure this exists to survive — a mirroring
 *    sync would faithfully reproduce the wipe off-site on the next run, and the
 *    second copy would be gone within a day of the first. Files are only ever
 *    added remotely. At ~17 MB a night that is ~6 GB a year, against a 1 TB box.
 *
 *  - Interrupted runs are skipped. A backup directory without manifest.json is
 *    a run that died halfway (backup-db.ts writes the manifest last), so it is
 *    not a backup and has no business taking up the off-site slot. Only
 *    complete runs are offered to rsync.
 *
 * Verification is a second rsync in --dry-run mode: if the copy is complete, it
 * has nothing left to transfer. That asks rsync itself rather than trusting the
 * exit code, and it works without needing a real shell on the far end — a
 * Storage Box only offers a restricted one.
 *
 * Configuration lives in ~/ticketio-secrets.env, never in the repo:
 *
 *   OFFSITE_HOST=u123456.your-storagebox.de
 *   OFFSITE_USER=u123456
 *   OFFSITE_PORT=23                        # Storage Box SSH is 23, not 22
 *   OFFSITE_PATH=backups/ticketio          # relative to the box's home
 *   OFFSITE_SSH_KEY=/home/patrik/.ssh/id_ed25519_storagebox
 *
 * Use a key of its own, not the GitHub deploy key: two services that can reach
 * each other's credentials is how one compromise becomes two.
 *
 * Run:
 *   node --env-file=$HOME/ticketio-secrets.env scripts/sync-backups-offsite.ts
 *   node --env-file=$HOME/ticketio-secrets.env scripts/sync-backups-offsite.ts --dry-run
 *
 * Flags: --src <dir> (default ~/backups/db), --dry-run (transfers nothing),
 *        --quiet (one summary line; for cron).
 *
 * Exits non-zero when the sync fails or the verification pass still finds work
 * to do, so cron mail and the log say so instead of reporting a copy that isn't
 * one.
 */

import { spawn } from 'node:child_process'
import { readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

interface Config {
  host: string
  user: string
  port: string
  path: string
  key: string
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const DRY = process.argv.includes('--dry-run')
const QUIET = process.argv.includes('--quiet')
const SRC = arg('src', join(homedir(), 'backups', 'db'))

function log(msg: string): void {
  if (!QUIET) console.log(msg)
}

function fail(msg: string): never {
  console.error(`[sync-offsite] ${msg}`)
  process.exit(1)
}

/** Config from the environment, with the setup spelled out when it is missing. */
function readConfig(): Config {
  const host = process.env.OFFSITE_HOST
  const user = process.env.OFFSITE_USER
  if (!host || !user) {
    fail(
      'OFFSITE_HOST/OFFSITE_USER nie sú nastavené. Doplň do ~/ticketio-secrets.env:\n' +
        '  OFFSITE_HOST=u123456.your-storagebox.de\n' +
        '  OFFSITE_USER=u123456\n' +
        '  OFFSITE_PORT=23\n' +
        '  OFFSITE_PATH=backups/ticketio\n' +
        '  OFFSITE_SSH_KEY=/home/patrik/.ssh/id_ed25519_storagebox',
    )
  }
  const key =
    process.env.OFFSITE_SSH_KEY ?? join(homedir(), '.ssh', 'id_ed25519')
  if (!existsSync(key)) fail(`SSH kľúč ${key} neexistuje.`)
  return {
    host,
    user,
    port: process.env.OFFSITE_PORT ?? '23',
    path: process.env.OFFSITE_PATH ?? 'backups/ticketio',
    key,
  }
}

/**
 * The run directories worth copying: those that finished.
 *
 * backup-db.ts writes manifest.json last, so its absence marks a run that was
 * cut short. Retention deletes those locally after six hours; until then they
 * would otherwise be copied off-site and sit there looking like backups.
 */
function completeRuns(src: string): string[] {
  if (!existsSync(src)) fail(`Zdrojový adresár ${src} neexistuje.`)
  const all = readdirSync(src).filter((d) =>
    statSync(join(src, d)).isDirectory(),
  )
  const done = all.filter((d) => existsSync(join(src, d, 'manifest.json')))
  const skipped = all.length - done.length
  if (skipped > 0) {
    log(
      `[sync-offsite] preskakujem ${skipped} prerušených behov (bez manifest.json)`,
    )
  }
  return done.sort()
}

function rsyncArgs(cfg: Config, runs: string[], dryRun: boolean): string[] {
  const ssh = `ssh -p ${cfg.port} -i ${cfg.key} -o StrictHostKeyChecking=accept-new`
  return [
    '-a',
    '--relative',
    '--partial',
    '--stats',
    ...(dryRun ? ['--dry-run'] : []),
    '-e',
    ssh,
    // --relative with a `.` marker keeps the run directory as the path that
    // lands remotely, without recreating the whole /home/patrik/backups tree.
    ...runs.map((r) => `${SRC}/./${r}`),
    `${cfg.user}@${cfg.host}:${cfg.path}/`,
  ]
}

function run(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn('rsync', args)
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ code: code ?? 1, out }))
  })
}

/** "Number of regular files transferred: 12" out of --stats. */
function transferred(out: string): number {
  const m = out.match(/Number of regular files transferred:\s*([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, '')) : -1
}

async function main(): Promise<void> {
  const cfg = readConfig()
  const runs = completeRuns(SRC)
  if (runs.length === 0) fail(`V ${SRC} nie je ani jedna dokončená záloha.`)
  log(
    `[sync-offsite] ${runs.length} záloh → ${cfg.user}@${cfg.host}:${cfg.path}/`,
  )

  const sync = await run(rsyncArgs(cfg, runs, DRY))
  if (sync.code !== 0) {
    console.error(sync.out)
    fail(`rsync zlyhal (exit ${sync.code}).`)
  }
  const sent = transferred(sync.out)
  log(sync.out.trim())

  if (DRY) {
    console.log(`[sync-offsite] dry-run: preniesol by ${sent} súborov`)
    return
  }

  // Ask rsync whether anything is still outstanding. A completed copy has
  // nothing left to send; anything else means the transfer was partial and the
  // off-site copy must not be reported as good.
  const check = await run(rsyncArgs(cfg, runs, true))
  if (check.code !== 0) {
    console.error(check.out)
    fail(`overovací beh zlyhal (exit ${check.code}).`)
  }
  const left = transferred(check.out)
  if (left !== 0) {
    console.error(check.out)
    fail(`po synchronizácii ostáva ${left} neprenesených súborov.`)
  }

  console.log(
    `${new Date().toISOString()} off-site sync: ${runs.length} záloh, ` +
      `${sent} nových súborov, overené`,
  )
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
