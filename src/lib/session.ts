import 'server-only'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { requireAuth, type AuthContext } from '@/lib/auth'
import { ApiError } from '@/lib/http'

type Area = 'staff' | 'tenant'

export function homeFor(ctx: AuthContext): string {
  return ctx.role === 'tenant' ? '/portal' : '/dashboard'
}

// For pages and layouts: no session goes to /login, the wrong area goes to the caller's own home.
// Hiding pages is only navigation; every read and write is still authorized by the services.
export async function requirePageAuth(area: Area): Promise<AuthContext> {
  // Per-request page: never prerendered (it reads the session and the current time).
  await connection()
  let ctx: AuthContext
  try {
    ctx = await requireAuth()
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) redirect('/login')
    throw error
  }
  const inArea = area === 'tenant' ? ctx.role === 'tenant' : ctx.role !== 'tenant'
  if (!inArea) redirect(homeFor(ctx))
  return ctx
}
