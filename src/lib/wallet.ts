/**
 * Apple Wallet (.pkpass) + Google Wallet (save JWT) generation, behind config
 * gates: with no Apple certs / Google service-account key the respective button is
 * hidden (the generator returns null). Pure builders (buildApplePassJson,
 * buildGoogleWalletObject, signJwtRs256) are unit-tested; the Apple PKCS#7 signing
 * path only runs with real certs.
 *
 * Server-only.
 */

import crypto from 'node:crypto'
import forge from 'node-forge'
import JSZip from 'jszip'
import { getEnv } from './env'

export interface WalletTicket {
  ticketId: string
  eventId: string
  ref: string
  eventTitle: string
  whenLabel: string
  startsAtIso: string
  venue: string | null
  ticketTypeName: string
  holderName: string | null
  /** Signed QR token: TIK.{id}.{sig}. */
  qrToken: string
}

export function appleWalletConfigured(): boolean {
  const e = getEnv()
  return Boolean(
    e.APPLE_PASS_TYPE_ID &&
    e.APPLE_TEAM_ID &&
    e.APPLE_PASS_CERT_PEM &&
    e.APPLE_PASS_KEY_PEM &&
    e.APPLE_WWDR_PEM,
  )
}

export function googleWalletConfigured(): boolean {
  const e = getEnv()
  return Boolean(
    e.GOOGLE_WALLET_ISSUER_ID &&
    e.GOOGLE_WALLET_SA_EMAIL &&
    e.GOOGLE_WALLET_SA_KEY,
  )
}

// --- Google Wallet -----------------------------------------------------------

/** Build the EventTicket class + object for a Google Wallet save JWT. */
export function buildGoogleWalletObject(t: WalletTicket, issuerId: string) {
  const classId = `${issuerId}.evt_${t.eventId.replace(/-/g, '')}`
  const objectId = `${issuerId}.tkt_${t.ticketId.replace(/-/g, '')}`
  return {
    classObject: {
      id: classId,
      issuerName: 'Ticketio',
      reviewStatus: 'UNDER_REVIEW',
      eventName: { defaultValue: { language: 'sk', value: t.eventTitle } },
      ...(t.venue
        ? {
            venue: {
              name: { defaultValue: { language: 'sk', value: t.venue } },
            },
          }
        : {}),
      dateTime: { start: t.startsAtIso },
    },
    object: {
      id: objectId,
      classId,
      state: 'ACTIVE',
      ...(t.holderName ? { ticketHolderName: t.holderName } : {}),
      ticketNumber: t.ref,
      barcode: {
        type: 'QR_CODE',
        value: t.qrToken,
        alternateText: t.ref,
      },
    },
  }
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Sign a JWT (RS256) with a PEM private key. */
export function signJwtRs256(
  payload: Record<string, unknown>,
  privateKeyPem: string,
): string {
  const header = base64url(
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
  )
  const body = base64url(Buffer.from(JSON.stringify(payload)))
  const data = `${header}.${body}`
  const sig = crypto.createSign('RSA-SHA256').update(data).sign(privateKeyPem)
  return `${data}.${base64url(sig)}`
}

/** "Save to Google Wallet" URL, or null if Google Wallet isn't configured. */
export function googleWalletSaveUrl(
  t: WalletTicket,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string | null {
  const e = getEnv()
  if (!googleWalletConfigured()) return null
  const { classObject, object } = buildGoogleWalletObject(
    t,
    e.GOOGLE_WALLET_ISSUER_ID,
  )
  const jwt = signJwtRs256(
    {
      iss: e.GOOGLE_WALLET_SA_EMAIL,
      aud: 'google',
      typ: 'savetowallet',
      iat: nowSeconds,
      payload: {
        eventTicketClasses: [classObject],
        eventTicketObjects: [object],
      },
    },
    e.GOOGLE_WALLET_SA_KEY.replace(/\\n/g, '\n'),
  )
  return `https://pay.google.com/gp/v/save/${jwt}`
}

// --- Apple Wallet ------------------------------------------------------------

/** The pass.json payload for an event ticket. */
export function buildApplePassJson(
  t: WalletTicket,
  cfg: { passTypeId: string; teamId: string },
) {
  return {
    formatVersion: 1,
    passTypeIdentifier: cfg.passTypeId,
    teamIdentifier: cfg.teamId,
    serialNumber: t.ticketId,
    organizationName: 'Ticketio',
    description: t.eventTitle,
    foregroundColor: 'rgb(255,255,255)',
    backgroundColor: 'rgb(79,70,229)',
    labelColor: 'rgb(224,231,255)',
    barcodes: [
      {
        format: 'PKBARCODE_FORMAT_QR',
        message: t.qrToken,
        messageEncoding: 'iso-8859-1',
        altText: t.ref,
      },
    ],
    relevantDate: t.startsAtIso,
    eventTicket: {
      primaryFields: [
        { key: 'event', label: 'Podujatie', value: t.eventTitle },
      ],
      secondaryFields: [
        { key: 'date', label: 'Kedy', value: t.whenLabel },
        ...(t.venue ? [{ key: 'venue', label: 'Kde', value: t.venue }] : []),
      ],
      auxiliaryFields: [
        { key: 'type', label: 'Typ', value: t.ticketTypeName },
        ...(t.holderName
          ? [{ key: 'holder', label: 'Držiteľ', value: t.holderName }]
          : []),
      ],
    },
  }
}

// Minimal 1x1 PNG placeholder icon. Replace public/wallet-icon assets with a real
// 29x29 / 58x58 Ticketio icon for production passes.
const PLACEHOLDER_ICON = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function sha1Hex(buf: Buffer): string {
  return crypto.createHash('sha1').update(buf).digest('hex')
}

function signManifestPkcs7(
  manifest: Buffer,
  certPem: string,
  keyPem: string,
  wwdrPem: string,
): Buffer {
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(manifest.toString('binary'))
  p7.addCertificate(forge.pki.certificateFromPem(certPem))
  p7.addCertificate(forge.pki.certificateFromPem(wwdrPem))
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(keyPem),
    certificate: forge.pki.certificateFromPem(certPem),
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toString() },
    ],
  })
  p7.sign({ detached: true })
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
  return Buffer.from(der, 'binary')
}

/** Generate a signed .pkpass, or null if Apple Wallet isn't configured. */
export async function generateApplePkpass(
  t: WalletTicket,
): Promise<Uint8Array | null> {
  const e = getEnv()
  if (!appleWalletConfigured()) return null

  const passJson = Buffer.from(
    JSON.stringify(
      buildApplePassJson(t, {
        passTypeId: e.APPLE_PASS_TYPE_ID,
        teamId: e.APPLE_TEAM_ID,
      }),
    ),
  )
  const icon = PLACEHOLDER_ICON

  const files: Record<string, Buffer> = {
    'pass.json': passJson,
    'icon.png': icon,
    'icon@2x.png': icon,
  }
  const manifest = Buffer.from(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(files).map(([name, buf]) => [name, sha1Hex(buf)]),
      ),
    ),
  )
  const signature = signManifestPkcs7(
    manifest,
    e.APPLE_PASS_CERT_PEM.replace(/\\n/g, '\n'),
    e.APPLE_PASS_KEY_PEM.replace(/\\n/g, '\n'),
    e.APPLE_WWDR_PEM.replace(/\\n/g, '\n'),
  )

  const zip = new JSZip()
  for (const [name, buf] of Object.entries(files)) zip.file(name, buf)
  zip.file('manifest.json', manifest)
  zip.file('signature', signature)
  const out = await zip.generateAsync({ type: 'uint8array' })
  return out
}
