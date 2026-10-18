'use server'

import { reverseGeocodeLatLng } from '@/lib/google/reverse-geocode'
import { getDashboardAuthorizationContext } from '@/lib/dashboard/auth'
import { hasDashboardPermission } from '@/lib/dashboard/auth-types'
import { createAdminClient } from '@/lib/supabase/admin'
import { BusinessLocation } from '@/lib/types/dashboardTypes'
import { PostgrestError } from '@supabase/supabase-js'
import { z } from 'zod'

const ServerLocationSaveSchema = z.object({
  short_name: z.string().trim().min(2).max(60),
  phone: z.string().trim().min(1),
  location: z.object({
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
  }),
})

type SaveBusinessLocationParams = {
  values: z.infer<typeof ServerLocationSaveSchema>
  locationId?: string
}

type SaveBusinessLocationResponse = {
  success: boolean
  message?: string
  data?: BusinessLocation
  previousLocationId?: string
}

type BusinessLocationRow = {
  business_location_id: string
  short_name: string
  phone_number: string
  lat: number | string | null
  lng: number | string | null
}

function mapBusinessLocationRow(row: BusinessLocationRow): BusinessLocation {
  return {
    business_location_id: row.business_location_id,
    short_name: row.short_name,
    phone_number: row.phone_number,
    lat: String(row.lat ?? ''),
    lng: String(row.lng ?? ''),
  }
}

export async function saveBusinessLocation({
  values,
  locationId,
}: SaveBusinessLocationParams): Promise<SaveBusinessLocationResponse> {
  const parsed = ServerLocationSaveSchema.safeParse(values)

  if (!parsed.success) {
    return {
      success: false,
      message: 'Error al procesar los datos ingresados.',
    }
  }

  const authorization = await getDashboardAuthorizationContext()
  const supabase = createAdminClient()
  let businessUid: string | undefined
  let coordsChanged = false
  let rotationAttempted = false

  try {
    businessUid = authorization?.activeBusinessId ?? undefined
    if (!authorization || !businessUid) {
      throw new Error('No hay un negocio activo')
    }
    const canManageLocations =
      authorization.mode === 'legacy' ||
      authorization.mode === 'staff' ||
      hasDashboardPermission(authorization, 'locations.manage')
    if (!canManageLocations) {
      throw new Error('No tenés permiso para administrar ubicaciones')
    }
    if (!locationId && authorization.mode === 'clerk' && !authorization.allLocations) {
      throw new Error('Necesitás acceso a todas las ubicaciones para crear una nueva')
    }

    const lat = Number(parsed.data.location.lat)
    const lng = Number(parsed.data.location.lng)
    console.warn('[saveBusinessLocation] Starting reverse geocoding', {
      mode: locationId ? 'update' : 'create',
      locationId,
      businessUid,
      lat,
      lng,
    })
    const textAddress = await reverseGeocodeLatLng({ lat, lng })
    const basePayload = {
      business_uid: businessUid,
      short_name: parsed.data.short_name,
      phone_number: parsed.data.phone,
      lat,
      lng,
      text_address: textAddress,
    }

    const query = supabase.schema('mediasis').from('business_location')

    let previousLocationId: string | undefined
    let locationQuery

    if (locationId) {
      console.warn('[saveBusinessLocation] Loading existing location', {
        mode: 'update',
        locationId,
        businessUid,
      })
      const { data: existingLocation, error: existingLocationError } = await query
        .select('business_location_id, lat, lng')
        .eq('business_uid', businessUid)
        .eq('business_location_id', locationId)
        .is('archived_at', null)
        .maybeSingle()

      if (existingLocationError) {
        throw existingLocationError
      }

      if (!existingLocation?.business_location_id) {
        throw new Error('No se encontro la ubicacion a actualizar.')
      }
      if (
        authorization.mode === 'clerk' &&
        !authorization.allLocations &&
        !authorization.locations.some(
          (item) => item.business_location_id === existingLocation.business_location_id,
        )
      ) {
        throw new Error('No tenés acceso a esta ubicación')
      }

      previousLocationId = existingLocation.business_location_id

      coordsChanged =
        Number(existingLocation.lat) !== lat || Number(existingLocation.lng) !== lng
      rotationAttempted = coordsChanged

      console.warn('[saveBusinessLocation] Existing location loaded', {
        mode: 'update',
        locationId,
        previousLocationId,
        businessUid,
        currentLat: Number(existingLocation.lat),
        currentLng: Number(existingLocation.lng),
        nextLat: lat,
        nextLng: lng,
        coordsChanged,
        rotationAttempted,
      })

      locationQuery = query
        .update({
          ...basePayload,
          ...(coordsChanged
            ? { business_location_id: crypto.randomUUID() }
            : {}),
        })
        .eq('business_uid', businessUid)
        .eq('business_location_id', locationId)
        .is('archived_at', null)
        .select('business_location_id, short_name, phone_number, lat, lng')
        .maybeSingle()
    } else {
      console.warn('[saveBusinessLocation] Creating new location', {
        mode: 'create',
        businessUid,
        lat,
        lng,
      })
      locationQuery = query
        .insert(basePayload)
        .select('business_location_id, short_name, phone_number, lat, lng')
        .maybeSingle()
    }

    console.warn('[saveBusinessLocation] Executing location mutation', {
      mode: locationId ? 'update' : 'create',
      locationId,
      previousLocationId,
      businessUid,
      lat,
      lng,
      coordsChanged,
      rotationAttempted,
    })
    const { data, error } = await locationQuery

    if (error) {
      throw error
    }

    if (!data?.business_location_id) {
      throw new Error(
        locationId
          ? 'No se pudo actualizar la ubicacion.'
          : 'No se pudo guardar la ubicacion.'
      )
    }

    return {
      success: true,
      data: mapBusinessLocationRow(data as BusinessLocationRow),
      previousLocationId,
    }
  } catch (error) {
    const message =
      error instanceof PostgrestError
        ? error.code === '23503' &&
          error.message.includes('violates foreign key constraint') &&
          error.details?.includes('product_option_choice_locations')
          ? 'No se pudo actualizar la ubicación porque la base de datos no tiene ON UPDATE CASCADE en product_option_choice_locations.'
          : error.message
        : error instanceof Error
          ? error.message
          : 'Ocurrio un error'

    console.error('[saveBusinessLocation] Failed', {
      mode: locationId ? 'update' : 'create',
      locationId,
      businessUid,
      lat: parsed.success ? Number(parsed.data.location.lat) : undefined,
      lng: parsed.success ? Number(parsed.data.location.lng) : undefined,
      coordsChanged,
      rotationAttempted,
      message,
      error,
    })

    return {
      success: false,
      message,
    }
  }
}

