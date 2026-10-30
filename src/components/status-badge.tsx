import { Badge } from '@/components/ui/badge'

const LABELS: Record<string, string> = {
  paid: 'Paid',
  partially_paid: 'Partially paid',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  pending_verification: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  voided: 'Voided',
  pending: 'Pending',
  failed: 'Failed',
}

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'paid' || status === 'approved'
      ? 'default'
      : status === 'overdue' || status === 'rejected' || status === 'voided' || status === 'failed'
        ? 'destructive'
        : 'secondary'
  return <Badge variant={variant}>{LABELS[status] ?? status}</Badge>
}
