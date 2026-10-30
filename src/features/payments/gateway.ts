import 'server-only'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { canReadLease } from '@/features/leases/service'
import type { AuthContext } from '@/lib/auth'
import { dateOnlyToDb, parseInstant, todayInMalaysia } from '@/lib/dates'
import { prisma } from '@/lib/db'
import { hasPostgresCode, PG_UNIQUE_VIOLATION } from '@/lib/db-errors'
import { isValidSignature } from '@/lib/gateway-signature'
import { ApiError } from '@/lib/http'
import { senToNumber } from '@/lib/money'
import { allocatePayment, lockLease } from './allocation'

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 }
const ZERO = BigInt(0)

// 128 random bits: bill ids cannot be guessed or enumerated.
function newBillId(): string {
  return `bill_${randomBytes(16).toString('hex')}`
}

// The tenant of the lease asks to pay what is due now: the unpaid amounts of the lease's
// invoices due on or before today's Malaysia date.
export async function createGatewayBill(
  ctx: AuthContext,
  leaseId: string,
  now: Date = new Date(),
): Promise<{ billId: string; amountSen: number }> {
  if (!z.guid().safeParse(leaseId).success) throw new ApiError(404, 'Lease not found')
  const lease = await prisma.leases.findUnique({ where: { id: leaseId }, select: { id: true, org_id: true, tenant_id: true } })
  if (!lease || !canReadLease(ctx, lease)) throw new ApiError(404, 'Lease not found')
  if (ctx.role !== 'tenant') throw new ApiError(403, "Only the lease's tenant can pay online")

  const dueInvoices = await prisma.invoices.findMany({
    where: { lease_id: lease.id, due_date: { lte: dateOnlyToDb(todayInMalaysia(now)) } },
    select: { amount_sen: true, payment_allocations: { select: { amount_sen: true } } },
  })
  const dueSen = dueInvoices.reduce((total, invoice) => {
    const paid = invoice.payment_allocations.reduce((sum, a) => sum + a.amount_sen, ZERO)
    const unpaid = invoice.amount_sen - paid
    return unpaid > ZERO ? total + unpaid : total
  }, ZERO)
  if (dueSen <= ZERO) throw new ApiError(422, 'Nothing is due on this lease')

  const bill = await prisma.gateway_bills.create({
    data: { id: newBillId(), org_id: lease.org_id, lease_id: lease.id, amount_sen: dueSen, created_by: ctx.userId },
    select: { id: true, amount_sen: true },
  })
  return { billId: bill.id, amountSen: senToNumber(bill.amount_sen) }
}

// "2026-04-01 00:30:12 +0800" -> Date
function parseGatewayTime(value: string | undefined): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec(value ?? '')
  if (!match) return null
  const [, date, time, sign, hours, minutes] = match
  return parseInstant(`${date}T${time}${sign}${hours}:${minutes}`)
}

export type WebhookOutcome = 'settled' | 'failed' | 'ignored'

// Only this function settles a bill. Every check that can reject the callback (401, 404, 422)
// runs before any write. Redeliveries, including simultaneous ones, are serialized by the lease
// lock and made harmless by the conditional status update; payments.gateway_bill_id is unique.
export async function handleGatewayWebhook(fields: Record<string, string>): Promise<WebhookOutcome> {
  const secretKey = process.env.GATEWAY_X_SIGNATURE_KEY
  if (!secretKey) throw new Error('GATEWAY_X_SIGNATURE_KEY is not set')
  if (!isValidSignature(fields, secretKey)) throw new ApiError(401, 'Invalid signature')

  const bill = fields.id
    ? await prisma.gateway_bills.findUnique({
        where: { id: fields.id },
        select: { id: true, org_id: true, lease_id: true, amount_sen: true },
      })
    : null
  if (!bill) throw new ApiError(404, 'Unknown bill')

  if (fields.paid !== 'true' && fields.paid !== 'false') throw new ApiError(400, 'paid must be true or false')
  const paid = fields.paid === 'true'

  let paidAt: Date | null = null
  if (paid) {
    if (!/^\d+$/.test(fields.paid_amount ?? '') || BigInt(fields.paid_amount) !== bill.amount_sen) {
      throw new ApiError(422, "paid_amount does not match the bill's amount")
    }
    paidAt = parseGatewayTime(fields.paid_at)
    if (!paidAt) throw new ApiError(400, 'paid_at is not a valid time')
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await lockLease(tx, bill.lease_id)

      if (!paid) {
        // Only a pending bill can fail; a paid bill never goes back.
        const failed = await tx.gateway_bills.updateMany({
          where: { id: bill.id, status: 'pending' },
          data: { status: 'failed', transaction_id: fields.transaction_id ?? null },
        })
        if (failed.count === 0) return 'ignored'
        await tx.audit_log.create({
          data: { org_id: bill.org_id, actor_id: null, action: 'gateway_bill.failed', entity_id: bill.id, details: { leaseId: bill.lease_id } },
        })
        return 'failed'
      }

      const settled = await tx.gateway_bills.updateMany({
        where: { id: bill.id, status: { in: ['pending', 'failed'] } },
        data: { status: 'paid', paid_at: paidAt, transaction_id: fields.transaction_id ?? null },
      })
      if (settled.count === 0) return 'ignored' // already paid: a repeat delivery

      const payment = await tx.payments.create({
        data: {
          org_id: bill.org_id,
          lease_id: bill.lease_id,
          amount_sen: bill.amount_sen,
          method: 'online',
          status: 'approved',
          received_at: paidAt!,
          gateway_bill_id: bill.id,
          decided_at: new Date(),
        },
        select: { id: true },
      })
      await allocatePayment(tx, payment.id)

      await tx.audit_log.create({
        data: {
          org_id: bill.org_id,
          actor_id: null,
          action: 'payment.online_settled',
          entity_id: payment.id,
          details: { leaseId: bill.lease_id, billId: bill.id, amountSen: senToNumber(bill.amount_sen), transactionId: fields.transaction_id ?? null },
        },
      })
      return 'settled'
    }, TX_OPTIONS)
  } catch (error) {
    // Last line of defense: the unique gateway_bill_id means the bill already has its payment.
    if (hasPostgresCode(error, PG_UNIQUE_VIOLATION)) return 'ignored'
    throw error
  }
}

export async function getBillStatusForCaller(ctx: AuthContext, billId: string) {
  const bill = await prisma.gateway_bills.findUnique({
    where: { id: billId },
    select: { id: true, amount_sen: true, status: true, paid_at: true, leases: { select: { org_id: true, tenant_id: true } } },
  })
  if (!bill || !canReadLease(ctx, bill.leases)) return null
  return { id: bill.id, amountSen: senToNumber(bill.amount_sen), status: bill.status, paidAt: bill.paid_at }
}
