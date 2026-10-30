import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getCollections } from '@/features/reports/service'
import { invoiceStatus } from '@/lib/billing'
import { todayInMalaysia } from '@/lib/dates'
import { formatRinggit } from '@/lib/money'
import { requirePageAuth } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'

interface InvoiceRow {
  due_date: string
  amount_sen: number
  payment_allocations: { amount_sen: number }[]
}

// The 6 calendar months ending with the current Malaysia month, as YYYY-MM.
function lastSixMonths(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const start = year * 12 + (month - 1) - 5
  const from = `${Math.floor(start / 12)}-${String((start % 12) + 1).padStart(2, '0')}`
  return { from, to: today.slice(0, 7) }
}

export default async function DashboardPage() {
  // Layouts and pages render in parallel, so the page checks the caller itself.
  const ctx = await requirePageAuth('staff')
  const supabase = await createClient()
  const now = new Date()
  const { from, to } = lastSixMonths(todayInMalaysia(now))

  const [{ data: invoices, error }, collections] = await Promise.all([
    supabase.from('invoices').select('due_date, amount_sen, payment_allocations(amount_sen)').returns<InvoiceRow[]>(),
    getCollections(ctx, from, to),
  ])

  const overdue = (invoices ?? []).filter(
    (invoice) =>
      invoiceStatus(
        {
          dueDate: invoice.due_date,
          amountSen: invoice.amount_sen,
          paidSen: invoice.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0),
        },
        now,
      ) === 'overdue',
  ).length
  const maxCollected = Math.max(1, ...collections.map((m) => m.collectedSen))

  return (
    <>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Overdue invoices</CardDescription>
            <CardTitle className="text-3xl">{error ? '—' : overdue}</CardTitle>
          </CardHeader>
          {error && <CardContent className="text-sm text-destructive">Could not load invoices.</CardContent>}
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Collections, last 6 months</CardTitle>
          <CardDescription>Approved payments by month received (Malaysia time), {from} to {to}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {collections.every((m) => m.collectedSen === 0) && (
            <p className="text-sm text-muted-foreground">Nothing collected in this period.</p>
          )}
          {collections.map((m) => (
            <div key={m.month} className="grid grid-cols-[5rem_1fr_8rem] items-center gap-3 text-sm">
              <span className="font-mono">{m.month}</span>
              <div className="h-2 rounded bg-muted">
                <div className="h-2 rounded bg-primary" style={{ width: `${(m.collectedSen / maxCollected) * 100}%` }} />
              </div>
              <span className="text-right">{formatRinggit(m.collectedSen)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  )
}
