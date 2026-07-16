/**
 * Excel-friendly CSV building. UTF-8 BOM (correct diacritics in Excel), ';'
 * delimiter (SK/EU list separator), CRLF line endings. Pure.
 */

export function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(';'))
  return '﻿' + lines.join('\r\n')
}
