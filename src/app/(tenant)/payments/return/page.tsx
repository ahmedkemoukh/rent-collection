import Link from 'next/link'
import { Suspense } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getBillStatusForCaller } from '@/features/payments/gateway'
import { requireAuth } from '@/lib/auth'
import { formatMalaysiaDateTime } from '@/lib/dates'
import { ApiError } from '@/lib/http'
import { formatRinggit } from '@/lib/money'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const STATUS_TEXT = {
  pending: { label: 'Pending', description: 'We have not received a confirmation from the gateway yet. Refresh in a moment.' },
  paid: { label: 'Paid', description: 'The gateway confirmed your payment.' },
  failed: { label: 'Failed', description: 'The payment did not go through. You can try again from your lease.' },
} as const

// Shows the bill's real status from the database. It changes nothing: query parameters such as
// paid=true are ignored, because only the signed webhook can settle a bill.
async function BillStatus({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const billId = typeof params.bill_id === 'string' ? params.bill_id : null

  let bill: Awaited<ReturnType<typeof getBillStatusForCaller>> = null
  try {
    const ctx = await requireAuth()
    if (billId) bill = await getBillStatusForCaller(ctx, billId)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return <Message title="Please sign in" description="Sign in to see the status of your payment." />
    }
    throw error
  }

  if (!bill) return <Message title="Payment not found" description="We could not find this payment." />

  const text = STATUS_TEXT[bill.status]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Payment {formatRinggit(bill.amountSen)}
          <Badge variant={bill.status === 'paid' ? 'default' : bill.status === 'failed' ? 'destructive' : 'secondary'}>
            {text.label}
          </Badge>
        </CardTitle>
        <CardDescription>{text.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 text-muted-foreground">
        <p>Bill: <span className="font-mono">{bill.id}</span></p>
        {bill.paidAt && <p>Paid at: {formatMalaysiaDateTime(bill.paidAt)}</p>}
      </CardContent>
    </Card>
  )
}

function Message({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  )
}

export default function PaymentReturnPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-xl font-semibold">Payment status</h1>
      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        <BillStatus searchParams={searchParams} />
      </Suspense>
      <Link href="/" className="text-sm underline underline-offset-4">Back to my lease</Link>
    </main>
  )
}
