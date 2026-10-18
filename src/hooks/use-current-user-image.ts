import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

export const useCurrentUserImage = () => {
  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    const fetchUserImage = async () => {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.getSession()
      if (error) {
        toast.error('Error al obtener la imagen de usuario')
      }

      const { data:avatarData, error:avatarError } = await supabase.schema('mediasis').from('businesses').select('avatar_url').eq('uid', data.session?.user.id)

      if (!avatarData && avatarError) {
        toast.error('Error al obtener la imagen de usuario')
      }

      setImage(avatarData ? avatarData[0].avatar_url : null)
    }
    fetchUserImage()
  }, [])

  return image
}
