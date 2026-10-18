'use client'

import { saveBusinessLocation } from '@/app/admin/locations/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { PhoneInput } from '@/components/ui/phone-input'
import GoogleMap from '@/components/GoogleMap'
import { toast } from 'sonner'
import { LocationAddSchema } from '@/lib/FormSchemas/locationAddSchema'
import { BusinessLocation } from '@/lib/types/dashboardTypes'
import { useLocationStore } from '@/stores/location-store'

type LocationAddEditFormProps = {
  location?: BusinessLocation
  onSuccess?: () => void
  formId?: string
  hideSubmitButton?: boolean
}

export default function LocationAddEditForm({
  location,
  onSuccess,
  formId,
  hideSubmitButton = false,
}: LocationAddEditFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter()
  const upsertLocation = useLocationStore((state) => state.upsertLocation)

  const form = useForm<z.infer<typeof LocationAddSchema>>({
    resolver: zodResolver(LocationAddSchema),
    defaultValues: {
      short_name: location?.short_name ?? '',
      phone: location?.phone_number ?? '',
      location: location?.lat
        ? {lat: Number(location?.lat), lng: Number(location.lng)}
        : {lat: 9.932, lng: -84.08}
    },
  })

  useEffect(() => {
    form.reset({
      short_name: location?.short_name ?? '',
      phone: location?.phone_number ?? '',
      location: location?.lat
        ? { lat: Number(location.lat), lng: Number(location.lng) }
        : { lat: 9.932, lng: -84.08 },
    })
  }, [form, location])

  // 2. Define a submit handler.
  async function onSubmit(values: z.infer<typeof LocationAddSchema>) {
    setIsLoading(true);
    const result = LocationAddSchema.safeParse(values);
    if (result.error) {
      toast.error("Error en los datos digitados.")
      setIsLoading(false)
      return
    }

    try {
      const response = await saveBusinessLocation({
        values: result.data,
        locationId: location?.business_location_id,
      })

      if (!response.success || !response.data?.business_location_id) {
        console.error('[locationFormSubmit] saveBusinessLocation returned unsuccessful response', {
          mode: location ? 'edit' : 'add',
          locationId: location?.business_location_id,
          response,
        })
        throw new Error(
          response.message ||
            (location
              ? 'No se pudo actualizar la ubicación.'
              : 'No se pudo guardar la ubicación.')
        )
      }

      upsertLocation(response.data, response.previousLocationId)

      toast.success(location ? 'Ubicación actualizada!' : 'Ubicación agregada!')
      router.refresh()
      onSuccess?.()
    } catch (error: unknown) {
      console.error('[locationFormSubmit] Failed', {
        mode: location ? 'edit' : 'add',
        locationId: location?.business_location_id,
        error,
      })
      toast.error(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className='mx-2 px-2 pb-2'>
      <Form {...form}>
        <form id={formId} onSubmit={form.handleSubmit(onSubmit)}>
          <div className="flex flex-col gap-6">
            <FormField
              control={form.control}
              name="short_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre corto para la ubicación de su negocio</FormLabel>
                  <FormControl>
                    <Input placeholder="los Yoses" {...field} />
                  </FormControl>
                  <FormDescription>
                    Este nombre es para identificar la ubicación de su negocio. Ej: Nombre del negocio: Padfy, nombre corto: los yoses.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem className="flex flex-col items-start">
                  <FormLabel className="text-left">Número de teléfono</FormLabel>
                  <FormControl className="w-full">
                    <PhoneInput
                      placeholder="869542147"
                      defaultCountry='CR'
                      inputMode="tel"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-left">
                    Ingresa el número de teléfono para que los clientes contacten esta ubicación del negocio.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem className="flex flex-col items-start">
                  <FormLabel className="text-left">Ubicación exacta</FormLabel>
                  <FormControl className="w-full">
                    <GoogleMap
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormDescription className="text-left">
                    Tocá el mapa o arrastrá el marcador para fijar la ubicación exacta. En computadora también podés usar el zoom y arrastrar el mapa.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {!hideSubmitButton ? (
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? `${location ? 'Editando...' : 'Agregando...'}` : `${location ? 'Editar' : 'Agregar'}`}
              </Button>
            ) : null}
          </div>
        </form>
      </Form>
    </div>
  );
}
