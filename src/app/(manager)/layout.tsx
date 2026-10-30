import { Suspense, type ReactNode } from 'react'
import { AppHeader } from '@/components/app-header'
import { Skeleton } from '@/components/ui/skeleton'
import { requirePageAuth } from '@/lib/session'

async function StaffArea({ children }: { children: ReactNode }) {
  const ctx = await requirePageAuth('staff')
  return (
    <>
      <AppHeader
        who={ctx.role === 'manager' ? 'Manager' : 'Staff'}
        links={[
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/leases', label: 'Leases' },
        ]}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-6">{children}</main>
    </>
  )
}

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StaffArea>{children}</StaffArea>
    </Suspense>
  )
}

function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
