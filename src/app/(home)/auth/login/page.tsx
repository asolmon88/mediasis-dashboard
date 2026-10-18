import { LoginForm } from '@/components/login-form'
import { clerkAuthenticationEnabledForRequest } from '@/lib/clerk/server-config'
import { createLegacyClient } from '@/lib/supabase/server'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

export default async function Page() {
  if (await clerkAuthenticationEnabledForRequest()) {
    const clerkSession = await auth()
    if (clerkSession.userId) redirect('/admin')
  }

  const supabase = await createLegacyClient()
  
  const { data, error } = await supabase.auth.getClaims()
  if (!(error || !data?.claims)) {
    redirect('/admin')
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  )
}
