import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getLeaseDetails } from '@/features/leases/service'
import { formatMalaysiaDateTime, malaysiaDateTimeLocal } from '@/lib/dates'
import { ApiError } from '@/lib/http'
import { formatRinggit } from '@/lib/money'
import { requirePageAuth } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { PaymentActions } from './payment-actions'
import { RecordPaymentForm } from './record-payment-form'

const METHOD_LABEL = { cash: 'Cash', bank_transfer: 'Bank transfer', online: 'Online' } as const
const SIGNED_URL_SECONDS = 300

export default async function LeasePage({ params }: { params: Promise<{ leaseId: string }> }) {
  // Layouts and pages render in parallel, so the page checks the caller itself.
  const ctx = await requirePageAuth('staff')
  const { leaseId } = await params

  let details: Awaited<ReturnType<typeof getLeaseDetails>>
  try {
    details = await getLeaseDetails(ctx, leaseId)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }

  // Names and slip paths through the Data API with the user's session (RLS), then short-lived
  // signed URLs: the storage policy only lets staff of this organization read the slip.
  const supabase = await createClient()
  const [{ data: names }, { data: slips }] = await Promise.all([
    supabase.from('leases').select('units(name), tenants(full_name)').eq('id', leaseId).single<{ units: { name: string } | null; tenants: { full_name: string } | null }>(),
    supabase.from('payments').select('id, slip_path').eq('lease_id', leaseId).not('slip_path', 'is', null).returns<{ id: string; slip_path: string }[]>(),
  ])
  const slipUrls = new Map<string, string>()
  if (slips && slips.length > 0) {
    const { data: signed } = await supabase.storage.from('payment-slips').createSignedUrls(slips.map((s) => s.slip_path), SIGNED_URL_SECONDS)
    signed?.forEach((entry, i) => {
      if (entry.signedUrl) slipUrls.set(slips[i].id, entry.signedUrl)
    })
  }

  const malaysiaNow = malaysiaDateTimeLocal()
  const { lease, invoices, payments } = details

  return (
    <>
      <div className="space-y-1">
        <Link href="/leases" className="text-sm text-muted-foreground hover:underline">← Leases</Link>
        <h1 className="text-xl font-semibold">
          {names?.units?.name ?? 'Lease'} · {names?.tenants?.full_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {lease.startDate} to {lease.endDate} · {formatRinggit(lease.monthlyRentSen)} per month
          {lease.depositSen > 0 && ` · deposit ${formatRinggit(lease.depositSen)}`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">This lease has no invoices.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>{invoice.kind === 'deposit' ? 'Deposit' : `${invoice.periodStart} – ${invoice.periodEnd}`}</TableCell>
                    <TableCell>{invoice.dueDate}</TableCell>
                    <TableCell className="text-right">{formatRinggit(invoice.amountSen)}</TableCell>
                    <TableCell className="text-right">{formatRinggit(invoice.paidSen)}</TableCell>
                    <TableCell><StatusBadge status={invoice.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Slip</TableHead>
                  {ctx.role === 'manager' && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{formatMalaysiaDateTime(new Date(payment.receivedAt))}</TableCell>
                    <TableCell>{METHOD_LABEL[payment.method]}</TableCell>
                    <TableCell className="text-right">
                      {formatRinggit(payment.amountSen)}
                      {payment.unappliedSen > 0 && (
                        <span className="block text-xs text-muted-foreground">{formatRinggit(payment.unappliedSen)} unapplied</span>
                      )}
                    </TableCell>
                    <TableCell><StatusBadge status={payment.status} /></TableCell>
                    <TableCell>
                      {slipUrls.has(payment.id) ? (
                        <a href={slipUrls.get(payment.id)} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">View slip</a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {ctx.role === 'manager' && (
                      <TableCell><PaymentActions paymentId={payment.id} status={payment.status} /></TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Record a payment</CardTitle>
          <CardDescription>
            {ctx.role === 'manager' ? 'Your payments are approved immediately.' : 'Your payments wait for a manager’s approval.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecordPaymentForm leaseId={lease.id} orgId={ctx.orgId} defaultReceivedAt={malaysiaNow} isManager={ctx.role === 'manager'} />
        </CardContent>
      </Card>
    </>
  )
}
