import 'server-only'
import type { Prisma } from '@/generated/prisma/client'

type Tx = Prisma.TransactionClient

const ZERO = BigInt(0)

// Serializes every money operation on one lease (record, approve, reject, void, webhook).
// Always the first statement of the transaction, so locks are taken in the same order everywhere.
export async function lockLease(tx: Tx, leaseId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM public.leases WHERE id = ${leaseId}::uuid FOR UPDATE`
}

// remainingSen: total of the lease's invoices minus everything allocated to them.
// pendingSen: total of the lease's payments still waiting for a manager.
export async function leaseBalance(tx: Tx, leaseId: string): Promise<{ remainingSen: bigint; pendingSen: bigint }> {
  const invoiced = await tx.invoices.aggregate({ where: { lease_id: leaseId }, _sum: { amount_sen: true } })
  const allocated = await tx.payment_allocations.aggregate({
    where: { invoices: { lease_id: leaseId } },
    _sum: { amount_sen: true },
  })
  const pending = await tx.payments.aggregate({
    where: { lease_id: leaseId, status: 'pending_verification' },
    _sum: { amount_sen: true },
  })
  return {
    remainingSen: (invoiced._sum.amount_sen ?? ZERO) - (allocated._sum.amount_sen ?? ZERO),
    pendingSen: pending._sum.amount_sen ?? ZERO,
  }
}

// Fills the lease's invoices that still have something unpaid, in allocation order
// (due date, then deposit before rent, then period index), including invoices not due yet.
// What is left once every invoice is paid is stored as unapplied_sen. Requires the lease lock.
export async function allocatePayment(tx: Tx, paymentId: string): Promise<void> {
  const payment = await tx.payments.findUniqueOrThrow({
    where: { id: paymentId },
    select: { id: true, org_id: true, lease_id: true, amount_sen: true },
  })
  const invoices = await tx.invoices.findMany({
    where: { lease_id: payment.lease_id },
    orderBy: [{ due_date: 'asc' }, { kind: 'asc' }, { period_index: 'asc' }],
    select: { id: true, amount_sen: true, payment_allocations: { select: { amount_sen: true } } },
  })

  let left = payment.amount_sen
  const allocations: Prisma.payment_allocationsCreateManyInput[] = []
  for (const invoice of invoices) {
    if (left === ZERO) break
    const paid = invoice.payment_allocations.reduce((sum, a) => sum + a.amount_sen, ZERO)
    const unpaid = invoice.amount_sen - paid
    if (unpaid <= ZERO) continue
    const take = unpaid < left ? unpaid : left
    allocations.push({ org_id: payment.org_id, payment_id: payment.id, invoice_id: invoice.id, amount_sen: take })
    left -= take
  }

  if (allocations.length > 0) await tx.payment_allocations.createMany({ data: allocations })
  if (left > ZERO) await tx.payments.update({ where: { id: payment.id }, data: { unapplied_sen: left } })
}
