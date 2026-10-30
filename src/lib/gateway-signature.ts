import { createHmac, timingSafeEqual } from 'node:crypto'

const SIGNATURE_FIELD = 'x_signature'
const HEX_SHA256 = /^[0-9a-f]{64}$/

// Every field except x_signature (including fields the gateway may add later), sorted by key
// in ascending character code order, each written as key immediately followed by value, joined by "|".
export function signatureSource(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((key) => key !== SIGNATURE_FIELD)
    .sort()
    .map((key) => `${key}${fields[key]}`)
    .join('|')
}

export function computeSignature(fields: Record<string, string>, secretKey: string): string {
  return createHmac('sha256', secretKey).update(signatureSource(fields)).digest('hex')
}

// Constant-time comparison; a missing or malformed signature is simply invalid.
export function isValidSignature(fields: Record<string, string>, secretKey: string): boolean {
  const received = fields[SIGNATURE_FIELD]
  if (typeof received !== 'string' || !HEX_SHA256.test(received)) return false
  const expected = Buffer.from(computeSignature(fields, secretKey), 'hex')
  return timingSafeEqual(expected, Buffer.from(received, 'hex'))
}
