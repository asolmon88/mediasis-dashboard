"use client"

import { Dropzone, DropzoneContent, DropzoneEmptyState } from "@/components/dropzone";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useSupabaseUpload } from "@/hooks/use-supabase-upload";
import { createClient } from "@/lib/supabase/client";
import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function LogoSettingsPage() {
  const [businessUuid, setBusinessUuid] = useState<string | null>(null)

  useEffect(() => {
    const fetchBusinessUuid = async () => {
      const supabase = createClient()
      const { data: userData, error: userError } = await supabase.auth.getSession()
      if (userError || !userData.session?.user.id) {
        toast.error("Error obteniendo el usuario")
        return
      }

      // Here I assume the business uid = user.id
      // If you actually have a "business" table, query it here
      setBusinessUuid(userData.session.user.id)
    }

    fetchBusinessUuid()
  }, [])

  if (!businessUuid) {
    return <p className="m-4 text-sm flex flex-row items-center justify-center"><Loader2Icon className="animate-spin"/> Cargando información del negocio</p>
  }

  return (
    <LogoUploader businessUuid={businessUuid}/>
  );
}

function LogoUploader({
  businessUuid
}:{
  businessUuid: string
}) {
  const upload = useSupabaseUpload({
    bucketName: "avatars",
    path: "business_logos", // optional (unused when getObjectKey is provided)
    allowedMimeTypes: ["image/png"],           // PNG only
    maxFiles: 1,                               // one logo
    maxFileSize: 2 * 1024 * 1024,              // 2MB (adjust)
    cacheControl: 3600,
    upsert: true,                              // overwrite if it already exists
    getObjectKey: () => `business_logos/${businessUuid}.png`, // <— the magic
  })

  useEffect(() => {
    async function addAvatarToAccount() {
      const supabase = await createClient();

      const { data } = await supabase.storage
        .from("avatars")
        .getPublicUrl(`business_logos/${businessUuid}.png`)
      const { error } = await supabase.schema('mediasis').from('businesses').update({avatar_url: data.publicUrl}).eq('uid', businessUuid)
      if (error) {
        toast.error('El archivo se subió exitosamente pero no se pudo agregar a la cuenta. Por favor vuelva a subir el archivo.')
        return
      }

      toast.success("Logo subido correctamente.")
    }


    if (upload.isSuccess) {
      addAvatarToAccount();
    }
  }, [upload.isSuccess])

  useEffect(() => {
    if (upload.errors.length) {
      upload.errors.forEach(e => toast.error(`Error subiendo: ${e.name} (${e.message})`))
    }
  }, [upload.errors])

  return (
    <div className="max-w-svw m-4">
      <Card>
        <CardHeader>
          <CardTitle>Logo del negocio</CardTitle>
          <CardDescription>Agregue el logo del negocio. Este se usará para presentarlo a los clientes</CardDescription>
        </CardHeader>
        <CardContent>
          <Dropzone {...upload}>
            <DropzoneEmptyState />
            <DropzoneContent />
          </Dropzone>
        </CardContent>
      </Card>
    </div>
  );
}