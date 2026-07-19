/**
 * Branded email templates. Pure — each returns { subject, html } (or an html
 * fragment), so they are unit-testable and free of DB/vendor concerns. Callers
 * pass already-formatted labels (dates, money) to keep this module dependency-light.
 *
 * Emails use a light, mobile-friendly layout with inline styles (email clients
 * strip <style>). All caller-supplied text is HTML-escaped.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const ACCENT = '#4f46e5'
const INK = '#18181b'
const MUTED = '#71717a'
const BG = '#f4f4f5'

/** Wrap content in the Ticketio email shell. `contentHtml` is trusted markup. */
export function emailLayout(opts: {
  heading: string
  contentHtml: string
  preheader?: string
}): string {
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.preheader)}</div>`
    : ''
  return `<!doctype html>
<html lang="sk"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;background:${BG};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
      <tr><td style="padding:8px 4px 16px">
        <span style="font-size:18px;font-weight:700;color:${INK}">Ticketio</span>
      </td></tr>
      <tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;padding:28px">
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${INK}">${escapeHtml(opts.heading)}</h1>
        ${opts.contentHtml}
      </td></tr>
      <tr><td style="padding:16px 4px;color:${MUTED};font-size:12px">
        Ticketio — predaj vstupeniek.<br/>
        Ak ste túto správu nečakali, ignorujte ju.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:10px;font-size:14px">${escapeHtml(label)}</a>`
}

function p(html: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${INK}">${html}</p>`
}
function muted(html: string): string {
  return `<p style="margin:14px 0 0;font-size:12px;color:${MUTED}">${html}</p>`
}
function eventLine(
  title: string,
  whenLabel: string,
  venue?: string | null,
): string {
  return `<div style="margin:0 0 16px;padding:12px 14px;background:${BG};border-radius:10px">
    <div style="font-weight:600;font-size:15px">${escapeHtml(title)}</div>
    <div style="color:${MUTED};font-size:13px">${escapeHtml(whenLabel)}${venue ? ` · ${escapeHtml(venue)}` : ''}</div>
  </div>`
}

export interface RenderedEmail {
  subject: string
  html: string
}

/** One ticket's QR block for the tickets email (qrDataUrl is a data: URI). */
export function ticketBlockHtml(
  typeName: string,
  qrDataUrl: string,
  wallet?: { appleUrl?: string | null; googleUrl?: string | null },
  seatLabel?: string | null,
): string {
  const walletBtns: string[] = []
  if (wallet?.appleUrl) {
    walletBtns.push(
      `<a href="${escapeHtml(wallet.appleUrl)}" style="display:inline-block;margin:0 4px;padding:8px 12px;border-radius:8px;background:#000;color:#fff;text-decoration:none;font-size:12px">Apple Wallet</a>`,
    )
  }
  if (wallet?.googleUrl) {
    walletBtns.push(
      `<a href="${escapeHtml(wallet.googleUrl)}" style="display:inline-block;margin:0 4px;padding:8px 12px;border-radius:8px;background:#4285f4;color:#fff;text-decoration:none;font-size:12px">Google Wallet</a>`,
    )
  }
  return `<div style="margin:0 0 16px;text-align:center">
    <div style="font-weight:600;font-size:14px;margin-bottom:6px">${escapeHtml(typeName)}</div>
    ${seatLabel ? `<div style="font-size:12px;color:#555;margin-bottom:6px">Sedadlo: ${escapeHtml(seatLabel)}</div>` : ''}
    <img src="${qrDataUrl}" width="180" height="180" alt="QR" style="border-radius:8px"/>
    ${walletBtns.length ? `<div style="margin-top:8px">${walletBtns.join('')}</div>` : ''}
  </div>`
}

export function ticketsEmail(d: {
  eventTitle: string
  whenLabel: string
  venue?: string | null
  orderRef: string
  ticketsHtml: string
}): RenderedEmail {
  return {
    subject: `Vstupenky — ${d.eventTitle}`,
    html: emailLayout({
      heading: 'Ďakujeme za nákup 🎉',
      preheader: `Vaše vstupenky na ${d.eventTitle}`,
      contentHtml:
        p(
          'Vaše vstupenky sú pripravené — nájdete ich nižšie aj v priloženom PDF.',
        ) +
        eventLine(d.eventTitle, d.whenLabel, d.venue) +
        d.ticketsHtml +
        muted(`Objednávka ${escapeHtml(d.orderRef)}`),
    }),
  }
}

export function orderPendingEmail(d: {
  eventTitle: string
  whenLabel: string
  orderRef: string
  totalLabel: string
  orderUrl: string
}): RenderedEmail {
  return {
    subject: `Objednávka čaká na platbu — ${d.eventTitle}`,
    html: emailLayout({
      heading: 'Ešte krôčik k vstupenkám',
      preheader: `Dokončite platbu za ${d.eventTitle}`,
      contentHtml:
        p(
          `Vašu objednávku sme prijali, čaká na zaplatenie sumy <strong>${escapeHtml(d.totalLabel)}</strong>. Rezerváciu držíme 15 minút.`,
        ) +
        eventLine(d.eventTitle, d.whenLabel) +
        p(button(d.orderUrl, 'Zaplatiť teraz')) +
        muted(`Objednávka ${escapeHtml(d.orderRef)}`),
    }),
  }
}