export async function retireBusinessLocation(locationId: string): Promise<{
  success: boolean
  message?: string
}> {
  if (!z.string().uuid().safeParse(locationId).success) {
    return { success: false, message: 'La ubicación no es válida.' }
  }

  try {
    const authorization = await getDashboardAuthorizationContext()
    const businessUid = authorization?.activeBusinessId
    if (!authorization || !businessUid) {
      return { success: false, message: 'No hay un negocio activo.' }
    }
    if (
      authorization.mode !== 'legacy' &&
      authorization.mode !== 'staff' &&
      !hasDashboardPermission(authorization, 'locations.manage')
    ) {
      return { success: false, message: 'No tenés permiso para administrar ubicaciones.' }
    }
    if (
      authorization.mode === 'clerk' &&
      !authorization.allLocations &&
      !authorization.locations.some((location) => location.business_location_id === locationId)
    ) {
      return { success: false, message: 'No tenés acceso a esta ubicación.' }
    }

    const { data, error } = await createAdminClient()
      .schema('mediasis')
      .from('business_location')
      .update({ archived_at: new Date().toISOString() })
      .eq('business_uid', businessUid)
      .eq('business_location_id', locationId)
      .is('archived_at', null)
      .select('business_location_id')
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return { success: false, message: 'La ubicación no existe o ya fue retirada.' }
    }
    return { success: true }
  } catch (error) {
    console.error('[retireBusinessLocation] Failed', { locationId, error })
    return { success: false, message: 'No se pudo retirar la ubicación.' }
  }
}
