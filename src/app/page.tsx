import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { requireAuth } from '@/lib/auth'
import { ApiError } from '@/lib/http'
import { homeFor } from '@/lib/session'

async function RoleRedirect(): Promise<null> {
  let target = '/login'
  try {
    target = homeFor(await requireAuth())
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
  }
  redirect(target)
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-md p-6">
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <RoleRedirect />
      </Suspense>
    </main>
  )
}
