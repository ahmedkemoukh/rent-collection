import { Suspense, type ReactNode } from 'react'
import { AppHeader } from '@/components/app-header'
import { Skeleton } from '@/components/ui/skeleton'
import { requirePageAuth } from '@/lib/session'

async function TenantArea({ children }: { children: ReactNode }) {
  await requirePageAuth('tenant')
  return (
    <>
      <AppHeader who="Tenant" links={[{ href: '/portal', label: 'My lease' }]} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-6">{children}</main>
    </>
  )
}

export default function TenantLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <TenantArea>{children}</TenantArea>
    </Suspense>
  )
}
