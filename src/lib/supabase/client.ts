import { createBrowserClient } from '@supabase/ssr'

// Browser client: publishable key only, every query goes through RLS with the user's session.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
