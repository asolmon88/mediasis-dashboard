import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { clerkAuthenticationEnabledForRequest } from '@/lib/clerk/server-config'

/**
 * If using Fluid compute: Don't put this client in a global variable. Always create a new client within each
 * function when using it.
 */
export async function createClient() {
  if (await clerkAuthenticationEnabledForRequest()) {
    const session = await auth()
    const token = session.userId ? await session.getToken() : null
    if (token) {
      return createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY!,
        {
          accessToken: async () => token,
          auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        }
      )
    }
  }

  return createLegacyClient()
}

/**
 * Supabase Auth client for the compatibility login/session flow.
 *
 * Clerk-token clients intentionally disable supabase.auth methods. Legacy
 * login pages must opt into this cookie-backed client even when a Clerk
 * session happens to exist in the same browser.
 */
export async function createLegacyClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}
