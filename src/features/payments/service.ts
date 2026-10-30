import 'server-only'
import { z } from 'zod'
import { canReadLease } from '@/features/leases/service'
import type { AuthContext } from '@/lib/auth'
import { parseInstant } from '@/lib/dates'
import { prisma } from '@/lib/db'
import { hasPostgresCode, PG_UNIQUE_VIOLATION } from '@/lib/db-errors'
import { ApiError } from '@/lib/http'
import { senToNumber } from '@/lib/money'
import { createAdminClient } from '@/lib/supabase/admin'
import { allocatePayment, leaseBalance, lockLease } from './allocation'

export const SLIP_BUCKET = 'payment-slips'

// Lock waits count toward the timeout; concurrent requests on one lease queue behind each other.
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 }

const idSchema = z.guid()

const recordPaymentSchema = z.object({
  amountSen: z.number().int().positive(),
  method: z.enum(['cash', 'bank_transfer']),
  receivedAt: z.string(),
  slipPath: z.string().min(1).optional(),
})

const reasonSchema = z.object({
  reason: z.string().trim().min(5, 'reason must be at least 5 characters'),
})

type PaymentStatus = 'pending_verification' | 'approved' | 'rejected' | 'voided'

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')
}

async function findLeaseForCaller(ctx: AuthContext, leaseId: string) {
  if (!idSchema.safeParse(leaseId).success) throw new ApiError(404, 'Lease not found')
  const lease = await prisma.leases.findUnique({
    where: { id: leaseId },
    select: { id: true, org_id: true, tenant_id: true },
  })
  if (!lease || !canReadLease(ctx, lease)) throw new ApiError(404, 'Lease not found')
  return lease
}

// 404 if the caller cannot see the payment, 403 if they can see it but are not a manager.
async function findPaymentForManager(ctx: AuthContext, paymentId: string) {
  if (!idSchema.safeParse(paymentId).success) throw new ApiError(404, 'Payment not found')
  const payment = await prisma.payments.findUnique({
    where: { id: paymentId },
    select: { id: true, org_id: true, lease_id: true, leases: { select: { org_id: true, tenant_id: true } } },
  })
  if (!payment || !canReadLease(ctx, payment.leases)) throw new ApiError(404, 'Payment not found')
  if (ctx.role !== 'manager') throw new ApiError(403, 'Only managers can do this')
  return payment
}

async function slipExists(path: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ found: number }[]>`
    SELECT 1 AS found FROM storage.objects WHERE bucket_id = ${SLIP_BUCKET} AND name = ${path} LIMIT 1`
  return rows.length > 0
}

// Removes an uploaded slip after a failed recording, but only inside the caller's organization
// folder and only if no payment references it (a failed request must not delete a valid slip).
async function removeOrphanSlip(orgId: string, path: string): Promise<void> {
  if (!path.startsWith(`${orgId}/`)) return
  const referenced = await prisma.payments.count({ where: { slip_path: path } })
  if (referenced > 0) return
  const { error } = await createAdminClient().storage.from(SLIP_BUCKET).remove([path])
  if (error) console.error('Could not remove orphaned slip', { path, message: error.message })
}

export async function recordPayment(
  ctx: AuthContext,
  leaseId: string,
  body: unknown,
): Promise<{ id: string; status: PaymentStatus }> {
  const lease = await findLeaseForCaller(ctx, leaseId)
  if (ctx.role === 'tenant') throw new ApiError(403, 'Tenants cannot record payments')

  const uploadedSlip =
    typeof body === 'object' && body !== null && typeof (body as { slipPath?: unknown }).slipPath === 'string'
      ? (body as { slipPath: string }).slipPath
      : null

  try {
    const parsed = recordPaymentSchema.safeParse(body)
    if (!parsed.success) throw new ApiError(400, `Invalid payment: ${describeIssues(parsed.error)}`)
    const input = parsed.data

    const receivedAt = parseInstant(input.receivedAt)
    if (!receivedAt) throw new ApiError(400, 'receivedAt must be an ISO 8601 date and time')

    if (input.method === 'bank_transfer') {
      if (!input.slipPath) throw new ApiError(400, 'A bank transfer needs a slip')
      if (!input.slipPath.startsWith(`${ctx.orgId}/`) || !(await slipExists(input.slipPath))) {
        throw new ApiError(400, "slipPath must point to an uploaded file in your organization's folder")
      }
    } else if (input.slipPath !== undefined) {
      throw new ApiError(400, 'Only bank transfers have a slip')
    }

    return await prisma.$transaction(async (tx) => {
      await lockLease(tx, lease.id)

      // Cap: remaining balance minus payments still pending, read under the lease lock.
      const { remainingSen, pendingSen } = await leaseBalance(tx, lease.id)
      const capSen = remainingSen - pendingSen
      if (BigInt(input.amountSen) > capSen) {
        throw new ApiError(422, `Amount is over the lease's cap of ${senToNumber(capSen > 0 ? capSen : BigInt(0))} sen`)
      }

      const approvedNow = ctx.role === 'manager'
      const payment = await tx.payments.create({
        data: {
          org_id: lease.org_id,
          lease_id: lease.id,
          amount_sen: BigInt(input.amountSen),
          method: input.method,
          status: approvedNow ? 'approved' : 'pending_verification',
          received_at: receivedAt,
          slip_path: input.method === 'bank_transfer' ? input.slipPath : null,
          recorded_by: ctx.userId,
          decided_by: approvedNow ? ctx.userId : null,
          decided_at: approvedNow ? new Date() : null,
        },
        select: { id: true, status: true },
      })

      if (approvedNow) await allocatePayment(tx, payment.id)

      await tx.audit_log.create({
        data: {
          org_id: lease.org_id,
          actor_id: ctx.userId,
          action: approvedNow ? 'payment.recorded_approved' : 'payment.recorded_pending',
          entity_id: payment.id,
          details: { leaseId: lease.id, amountSen: input.amountSen, method: input.method, receivedAt: receivedAt.toISOString() },
        },
      })

      return payment
    }, TX_OPTIONS)
  } catch (error) {
    if (uploadedSlip) await removeOrphanSlip(ctx.orgId, uploadedSlip)
    if (hasPostgresCode(error, PG_UNIQUE_VIOLATION)) {
      throw new ApiError(400, 'This slip is already attached to another payment')
    }
    throw error
  }
}

