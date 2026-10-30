import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { headers } from 'next/headers'
import { prisma } from '@/lib/db'
import { ApiError } from '@/lib/http'
import { createClient } from '@/lib/supabase/server'

export type StaffRole = 'manager' | 'staff'

export type AuthContext =
  | { userId: string; role: StaffRole; orgId: string; tenantId: null }
  | { userId: string; role: 'tenant'; orgId: string; tenantId: string }

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i

// Returns the verified user id, or null. getUser() asks the Auth server to validate the token,
// unlike getSession(), which trusts whatever is in the cookie.
async function getVerifiedUserId(): Promise<string | null> {
  const authorization = (await headers()).get('authorization')

  // A present but malformed Authorization header is rejected, not silently replaced by the cookie.
  if (authorization !== null) {
    const match = BEARER_PATTERN.exec(authorization.trim())
    if (!match) return null
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    )
    const { data, error } = await supabase.auth.getUser(match[1])
    return error || !data.user ? null : data.user.id
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  return error || !data.user ? null : data.user.id
}

// Who is calling: used by every route handler, Server Action and server component.
// Role and organization come only from memberships, or tenants.user_id for tenants,
// never from user_metadata (which the user can edit).
export async function requireAuth(): Promise<AuthContext> {
  const userId = await getVerifiedUserId()
  if (!userId) throw new ApiError(401, 'Authentication required')

  const membership = await prisma.memberships.findUnique({ where: { user_id: userId } })
  if (membership) {
    return { userId, role: membership.role, orgId: membership.org_id, tenantId: null }
  }

  const tenant = await prisma.tenants.findUnique({ where: { user_id: userId } })
  if (tenant) {
    return { userId, role: 'tenant', orgId: tenant.org_id, tenantId: tenant.id }
  }

  throw new ApiError(403, 'This account has no access')
}
