import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import {
  buildGoogleWalletObject,
  buildApplePassJson,
  signJwtRs256,
} from './wallet'
import type { WalletTicket } from './wallet'

const ticket: WalletTicket = {
  ticketId: 'aaaaaaaa-1111-2222-3333-444444444444',
  eventId: 'bbbbbbbb-1111-2222-3333-444444444444',
  ref: 'AAAAAAAA',
  eventTitle: 'Letný festival',
  whenLabel: '1. augusta 2026, 18:00',
  startsAtIso: '2026-08-01T16:00:00.000Z',
  venue: 'Amfiteáter Košice',
  ticketTypeName: 'VIP',
  holderName: 'Jana Nováková',
  qrToken: 'TIK.aaaaaaaa-1111-2222-3333-444444444444.abc123',
}

describe('buildGoogleWalletObject', () => {
  it('builds class + object with the QR barcode and stable ids', () => {
    const { classObject, object } = buildGoogleWalletObject(ticket, '333')
    expect(classObject.id).toBe('333.evt_' + ticket.eventId.replace(/-/g, ''))
    expect(object.id).toBe('333.tkt_' + ticket.ticketId.replace(/-/g, ''))
    expect(object.classId).toBe(classObject.id)
    expect(object.barcode).toEqual({
      type: 'QR_CODE',
      value: ticket.qrToken,
      alternateText: 'AAAAAAAA',
    })
    expect(classObject.eventName.defaultValue.value).toBe('Letný festival')
  })
})

describe('buildApplePassJson', () => {
  it('builds a pass with the QR barcode and event fields', () => {
    const pass = buildApplePassJson(ticket, {
      passTypeId: 'pass.sk.ticketio',
      teamId: 'TEAM',
    })
    expect(pass.passTypeIdentifier).toBe('pass.sk.ticketio')
    expect(pass.teamIdentifier).toBe('TEAM')
    expect(pass.serialNumber).toBe(ticket.ticketId)
    expect(pass.barcodes[0]).toMatchObject({
      format: 'PKBARCODE_FORMAT_QR',
      message: ticket.qrToken,
      altText: 'AAAAAAAA',
    })
    expect(pass.eventTicket.primaryFields[0].value).toBe('Letný festival')
    // venue + holder present → included
    expect(
      pass.eventTicket.secondaryFields.some(
        (f) => f.value === 'Amfiteáter Košice',
      ),
    ).toBe(true)
    expect(
      pass.eventTicket.auxiliaryFields.some((f) => f.value === 'Jana Nováková'),
    ).toBe(true)
  })

  it('omits venue/holder fields when absent', () => {
    const pass = buildApplePassJson(
      { ...ticket, venue: null, holderName: null },
      { passTypeId: 'p', teamId: 't' },
    )
    expect(pass.eventTicket.secondaryFields).toHaveLength(1) // date only
    expect(pass.eventTicket.auxiliaryFields).toHaveLength(1) // type only
  })
})

describe('signJwtRs256', () => {
  it('produces a JWT that verifies against the public key and round-trips the payload', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const jwt = signJwtRs256({ hello: 'svet', n: 7 }, privateKey)
    const [h, p, s] = jwt.split('.')
    expect(h && p && s).toBeTruthy()

    const data = `${h}.${p}`
    const sig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    const ok = crypto
      .createVerify('RSA-SHA256')
      .update(data)
      .verify(publicKey, sig)
    expect(ok).toBe(true)

    const payload = JSON.parse(
      Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    )
    expect(payload).toEqual({ hello: 'svet', n: 7 })
  })
})
