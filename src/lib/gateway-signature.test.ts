import { describe, expect, it } from 'vitest'
import { computeSignature, isValidSignature, signatureSource } from './gateway-signature'

const KEY = 'test_x_signature_key'
const fields = {
  id: 'bill_8f3a2c',
  paid: 'true',
  paid_amount: '210050',
  paid_at: '2026-04-01 00:30:12 +0800',
  transaction_id: 'TX-000123',
  transaction_status: 'completed',
}
const VECTOR = '06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641'

describe('gateway signature', () => {
  it('builds the source string of the brief', () => {
    expect(signatureSource({ ...fields, x_signature: 'ignored' })).toBe(
      'idbill_8f3a2c|paidtrue|paid_amount210050|paid_at2026-04-01 00:30:12 +0800|transaction_idTX-000123|transaction_statuscompleted',
    )
  })

  it('matches the test vector', () => {
    expect(computeSignature(fields, KEY)).toBe(VECTOR)
  })

  it('accepts the vector and rejects forged, missing or malformed signatures', () => {
    expect(isValidSignature({ ...fields, x_signature: VECTOR }, KEY)).toBe(true)
    expect(isValidSignature({ ...fields, x_signature: VECTOR }, 'wrong_key')).toBe(false)
    expect(isValidSignature({ ...fields, paid_amount: '210051', x_signature: VECTOR }, KEY)).toBe(false)
    expect(isValidSignature(fields, KEY)).toBe(false)
    expect(isValidSignature({ ...fields, x_signature: VECTOR.toUpperCase() }, KEY)).toBe(false)
    expect(isValidSignature({ ...fields, x_signature: 'abc' }, KEY)).toBe(false)
  })

  it('signs fields added by the gateway in the future', () => {
    const extended = { ...fields, currency: 'MYR' }
    const signature = computeSignature(extended, KEY)
    expect(signature).not.toBe(VECTOR)
    expect(isValidSignature({ ...extended, x_signature: signature }, KEY)).toBe(true)
    expect(isValidSignature({ ...extended, x_signature: VECTOR }, KEY)).toBe(false)
  })
})
