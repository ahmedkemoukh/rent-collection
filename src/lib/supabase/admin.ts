import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Secret key: bypasses RLS. Server only, used for Storage cleanup and Auth admin, never for table data.
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is not set')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
