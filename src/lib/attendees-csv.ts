/**
 * Build the attendees CSV (one row per ticket, with custom-field answers as
 * columns). Pure — testable. Excel-friendly: UTF-8 BOM + ';' delimiter.
 */

export interface AttendeeRow {
  ref: string
  typeName: string
  holderName: string | null
  holderEmail: string | null
  /** field label -> answer value */
  answers: Record<string, string>
}

function cell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function buildAttendeesCsv(attendees: AttendeeRow[]): string {
  // Answer columns: distinct labels in first-seen order.
  const labels: string[] = []
  for (const a of attendees) {
    for (const l of Object.keys(a.answers)) {
      if (!labels.includes(l)) labels.push(l)
    }
  }
  const header = ['Číslo', 'Typ', 'Meno', 'E-mail', ...labels]
  const rows = attendees.map((a) =>
    [
      a.ref,
      a.typeName,
      a.holderName ?? '',
      a.holderEmail ?? '',
      ...labels.map((l) => a.answers[l] ?? ''),
    ]
      .map(cell)
      .join(';'),
  )
  return '﻿' + [header.map(cell).join(';'), ...rows].join('\r\n')
}
