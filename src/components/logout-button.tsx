'use client'

import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { resetPersistedLocation, useLocationStore } from '@/stores/location-store'

export function LogoutButton() {
  const router = useRouter()
  const resetLocations = useLocationStore((state) => state.reset)

  const logout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut({ scope: 'local' })
    resetLocations()
    resetPersistedLocation()
    router.replace('/auth/login')
    router.refresh()
  }

  return <Button onClick={logout}>Cerrar sesión</Button>
}
