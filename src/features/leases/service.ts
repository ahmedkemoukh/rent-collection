import 'server-only'
import { z } from 'zod'
import type { AuthContext } from '@/lib/auth'
import { generateSchedule, invoiceStatus, type InvoiceKind, type InvoiceStatus } from '@/lib/billing'
import { dateOnlyToDb, dbToDateOnly, toMalaysiaIso } from '@/lib/dates'
import { prisma } from '@/lib/db'
import { hasPostgresCode, PG_EXCLUSION_VIOLATION } from '@/lib/db-errors'
import { ApiError } from '@/lib/http'
import { senToNumber } from '@/lib/money'

// z.guid() accepts any 8-4-4-4-12 hex id, so a well-formed but unknown id reaches the 404 check.
const idSchema = z.guid()

const createLeaseSchema = z.object({
  unitId: idSchema,
  tenantId: idSchema,
  startDate: z.string(),
  endDate: z.string(),
  monthlyRentSen: z.number().int(),
  depositSen: z.number().int(),
})

export type CreateLeaseInput = z.infer<typeof createLeaseSchema>

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')
}

// Creates the lease and exactly the invoices generateSchedule returns, plus its audit row,
// in one transaction: all or nothing.
export async function createLease(ctx: AuthContext, body: unknown): Promise<{ id: string }> {
  if (ctx.role !== 'manager') throw new ApiError(403, 'Only managers can create leases')

  const parsed = createLeaseSchema.safeParse(body)
  if (!parsed.success) throw new ApiError(400, `Invalid lease: ${describeIssues(parsed.error)}`)
  const input = parsed.data

  let schedule: ReturnType<typeof generateSchedule>
  try {
    schedule = generateSchedule(input)
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : 'Invalid lease')
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // IDs in the body are untrusted: both must belong to the caller's organization.
      const unit = await tx.units.findFirst({ where: { id: input.unitId, org_id: ctx.orgId }, select: { id: true } })
      const tenant = await tx.tenants.findFirst({ where: { id: input.tenantId, org_id: ctx.orgId }, select: { id: true } })
      if (!unit || !tenant) throw new ApiError(404, 'Unit or tenant not found')

      const lease = await tx.leases.create({
        data: {
          org_id: ctx.orgId,
          unit_id: input.unitId,
          tenant_id: input.tenantId,
          start_date: dateOnlyToDb(input.startDate),
          end_date: dateOnlyToDb(input.endDate),
          monthly_rent_sen: BigInt(input.monthlyRentSen),
          deposit_sen: BigInt(input.depositSen),
        },
        select: { id: true },
      })

      await tx.invoices.createMany({
        data: schedule.map((invoice) => ({
          org_id: ctx.orgId,
          lease_id: lease.id,
          kind: invoice.kind,
          period_index: invoice.periodIndex,
          period_start: invoice.periodStart === null ? null : dateOnlyToDb(invoice.periodStart),
          period_end: invoice.periodEnd === null ? null : dateOnlyToDb(invoice.periodEnd),
          due_date: dateOnlyToDb(invoice.dueDate),
          amount_sen: BigInt(invoice.amountSen),
        })),
      })

      await tx.audit_log.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'lease.created',
          entity_id: lease.id,
          details: { ...input, invoiceCount: schedule.length },
        },
      })

      return { id: lease.id }
    })
  } catch (error) {
    // leases_no_overlap (EXCLUDE constraint) also covers two requests arriving at the same moment.
    if (hasPostgresCode(error, PG_EXCLUSION_VIOLATION)) {
      throw new ApiError(409, 'The lease overlaps another lease on this unit')
    }
    throw error
  }
}

// Staff and managers see their organization's leases; a tenant sees only their own.
// Anything else is reported as not found, so other organizations' records stay invisible.
export function canReadLease(ctx: AuthContext, lease: { org_id: string; tenant_id: string }): boolean {
  if (ctx.role === 'tenant') return lease.tenant_id === ctx.tenantId
  return lease.org_id === ctx.orgId
}

export interface LeaseDetails {
  lease: {
    id: string
    unitId: string
    tenantId: string
    startDate: string
    endDate: string
    monthlyRentSen: number
    depositSen: number
  }
  invoices: {
    id: string
    kind: InvoiceKind
    periodIndex: number | null
    periodStart: string | null
    periodEnd: string | null
    dueDate: string
    amountSen: number
    paidSen: number
    status: InvoiceStatus
  }[]
  payments: {
    id: string
    amountSen: number
    unappliedSen: number
    method: 'cash' | 'bank_transfer' | 'online'
    status: 'pending_verification' | 'approved' | 'rejected' | 'voided'
    receivedAt: string
  }[]
}

export async function getLeaseDetails(ctx: AuthContext, leaseId: string, now = new Date()): Promise<LeaseDetails> {
  if (!idSchema.safeParse(leaseId).success) throw new ApiError(404, 'Lease not found')

  const lease = await prisma.leases.findUnique({
    where: { id: leaseId },
    include: {
      // Allocation order: due date, then deposit before rent (enum declaration order), then period index.
      invoices: {
        orderBy: [{ due_date: 'asc' }, { kind: 'asc' }, { period_index: 'asc' }],
        include: { payment_allocations: { select: { amount_sen: true } } },
      },
      payments: { orderBy: [{ received_at: 'asc' }, { created_at: 'asc' }] },
    },
  })
  if (!lease || !canReadLease(ctx, lease)) throw new ApiError(404, 'Lease not found')

  return {
    lease: {
      id: lease.id,
      unitId: lease.unit_id,
      tenantId: lease.tenant_id,
      startDate: dbToDateOnly(lease.start_date),
      endDate: dbToDateOnly(lease.end_date),
      monthlyRentSen: senToNumber(lease.monthly_rent_sen),
      depositSen: senToNumber(lease.deposit_sen),
    },
    invoices: lease.invoices.map((invoice) => {
      const amountSen = senToNumber(invoice.amount_sen)
      const paidSen = senToNumber(
        invoice.payment_allocations.reduce((sum, allocation) => sum + allocation.amount_sen, BigInt(0)),
      )
      const dueDate = dbToDateOnly(invoice.due_date)
      return {
        id: invoice.id,
        kind: invoice.kind,
        periodIndex: invoice.period_index,
        periodStart: invoice.period_start === null ? null : dbToDateOnly(invoice.period_start),
        periodEnd: invoice.period_end === null ? null : dbToDateOnly(invoice.period_end),
        dueDate,
        amountSen,
        paidSen,
        status: invoiceStatus({ dueDate, amountSen, paidSen }, now),
      }
    }),
    payments: lease.payments.map((payment) => ({
      id: payment.id,
      amountSen: senToNumber(payment.amount_sen),
      unappliedSen: senToNumber(payment.unapplied_sen),
      method: payment.method,
      status: payment.status,
      receivedAt: toMalaysiaIso(payment.received_at),
    })),
  }
}
