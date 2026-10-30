'use client'

import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { postJson } from '@/lib/api-client'
import { formatRinggit } from '@/lib/money'

export function PayNow({ leaseId, dueSen }: { leaseId: string; dueSen: number }) {
  const [pending, setPending] = useState(false)
  const [bill, setBill] = useState<{ billId: string; amountSen: number } | null>(null)

  async function pay() {
    setPending(true)
    const result = await postJson<{ billId: string; amountSen: number }>(`/api/leases/${leaseId}/gateway-bills`)
    setPending(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setBill(result.data)
    toast.success('Payment started. Complete it with the gateway.')
  }

  if (bill) {
    return (
      <div className="space-y-2 rounded-lg border p-3 text-sm">
        <p>
          Gateway bill <span className="font-mono">{bill.billId}</span> for <strong>{formatRinggit(bill.amountSen)}</strong>.
        </p>
        <p className="text-muted-foreground">
          In production you would now be sent to the payment gateway. Your payment is settled only when the gateway confirms it.
        </p>
        <Link href={`/payments/return?bill_id=${bill.billId}`} className="underline underline-offset-4">
          Check the payment status
        </Link>
      </div>
    )
  }

  return (
    <Button onClick={pay} disabled={pending || dueSen <= 0}>
      {pending ? 'Creating bill…' : dueSen > 0 ? `Pay now ${formatRinggit(dueSen)}` : 'Nothing due now'}
    </Button>
  )
}
