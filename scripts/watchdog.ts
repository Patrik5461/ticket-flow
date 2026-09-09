/**
 * Outside-in health watchdog for Ticketio.
 *
 * This exists because nothing was watching the site. PM2 restarts the process
 * when it dies, but a process that stays up while answering 500s, a database
 * that stops responding, or a job queue that quietly stops draining are all
 * invisible until somebody happens to look at /admin/health. For a site whose
 * whole job is taking money for tickets, an unnoticed hour is lost sales.
 *
 * Deliberately NOT part of the app. It talks to Resend and PostgREST directly,
 * so it still raises the alarm when the very thing it is watching is down —
 * routing the alert through the app would mean the outage silences the alert.
 *
 * What it checks:
 *   - the app answers on localhost with status ok and db true
 *   - the public URL answers 200 (catches nginx / TLS / edge problems the
 *     localhost check cannot see)
 *   - the five job queues have nothing pending far longer than they should be
 *   - commission invoices are not stuck or out of retries
 *
 * Alert policy: a problem must survive MIN_FAILING_RUNS consecutive checks
 * before anyone is mailed — the dependencies blip, and a blip is not an
 * outage. After that: once when it is confirmed, again if the problem set
 * changes, then at most once every REPEAT_HOURS while it lasts, and once when
 * it clears. Blips below the threshold are logged and go no further. A watchdog
 * that mails about nothing is a watchdog people filter away, and then it is
 * worth nothing on the day it is right.
 *
 * Run:
 *   node --env-file=~/ticketio-secrets.env scripts/watchdog.ts
 *   node --env-file=~/ticketio-secrets.env scripts/watchdog.ts --dry-run
 *
 * Flags: --dry-run (check and print, never mail), --quiet (only print on
 * trouble), --force (mail even if the state has not changed).
 *
 * Exit code is 0 when healthy, 1 when a problem was found — so cron itself
 * also notices, independently of whether the mail got out.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const QUIET = args.includes('--quiet')
const FORCE = args.includes('--force')

const LOCAL_URL = 'http://127.0.0.1:3000/api/health'
const PUBLIC_URL = process.env.APP_URL ?? 'https://ticketio.sk'
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM
const ALERT_EMAIL = process.env.ALERT_EMAIL

const STATE_FILE = `${process.env.HOME}/.ticketio-watchdog.json`
const BACKUP_ROOT = `${process.env.HOME}/backups/db`
const REPEAT_HOURS = 6
/** A job pending longer than this means the worker is not draining it. */
const STUCK_MINUTES = 20
/** Backups run nightly; a little over a day allows for one late run. */
const BACKUP_MAX_AGE_HOURS = 26
/** Cron fires every 10 minutes; three missed slots is a real gap. */
const MAX_RUN_GAP_MINUTES = 35
/**
 * Consecutive failing runs before anyone is mailed.
 *
 * Supabase's gateway answers 504 every so often — measured over 26 days, 23
 * blips in ~3744 runs, 0.6%, while nightly backups read all 256k rows without
 * trouble and query latency sits at 50-500 ms. Mailing on the first failed poll
 * turned each of those single blips into two e-mails (problem, then recovery),
 * which is roughly 46 e-mails about nothing and exactly the boy-who-cried-wolf
 * this script was written to avoid.
 *
 * At a 10-minute interval, three runs means a problem has to hold for ~20-30
 * minutes to be worth waking someone. A genuine outage still reports; a blip
 * lands in the log and nowhere else.
 */
const MIN_FAILING_RUNS = 3
const HTTP_TIMEOUT_MS = 15_000

interface State {
  problems: string[]
  notifiedAt: string | null
  /** End of the previous run — the only trace that this thing is alive. */
  lastRunAt?: string | null
  /** Unbroken run of checks that found something. Reset by a clean run. */
  failingRuns?: number
  /** Whether the current streak has already been mailed about. */
  alerted?: boolean
}

async function readState(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as State
  } catch {
    return {
      problems: [],
      notifiedAt: null,
      lastRunAt: null,
      failingRuns: 0,
      alerted: false,
    }
  }
}

