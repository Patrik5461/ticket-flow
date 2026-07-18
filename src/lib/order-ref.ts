/** Human order reference = first 8 chars of the id, uppercased. Pure. */
export function orderRef(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

/** Case-insensitive match of a user-provided ref against an order id. */
export function refMatches(id: string, provided: string): boolean {
  return orderRef(id) === provided.trim().toUpperCase()
}

/** Mask an e-mail for display: "jana@x.sk" → "ja***@x.sk". */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at < 1) return '***'
  const user = email.slice(0, at)
  const domain = email.slice(at + 1)
  const head = user.length <= 2 ? user.slice(0, 1) : user.slice(0, 2)
  return `${head}***@${domain}`
}
