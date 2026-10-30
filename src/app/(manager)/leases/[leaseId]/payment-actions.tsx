'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { postJson } from '@/lib/api-client'

type Action = 'approve' | 'reject' | 'void'

const COPY: Record<Action, { title: string; description: string; confirm: string; done: string }> = {
  approve: {
    title: 'Approve this payment?',
    description: 'It will be allocated to the oldest unpaid invoices of the lease.',
    confirm: 'Approve',
    done: 'Payment approved.',
  },
  reject: {
    title: 'Reject this payment?',
    description: 'The payment is kept, marked as rejected, and never allocated.',
    confirm: 'Reject',
    done: 'Payment rejected.',
  },
  void: {
    title: 'Void this payment?',
    description: "Its allocations are removed and the invoices it paid reopen. Other payments don't change.",
    confirm: 'Void',
    done: 'Payment voided.',
  },
}

export function PaymentActions({ paymentId, status }: { paymentId: string; status: string }) {
  const router = useRouter()
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)

  const needsReason = action === 'reject' || action === 'void'
  const reasonValid = reason.trim().length >= 5

  async function confirm() {
    if (!action) return
    if (needsReason && !reasonValid) {
      toast.error('Give a reason of at least 5 characters.')
      return
    }
    setPending(true)
    const result = await postJson<{ status: string }>(`/api/payments/${paymentId}/${action}`, needsReason ? { reason: reason.trim() } : undefined)
    setPending(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(COPY[action].done)
    setAction(null)
    setReason('')
    router.refresh()
  }

  if (status !== 'pending_verification' && status !== 'approved') return null

  return (
    <>
      <div className="flex justify-end gap-2">
        {status === 'pending_verification' && (
          <>
            <Button size="sm" onClick={() => setAction('approve')}>Approve</Button>
            <Button size="sm" variant="outline" onClick={() => setAction('reject')}>Reject</Button>
          </>
        )}
        {status === 'approved' && (
          <Button size="sm" variant="destructive" onClick={() => setAction('void')}>Void</Button>
        )}
      </div>
      <Dialog open={action !== null} onOpenChange={(open) => { if (!open && !pending) setAction(null) }}>
        <DialogContent>
          {action && (
            <>
              <DialogHeader>
                <DialogTitle>{COPY[action].title}</DialogTitle>
                <DialogDescription>{COPY[action].description}</DialogDescription>
              </DialogHeader>
              {needsReason && (
                <div className="space-y-2">
                  <Label htmlFor={`reason-${paymentId}`}>Reason (at least 5 characters)</Label>
                  <Textarea id={`reason-${paymentId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setAction(null)} disabled={pending}>Cancel</Button>
                <Button
                  variant={action === 'approve' ? 'default' : 'destructive'}
                  onClick={confirm}
                  disabled={pending || (needsReason && !reasonValid)}
                >
                  {pending ? 'Working…' : COPY[action].confirm}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
