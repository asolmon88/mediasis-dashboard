import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

export const useCurrentUserId = () => {
  const [id, setId] = useState<string | undefined>(undefined)

  useEffect(() => {
    const fetchUserId = async () => {
      const supabase = await createClient();
      const { data: userData, error: userDataError } = await supabase.auth.getSession();
      if (userDataError) {
        toast.error('Error al obtener el usuario')
      }

      setId(userData.session?.user.id);
    }
    fetchUserId()
  }, [])

  return id
}