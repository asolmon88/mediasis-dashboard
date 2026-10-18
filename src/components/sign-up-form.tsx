'use client'

import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { SignUpSchema } from '@/lib/FormSchemas/signUpSchema'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from './ui/form'
import { PhoneInput } from './ui/phone-input'
import GoogleMap from './GoogleMap'
import { PasswordInput } from './ui/password-input'
import { toast } from 'sonner'

export function SignUpForm({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const form = useForm<z.infer<typeof SignUpSchema>>({
    resolver: zodResolver(SignUpSchema),
    defaultValues: {
      email:'',
      password:'',
      full_name:'',
      short_name:'',
      phone:'',
      location: {lat: 9.932, lng: -84.08},
    },
  })
 
  // 2. Define a submit handler.
  async function onSubmit(values: z.infer<typeof SignUpSchema>) {
    setIsLoading(true);
    const result = SignUpSchema.safeParse(values);
    if (result.error) {
      toast.error("Error en los datos digitados.")
      return
    }
    const supabase = createClient()
    try {
      const { error } = await supabase.auth.signUp({
        email: result.data?.email || '',
        password: result.data?.password || '',
        options: {
          emailRedirectTo: `${window.location.origin}/admin`,
          data: {
            email: result.data?.email,
            full_name: result.data?.full_name,
            short_name: result.data?.short_name,
            phone: result.data?.phone,
            lat: result.data?.location.lat,
            lng: result.data?.location.lng,
            location: JSON.stringify(result.data?.location),
            avatar_url: '',
            business: true,
          }
        },
      })
      if (error) throw error;
      router.push('/auth/sign-up-success')
      toast.success('Cuenta creada!')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Registrar negocio</CardTitle>
          <CardDescription>Crea una nueva cuenta</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="flex flex-col gap-6">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input placeholder="ejemplo@email.com" {...field} />
                      </FormControl>
                      <FormDescription>
                        Email para crear su cuenta.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contraseña</FormLabel>
                      <FormControl>
                        <PasswordInput id='password' value={field.value} onChange={field.onChange}/>
                      </FormControl>
                      <FormDescription>
                        La contraseña debe tener al menos 8 caracteres y una mayúscula.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="full_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre del negocio</FormLabel>
                      <FormControl>
                        <Input placeholder="padfy" {...field} />
                      </FormControl>
                      <FormDescription>
                        Este nombre se le presentará a sus clientes.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                        Haz clic en el mapa o arrastra el marcador para fijar la ubicación exacta. Para Zoom: crtl + rueda del mouse. Para moverte: click derecho.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Creando cuenta...' : 'Crear'}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                Ya tienes cuenta?{' '}
                <Link href="/auth/login" className="underline underline-offset-4">
                  Inicia sesión
                </Link>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
