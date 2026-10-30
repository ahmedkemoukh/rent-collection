'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { postJson } from '@/lib/api-client'
import { parseRinggitToSen } from '@/lib/billing'
import { createClient } from '@/lib/supabase/client'

const SLIP_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }
const MAX_SLIP_BYTES = 5 * 1024 * 1024

type Method = 'cash' | 'bank_transfer'

export function RecordPaymentForm({
  leaseId,
  orgId,
  defaultReceivedAt,
  isManager,
}: {
  leaseId: string
  orgId: string
  defaultReceivedAt: string // 'YYYY-MM-DDTHH:mm' in Malaysia time, computed on the server
  isManager: boolean
}) {
  const router = useRouter()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<Method>('cash')
  const [receivedAt, setReceivedAt] = useState(defaultReceivedAt)
  const [slip, setSlip] = useState<File | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let amountSen: number
    try {
      amountSen = parseRinggitToSen(amount)
      if (amountSen <= 0) throw new Error('zero')
      setAmountError(null)
    } catch {
      setAmountError('Enter an amount in ringgit, for example 1,500.50')
      toast.error('The amount is not valid.')
      return
    }
    if (!receivedAt) {
      toast.error('Enter the date and time the money was received.')
      return
    }

    setPending(true)
    let slipPath: string | undefined
    if (method === 'bank_transfer') {
      if (!slip) {
        setPending(false)
        toast.error('A bank transfer needs a slip (JPEG, PNG or PDF).')
        return
      }
      const extension = SLIP_TYPES[slip.type]
      if (!extension || slip.size > MAX_SLIP_BYTES) {
        setPending(false)
        toast.error('The slip must be a JPEG, PNG or PDF of at most 5 MB.')
        return
      }
      slipPath = `${orgId}/${crypto.randomUUID()}.${extension}`
      const upload = await createClient().storage.from('payment-slips').upload(slipPath, slip, { contentType: slip.type })
      if (upload.error) {
        setPending(false)
        toast.error(`Could not upload the slip: ${upload.error.message}`)
        return
      }
    }

    // receivedAt has no offset: the server reads it as Malaysia time. A failed recording deletes the uploaded slip.
    const result = await postJson<{ id: string; status: string }>(`/api/leases/${leaseId}/payments`, {
      amountSen,
      method,
      receivedAt,
      ...(slipPath ? { slipPath } : {}),
    })
    setPending(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(result.data.status === 'approved' ? 'Payment recorded and approved.' : 'Payment recorded. It waits for a manager.')
    setAmount('')
    setSlip(null)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="amount">Amount (RM)</Label>
        <Input
          id="amount"
          inputMode="decimal"
          placeholder="1,500.00"
          value={amount}
          aria-invalid={amountError !== null}
          onChange={(e) => setAmount(e.target.value)}
        />
        {amountError && <p className="text-xs text-destructive">{amountError}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="receivedAt">Received (Malaysia time)</Label>
        <Input id="receivedAt" type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Method</Label>
        <div className="flex gap-2">
          <Button type="button" variant={method === 'cash' ? 'default' : 'outline'} onClick={() => setMethod('cash')}>
            Cash
          </Button>
          <Button type="button" variant={method === 'bank_transfer' ? 'default' : 'outline'} onClick={() => setMethod('bank_transfer')}>
            Bank transfer
          </Button>
        </div>
      </div>
      {method === 'bank_transfer' && (
        <div className="space-y-2">
          <Label htmlFor="slip">Slip (JPEG, PNG or PDF, max 5 MB)</Label>
          <Input id="slip" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setSlip(e.target.files?.[0] ?? null)} />
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Recording…' : isManager ? 'Record payment' : 'Record payment for approval'}
        </Button>
      </div>
    </form>
  )
}
