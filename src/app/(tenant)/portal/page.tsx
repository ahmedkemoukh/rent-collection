import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getLeaseDetails } from '@/features/leases/service'
import { formatMalaysiaDateTime, todayInMalaysia } from '@/lib/dates'
import { formatRinggit } from '@/lib/money'
import { requirePageAuth } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { PayNow } from './pay-now'
import { PhoneForm } from './phone-form'

const METHOD_LABEL = { cash: 'Cash', bank_transfer: 'Bank transfer', online: 'Online' } as const

export default async function PortalPage() {
  // Layouts and pages render in parallel, so the page checks the caller itself.
  const ctx = await requirePageAuth('tenant')
  if (ctx.role !== 'tenant') return null
  const supabase = await createClient()

  // The tenant's own rows, read with their session (RLS).
  const [{ data: profile }, { data: leases }] = await Promise.all([
    supabase.from('tenants').select('full_name, email, phone').eq('id', ctx.tenantId).single<{ full_name: string; email: string; phone: string | null }>(),
    supabase.from('leases').select('id, units(name)').order('start_date').returns<{ id: string; units: { name: string } | null }[]>(),
  ])
  const details = await Promise.all((leases ?? []).map((lease) => getLeaseDetails(ctx, lease.id)))
  const today = todayInMalaysia()

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Hello{profile ? `, ${profile.full_name}` : ''}</h1>
        <p className="text-sm text-muted-foreground">Today in Malaysia: {today}</p>
      </div>

      {details.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No lease</CardTitle>
            <CardDescription>You have no lease with us yet.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {details.map(({ lease, invoices, payments }, i) => {
        // Unpaid amounts of invoices due on or before today's Malaysia date (what Pay now bills).
        const dueNowSen = invoices
          .filter((invoice) => invoice.dueDate <= today)
          .reduce((sum, invoice) => sum + Math.max(0, invoice.amountSen - invoice.paidSen), 0)
        return (
          <Card key={lease.id}>
            <CardHeader>
              <CardTitle>Unit {leases?.[i]?.units?.name}</CardTitle>
              <CardDescription>
                {lease.startDate} to {lease.endDate} · {formatRinggit(lease.monthlyRentSen)} per month
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3">
                <div>
                  <p className="text-sm text-muted-foreground">Amount due now</p>
                  <p className="text-2xl font-semibold">{formatRinggit(dueNowSen)}</p>
                </div>
                <PayNow leaseId={lease.id} dueSen={dueNowSen} />
              </div>

              <div className="space-y-2">
                <h2 className="font-medium">Invoices</h2>
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
              </div>

              <div className="space-y-2">
                <h2 className="font-medium">Payments</h2>
                {payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payments yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Received</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((payment) => (
                        <TableRow key={payment.id}>
                          <TableCell>{formatMalaysiaDateTime(new Date(payment.receivedAt))}</TableCell>
                          <TableCell>{METHOD_LABEL[payment.method]}</TableCell>
                          <TableCell className="text-right">{formatRinggit(payment.amountSen)}</TableCell>
                          <TableCell><StatusBadge status={payment.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}

      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>{profile?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <PhoneForm tenantId={ctx.tenantId} initialPhone={profile?.phone ?? null} />
        </CardContent>
      </Card>
    </>
  )
}