async function writeState(s: State): Promise<void> {
  await writeFile(
    STATE_FILE,
    JSON.stringify({ ...s, lastRunAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  )
}

/**
 * Report a gap since the previous run.
 *
 * Under --quiet a healthy watchdog prints nothing, so an empty log looks
 * exactly like a watchdog that never ran — the same silence this script exists
 * to remove. Recording the previous run means a cron that stopped and came back
 * says so on its next run.
 *
 * It cannot report a watchdog that is dead *right now*; nothing running on the
 * same box can. That needs an off-box dead-man's switch. This catches the
 * commoner case — a cron that was interrupted, a box that was down, a run that
 * hung — and leaves a timestamp anyone can check.
 */
function checkOwnGap(problems: string[], prev: State): void {
  if (!prev.lastRunAt) return
  const gapMin = (Date.now() - new Date(prev.lastRunAt).getTime()) / 60_000
  if (gapMin > MAX_RUN_GAP_MINUTES) {
    problems.push(
      `Watchdog nebežal ${Math.round(gapMin)} min (čaká sa každých 10) — cron bol zastavený alebo stroj mimo.`,
    )
  }
}

async function getJson(path: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`PostgREST ${path}: ${res.status}`)
  return (await res.json()) as unknown[]
}

// -- checks -----------------------------------------------------------------

async function checkApp(problems: string[]): Promise<void> {
  try {
    const res = await fetch(LOCAL_URL, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (!res.ok) {
      problems.push(`Appka na localhost odpovedá HTTP ${res.status}.`)
      return
    }
    const body = (await res.json()) as { status?: string; db?: boolean }
    if (body.status !== 'ok') {
      problems.push(`Appka hlási status "${body.status ?? '—'}" namiesto "ok".`)
    }
    if (body.db !== true) {
      problems.push('Appka sa nedostane k databáze (db: false).')
    }
  } catch (e) {
    problems.push(`Appka na localhost neodpovedá: ${msg(e)}`)
  }
}

async function checkPublic(problems: string[]): Promise<void> {
  try {
    const res = await fetch(PUBLIC_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (!res.ok) {
      problems.push(`Verejná stránka ${PUBLIC_URL} vracia HTTP ${res.status}.`)
    }
  } catch (e) {
    // Reached only when the app itself is fine, so this points at nginx, TLS
    // or the edge rather than at the application.
    problems.push(`Verejná stránka ${PUBLIC_URL} je nedostupná: ${msg(e)}`)
  }
}

/** Job tables share the pending/attempts/max_attempts shape. */
async function checkQueue(
  problems: string[],
  table: string,
  label: string,
  activeStatuses: string[],
): Promise<void> {
  const rows = (await getJson(
    `${table}?select=status,attempts,max_attempts,created_at` +
      `&status=in.(${activeStatuses.join(',')})&limit=1000`,
  )) as {
    status: string
    attempts: number
    max_attempts: number
    created_at: string
  }[]

  const cutoff = Date.now() - STUCK_MINUTES * 60_000
  let stuck = 0
  let dead = 0
  for (const r of rows) {
    if (r.status === 'failed' && r.attempts >= r.max_attempts) {
      dead++
      continue
    }
    if (new Date(r.created_at).getTime() < cutoff) stuck++
  }
  if (stuck > 0) {
    problems.push(
      `Fronta ${label}: ${stuck} úloh čaká dlhšie než ${STUCK_MINUTES} min — worker ich neodbavuje.`,
    )
  }
  if (dead > 0) {
    problems.push(
      `Fronta ${label}: ${dead} úloh vyčerpalo pokusy a nikto ich už nezoberie.`,
    )
  }
  // A short page is not the end of the data on PostgREST, so a full page means
  // the real backlog is at least this big — worth saying out loud.
  if (rows.length >= 1000) {
    problems.push(`Fronta ${label}: aspoň 1000 aktívnych úloh.`)
  }
}

async function checkInvoices(problems: string[]): Promise<void> {
  const rows = (await getJson(
    'settlements?select=invoice_status,invoice_sent_at,invoice_attempts,invoice_error' +
      '&or=(and(invoice_status.in.(none,failed),fee_cents.gt.0),' +
      'and(invoice_status.eq.created,invoice_sent_at.is.null))&limit=1000',
  )) as {
    invoice_status: string
    invoice_attempts: number
    invoice_error: string | null
  }[]

  const exhausted = rows.filter((r) => r.invoice_attempts >= 5)
  if (exhausted.length > 0) {
    const why = exhausted[0].invoice_error ?? 'bez uvedenej príčiny'
    problems.push(
      `Provízne faktúry: ${exhausted.length} settlementov vyčerpalo pokusy (${why}).`,
    )
  }
  const blocked = rows.filter(
    (r) => r.invoice_attempts < 5 && r.invoice_error?.includes('nemá e-mail'),
  )
  if (blocked.length > 0) {
    problems.push(
      `Provízne faktúry: ${blocked.length} čaká, lebo organizátor nemá e-mail.`,
    )
  }
}

/**
 * A backup cron that stops running is silent by nature — there is no error to
 * see, just an absence nobody looks for. The freshest directory has to be
 * recent AND finished; the manifest is written last, so a directory without one
 * is an interrupted run and does not count as a backup.
 */
async function checkBackups(problems: string[]): Promise<void> {
  let dirs: string[]
  try {
    dirs = (await readdir(BACKUP_ROOT, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  } catch (e) {
    problems.push(`Adresár so zálohami sa nedá prečítať: ${msg(e)}`)
    return
  }
  if (dirs.length === 0) {
    problems.push('V ~/backups/db nie je ani jedna záloha.')
    return
  }

  const newest = dirs[dirs.length - 1]
  try {
    const raw = await readFile(`${BACKUP_ROOT}/${newest}/manifest.json`, 'utf8')
    const m = JSON.parse(raw) as {
      finishedAt?: string
      failures?: unknown[]
    }
    if (!m.finishedAt) {
      problems.push(`Záloha ${newest} nemá finishedAt — prerušený beh.`)
      return
    }
    const ageH = (Date.now() - new Date(m.finishedAt).getTime()) / 3_600_000
    if (ageH > BACKUP_MAX_AGE_HOURS) {
      problems.push(
        `Posledná záloha je stará ${Math.round(ageH)} h (${newest}) — nočný cron pravdepodobne nebeží.`,
      )
    }
    if (m.failures && m.failures.length > 0) {
      problems.push(
        `Záloha ${newest} hlási ${m.failures.length} zlyhaní — je neúplná.`,
      )
    }
  } catch {
    problems.push(
      `Najnovšia záloha ${newest} nemá čitateľný manifest — prerušený beh, nie záloha.`,
    )
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// -- alerting ---------------------------------------------------------------

async function sendMail(subject: string, lines: string[]): Promise<void> {
  const html =
    `<p>${lines.map(escapeHtml).join('<br>')}</p>` +
    `<p style="color:#666;font-size:12px">Ticketio watchdog · ${new Date().toISOString()}</p>`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [ALERT_EMAIL],
      subject,
      html,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`Resend: ${res.status} ${await res.text()}`)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// -- main -------------------------------------------------------------------

function requireEnv(): string[] {
  const missing: string[] = []
  if (!SUPABASE_URL) missing.push('SUPABASE_URL')
  if (!SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!DRY_RUN) {
    if (!RESEND_API_KEY) missing.push('RESEND_API_KEY')
    if (!EMAIL_FROM) missing.push('EMAIL_FROM')
    if (!ALERT_EMAIL) missing.push('ALERT_EMAIL')
  }
  return missing
}

async function main(): Promise<void> {
  const missing = requireEnv()
  if (missing.length > 0) {
    console.error(`Chýbajú premenné: ${missing.join(', ')}`)
    process.exit(2)
  }

  // Read before the checks: the gap is measured against the previous run, and
  // the checks below take seconds of their own.
  const prev = await readState()

  const problems: string[] = []
  checkOwnGap(problems, prev)
  await checkApp(problems)
  await checkPublic(problems)
  await checkBackups(problems)
  try {
    await checkQueue(problems, 'email_jobs', 'e-maily', [
      'pending',
      'sending',
      'failed',
    ])
    await checkQueue(problems, 'refund_jobs', 'refundácie', [
      'pending',
      'processing',
      'failed',
    ])
    await checkQueue(problems, 'webhook_deliveries', 'webhooky', [
      'pending',
      'sending',
      'failed',
    ])
    await checkInvoices(problems)
  } catch (e) {
    problems.push(`Nedá sa prečítať stav front: ${msg(e)}`)
  }

  // Count consecutive failing runs, not matching problem sets: during a real
  // outage the message text moves around (a 504 names whichever table was asked
  // first), and comparing sets would restart the streak every run and never
  // reach the threshold.
  const failingRuns = problems.length > 0 ? (prev.failingRuns ?? 0) + 1 : 0
  const sustained = failingRuns >= MIN_FAILING_RUNS
  const wasAlerted = prev.alerted ?? false

  const changed =
    JSON.stringify(prev.problems.slice().sort()) !==
    JSON.stringify(problems.slice().sort())
  const lastAgeH = prev.notifiedAt
    ? (Date.now() - new Date(prev.notifiedAt).getTime()) / 3_600_000
    : Infinity
  // Only announce recovery from something that was actually announced.
  const recovered = problems.length === 0 && wasAlerted

  const stamp = new Date().toISOString()
  if (problems.length === 0) {
    if (!QUIET) console.log(`${stamp} watchdog: všetko v poriadku.`)
  } else {
    // Transient blips still get written down — just not mailed. Without the
    // timestamp the log cannot be correlated with anything afterwards.
    const kind = sustained
      ? `trvá ${failingRuns} beh(ov)`
      : `výkyv ${failingRuns}/${MIN_FAILING_RUNS}`
    console.error(`${stamp} watchdog: ${problems.length} problém(ov) [${kind}]`)
    for (const p of problems) console.error(`  - ${p}`)
  }

  // Decided separately from DRY_RUN so a dry run is a faithful simulation:
  // it reports the decision and advances the streak exactly as a real run
  // would, which is the only way to rehearse the damping without sending mail.
  const wouldMail =
    FORCE ||
    recovered ||
    (sustained && (!wasAlerted || changed || lastAgeH >= REPEAT_HOURS))
  const shouldMail = !DRY_RUN && wouldMail

  if (DRY_RUN) {
    console.log(
      wouldMail
        ? `  → ostrý beh by teraz mailoval${recovered ? ' (návrat do poriadku)' : ''}`
        : '  → ostrý beh by nemailoval',
    )
  }

  if (shouldMail) {
    try {
      if (recovered) {
        await sendMail('Ticketio: opäť v poriadku', [
          'Predtým hlásené problémy už netrvajú.',
        ])
      } else if (problems.length === 0) {
        // Only reachable via --force, which is the "prove the alerting works"
        // button; saying "0 problémov" would read like something broke.
        await sendMail('Ticketio: skúšobná kontrola v poriadku', [
          'Toto je ručne vyžiadaná skúška watchdogu (--force).',
          'Appka, verejná stránka aj všetky fronty sú v poriadku.',
        ])
      } else {
        await sendMail(`Ticketio: ${problems.length} problém(ov)`, [
          ...problems,
          '',
          `Trvá ${failingRuns} po sebe idúcich kontrol (~${failingRuns * 10} min).`,
        ])
      }
      await writeState({
        problems,
        notifiedAt: stamp,
        failingRuns,
        alerted: problems.length > 0,
      })
    } catch (e) {
      // Keep the exit code meaningful even when the mail itself fails.
      console.error(`Watchdog nevedel odoslať e-mail: ${msg(e)}`)
      await writeState({
        problems,
        notifiedAt: prev.notifiedAt,
        failingRuns,
        alerted: wasAlerted,
      })
      process.exit(1)
    }
  } else {
    await writeState({
      problems,
      // A dry run advances this too, otherwise the six-hour repeat suppression
      // never engages in a rehearsal and every simulated run looks like it
      // would mail.
      notifiedAt: DRY_RUN && wouldMail ? stamp : prev.notifiedAt,
      failingRuns,
      // A clean run ends the episode; a blip below the threshold has not
      // started one yet. In a dry run, follow what a real run would have done.
      alerted:
        problems.length > 0 && (wasAlerted || (DRY_RUN && wouldMail && !FORCE)),
    })
  }

  process.exit(problems.length > 0 ? 1 : 0)
}

await main()