export function refundEmail(d: {
  eventTitle: string
  orderRef: string
  amountLabel: string
  full: boolean
}): RenderedEmail {
  return {
    subject: `Refundácia — ${d.eventTitle}`,
    html: emailLayout({
      heading: d.full ? 'Objednávka bola refundovaná' : 'Čiastočná refundácia',
      contentHtml:
        p(
          d.full
            ? 'Vaša objednávka bola plne refundovaná.'
            : 'Časť vašej objednávky bola refundovaná.',
        ) +
        p(`Refundovaná suma: <strong>${escapeHtml(d.amountLabel)}</strong>`) +
        muted(
          `Objednávka ${escapeHtml(d.orderRef)}. Peniaze sa vrátia na pôvodný platobný prostriedok, spracovanie môže trvať niekoľko dní.`,
        ),
    }),
  }
}

export function eventCancelledEmail(d: {
  eventTitle: string
  orderRef: string
  amountLabel: string
}): RenderedEmail {
  return {
    subject: `Podujatie zrušené — ${d.eventTitle}`,
    html: emailLayout({
      heading: 'Podujatie bolo zrušené',
      contentHtml:
        p(
          `Podujatie <strong>${escapeHtml(d.eventTitle)}</strong> bolo zrušené a vašu platbu vám vraciame v plnej výške.`,
        ) +
        p(`Refundovaná suma: <strong>${escapeHtml(d.amountLabel)}</strong>`) +
        muted(
          `Objednávka ${escapeHtml(d.orderRef)}. Peniaze sa vrátia na pôvodný platobný prostriedok, spracovanie môže trvať niekoľko dní.`,
        ),
    }),
  }
}

export function eventChangedEmail(d: {
  eventTitle: string
  whenLabel: string
  venue?: string | null
  changesHtml: string
  orderUrl?: string
}): RenderedEmail {
  return {
    subject: `Zmena podujatia — ${d.eventTitle}`,
    html: emailLayout({
      heading: 'Zmena vo vašom podujatí',
      contentHtml:
        p('Organizátor upravil detaily podujatia, na ktoré máte vstupenky:') +
        d.changesHtml +
        eventLine(d.eventTitle, d.whenLabel, d.venue) +
        (d.orderUrl ? p(button(d.orderUrl, 'Zobraziť objednávku')) : ''),
    }),
  }
}

export function reminderEmail(d: {
  eventTitle: string
  whenLabel: string
  venue?: string | null
  orderUrl: string
}): RenderedEmail {
  return {
    subject: `Pripomienka — ${d.eventTitle} už čoskoro`,
    html: emailLayout({
      heading: 'Vaše podujatie je už čoskoro ⏰',
      preheader: `${d.eventTitle} — ${d.whenLabel}`,
      contentHtml:
        p(
          'Pripomíname, že vaše podujatie sa blíži. Nezabudnite si vstupenky.',
        ) +
        eventLine(d.eventTitle, d.whenLabel, d.venue) +
        p(button(d.orderUrl, 'Zobraziť vstupenky')),
    }),
  }
}

export function waitlistEmail(d: {
  eventTitle: string
  typeName: string
  link: string
  windowMinutes: number
}): RenderedEmail {
  return {
    subject: `Uvoľnila sa vstupenka — ${d.eventTitle}`,
    html: emailLayout({
      heading: 'Uvoľnila sa vstupenka 🎟️',
      preheader: `${d.typeName} — ${d.eventTitle}`,
      contentHtml:
        p(
          `Pre podujatie <strong>${escapeHtml(d.eventTitle)}</strong> sa uvoľnila kapacita typu <strong>${escapeHtml(d.typeName)}</strong>.`,
        ) +
        p(
          `Dokončite nákup do <strong>${d.windowMinutes} minút</strong> — potom ponuku dostane ďalší v poradí.`,
        ) +
        p(button(d.link, 'Kúpiť vstupenku')) +
        muted('Miesto nie je rezervované, kým nedokončíte objednávku.'),
    }),
  }
}

export function payoutStatusEmail(d: {
  status: 'approved' | 'paid' | 'rejected'
  amountLabel: string
  note?: string | null
}): RenderedEmail {
  const map = {
    approved: {
      heading: 'Žiadosť o vyplatenie schválená ✅',
      line: `Vaša žiadosť o vyplatenie ${d.amountLabel} bola schválená. Peniaze vám čoskoro pošleme na účet.`,
    },
    paid: {
      heading: 'Vyplatenie odoslané 💸',
      line: `Vyplatenie ${d.amountLabel} bolo odoslané na váš účet.`,
    },
    rejected: {
      heading: 'Žiadosť o vyplatenie zamietnutá',
      line: `Vašu žiadosť o vyplatenie ${d.amountLabel} sme zamietli.`,
    },
  }[d.status]
  return {
    subject: `Vyplatenie — ${d.amountLabel}`,
    html: emailLayout({
      heading: map.heading,
      preheader: map.line,
      contentHtml:
        p(map.line) + (d.note ? muted(`Poznámka: ${escapeHtml(d.note)}`) : ''),
    }),
  }
}

export function bulkMessageEmail(d: {
  eventTitle: string
  subject: string
  bodyText: string
}): RenderedEmail {
  const bodyHtml = escapeHtml(d.bodyText).replace(/\n/g, '<br/>')
  return {
    subject: d.subject,
    html: emailLayout({
      heading: d.subject,
      preheader: `Správa od organizátora — ${d.eventTitle}`,
      contentHtml:
        `<div style="font-size:15px;line-height:1.55;color:${INK}">${bodyHtml}</div>` +
        muted(`Táto správa sa týka podujatia ${escapeHtml(d.eventTitle)}.`),
    }),
  }
}