export async function approvePayment(ctx: AuthContext, paymentId: string): Promise<{ status: PaymentStatus }> {
  const payment = await findPaymentForManager(ctx, paymentId)

  return prisma.$transaction(async (tx) => {
    await lockLease(tx, payment.lease_id)

    // Read after taking the lock: a concurrent approval has either committed or not started.
    const current = await tx.payments.findUniqueOrThrow({
      where: { id: payment.id },
      select: { status: true, amount_sen: true },
    })
    if (current.status !== 'pending_verification') throw new ApiError(409, `Payment is ${current.status}, not pending`)

    const { remainingSen } = await leaseBalance(tx, payment.lease_id)
    if (current.amount_sen > remainingSen) {
      throw new ApiError(422, "Payment is more than the lease's remaining balance; it stays pending")
    }

    const updated = await tx.payments.updateMany({
      where: { id: payment.id, status: 'pending_verification' },
      data: { status: 'approved', decided_by: ctx.userId, decided_at: new Date() },
    })
    if (updated.count !== 1) throw new ApiError(409, 'Payment is no longer pending')

    await allocatePayment(tx, payment.id)

    await tx.audit_log.create({
      data: {
        org_id: payment.org_id,
        actor_id: ctx.userId,
        action: 'payment.approved',
        entity_id: payment.id,
        details: { leaseId: payment.lease_id, amountSen: senToNumber(current.amount_sen) },
      },
    })
    return { status: 'approved' as const }
  }, TX_OPTIONS)
}

function parseReason(body: unknown): string {
  const parsed = reasonSchema.safeParse(body)
  if (!parsed.success) throw new ApiError(400, `Invalid request: ${describeIssues(parsed.error)}`)
  return parsed.data.reason
}

export async function rejectPayment(ctx: AuthContext, paymentId: string, body: unknown): Promise<{ status: PaymentStatus }> {
  const payment = await findPaymentForManager(ctx, paymentId)
  const reason = parseReason(body)

  return prisma.$transaction(async (tx) => {
    await lockLease(tx, payment.lease_id)

    const updated = await tx.payments.updateMany({
      where: { id: payment.id, status: 'pending_verification' },
      data: { status: 'rejected', reason, decided_by: ctx.userId, decided_at: new Date() },
    })
    if (updated.count !== 1) throw new ApiError(409, 'Only a pending payment can be rejected')

    await tx.audit_log.create({
      data: {
        org_id: payment.org_id,
        actor_id: ctx.userId,
        action: 'payment.rejected',
        entity_id: payment.id,
        details: { leaseId: payment.lease_id, reason },
      },
    })
    return { status: 'rejected' as const }
  }, TX_OPTIONS)
}

export async function voidPayment(ctx: AuthContext, paymentId: string, body: unknown): Promise<{ status: PaymentStatus }> {
  const payment = await findPaymentForManager(ctx, paymentId)
  const reason = parseReason(body)

  return prisma.$transaction(async (tx) => {
    await lockLease(tx, payment.lease_id)

    // Status first: the allocations trigger only lets a voided payment's allocations be removed.
    const updated = await tx.payments.updateMany({
      where: { id: payment.id, status: 'approved' },
      data: { status: 'voided', reason, decided_by: ctx.userId, decided_at: new Date() },
    })
    if (updated.count !== 1) throw new ApiError(409, 'Only an approved payment can be voided')

    // Only this payment's allocations; other payments' allocations do not change.
    const removed = await tx.payment_allocations.deleteMany({ where: { payment_id: payment.id } })

    await tx.audit_log.create({
      data: {
        org_id: payment.org_id,
        actor_id: ctx.userId,
        action: 'payment.voided',
        entity_id: payment.id,
        details: { leaseId: payment.lease_id, reason, removedAllocations: removed.count },
      },
    })
    return { status: 'voided' as const }
  }, TX_OPTIONS)
}
