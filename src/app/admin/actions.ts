'use server'

import { createClient } from '@/lib/supabase/server'
import { getDashboardAuthorizationContext } from '@/lib/dashboard/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasDashboardPermission } from '@/lib/dashboard/auth-types'
import type { DashboardAuthorizationContext } from '@/lib/dashboard/auth-types'
import {
  BusinessHomeBucket,
  BusinessHomeDashboardData,
  BusinessHomeDashboardResponse,
} from '@/lib/types/dashboardTypes'

export type BusinessSetupChecklistData = {
  firstProductCompleted: boolean
  appearanceCompleted: boolean
  paymentMethodCompleted: boolean
  completedSteps: number
  totalSteps: number
  canManageProducts: boolean
  canManageAppearance: boolean
  canManagePaymentMethods: boolean
} | null

export type ActiveBusinessTrialData = {
  daysRemaining: number
  endsAt: string
} | null

export async function getActiveBusinessTrial(): Promise<ActiveBusinessTrialData> {
  const authorization = await getDashboardAuthorizationContext()
  return getActiveBusinessTrialAuthorized(authorization)
}

async function getActiveBusinessTrialAuthorized(authorization: DashboardAuthorizationContext | null): Promise<ActiveBusinessTrialData> {
  if (!authorization?.activeBusinessId) return null

  const { data, error } = await createAdminClient().schema('mediasis').from('business_trials')
    .select('status,ends_at')
    .eq('business_id', authorization.activeBusinessId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw new Error(`No se pudo cargar la prueba gratis: ${error.message}`)
  if (!data) return null

  const remainingMs = new Date(data.ends_at).getTime() - Date.now()
  if (remainingMs <= 0) return null
  return {
    daysRemaining: Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000))),
    endsAt: data.ends_at,
  }
}

export async function getBusinessSetupChecklist(): Promise<BusinessSetupChecklistData> {
  const authorization = await getDashboardAuthorizationContext()
  return getBusinessSetupChecklistAuthorized(authorization)
}

async function getBusinessSetupChecklistAuthorized(authorization: DashboardAuthorizationContext | null): Promise<BusinessSetupChecklistData> {
  if (!authorization?.activeBusinessId) return null

  const { data, error } = await createAdminClient().schema('mediasis').from('business_setup_checklist')
    .select('first_product_completed,appearance_completed,payment_method_completed,completed_steps,total_steps')
    .eq('business_id', authorization.activeBusinessId)
    .maybeSingle()
  if (error) throw new Error(`No se pudo cargar la guía de configuración: ${error.message}`)
  if (!data) return null

  return {
    firstProductCompleted: data.first_product_completed,
    appearanceCompleted: data.appearance_completed,
    paymentMethodCompleted: data.payment_method_completed,
    completedSteps: data.completed_steps,
    totalSteps: data.total_steps,
    canManageProducts: authorization.mode === 'legacy' || hasDashboardPermission(authorization, 'products.manage.full'),
    canManageAppearance: authorization.mode === 'legacy' || hasDashboardPermission(authorization, 'ordering_app.storefront.manage.full'),
    canManagePaymentMethods: authorization.mode === 'legacy' || hasDashboardPermission(authorization, 'ordering_app.payment_methods.manage.full'),
  }
}

export async function getBusinessHomeInitialData(params: Parameters<typeof getBusinessHomeDashboard>[0]) {
  const started = Date.now()
  const authorization = await getDashboardAuthorizationContext()
  const [dashboard, checklist, trial] = await Promise.all([
    getBusinessHomeDashboardAuthorized(params, authorization),
    getBusinessSetupChecklistAuthorized(authorization),
    getActiveBusinessTrialAuthorized(authorization),
  ])
  console.info('[dashboard-home] initial_data_ms', Date.now() - started)
  return { dashboard, checklist, trial }
}

type BusinessSummary = {
  views: number
  orders: number
  sales: number
}

type BusinessSummaryDashboardResponse = {
  success?: boolean
  message?: string
  data?: {
    views?: number
    orders?: number
    sales?: number
  }
} | null

type BusinessCashbackDashboardResponse = {
  success?: boolean
  message?: string
  data?: {
    active_customers?: number
    redeemed_minor?: number
  }
} | null

export async function getBusinessSummary({
  startUtcIso,
  endUtcIso,
  startUtcDay,
  endUtcDay,
  locationId,
  includeAllLocations = false,
}: {
  startUtcIso: string
  endUtcIso: string
  startUtcDay: string
  endUtcDay: string
  locationId?: string
  includeAllLocations?: boolean
}): Promise<BusinessSummary> {
  const supabase = await createClient()
  const authorization = await getDashboardAuthorizationContext()
  if (!authorization?.activeBusinessId) throw new Error('No hay un negocio activo')
  const { data, error } = await supabase
    .schema('mediasis')
    .rpc('get_business_summary_dashboard', {
      p_start_utc_iso: startUtcIso,
      p_end_utc_iso: endUtcIso,
      p_start_utc_day: startUtcDay,
      p_end_utc_day: endUtcDay,
      p_location_id: locationId ?? null,
      p_include_all_locations: includeAllLocations,
      p_requested_business_id: authorization.activeBusinessId,
    })

  if (error) {
    throw error
  }

  const response = data as BusinessSummaryDashboardResponse
  if (!response?.success || !response.data) {
    throw new Error(response?.message ?? 'Error al cargar resumen del negocio')
  }

  return {
    views: Number(response.data.views ?? 0),
    orders: Number(response.data.orders ?? 0),
    sales: Number(response.data.sales ?? 0),
  }
}

export async function getBusinessHomeDashboard({
  startLocalDay,
  endLocalDay,
  locationId,
  includeAllLocations = false,
  bucket = 'day',
}: {
  startLocalDay: string
  endLocalDay: string
  locationId?: string
  includeAllLocations?: boolean
  bucket?: BusinessHomeBucket
}): Promise<BusinessHomeDashboardData> {
  const authorization = await getDashboardAuthorizationContext()
  return getBusinessHomeDashboardAuthorized({ startLocalDay, endLocalDay, locationId, includeAllLocations, bucket }, authorization)
}

async function getBusinessHomeDashboardAuthorized({
  startLocalDay, endLocalDay, locationId, includeAllLocations = false, bucket = 'day',
}: Parameters<typeof getBusinessHomeDashboard>[0], authorization: DashboardAuthorizationContext | null): Promise<BusinessHomeDashboardData> {
  const supabase = await createClient()
  if (!authorization?.activeBusinessId) throw new Error('No hay un negocio activo')
  const aggregateStarted = Date.now()
  const [dashboardResult, cashbackResult] = await Promise.all([
    supabase.schema('mediasis').rpc('get_business_home_dashboard_for_local_dates', {
      p_start_local_day: startLocalDay,
      p_end_local_day: endLocalDay,
      p_location_id: locationId ?? null,
      p_include_all_locations: includeAllLocations,
      p_bucket: bucket,
      p_requested_business_id: authorization.activeBusinessId,
    }),
    supabase.schema('mediasis').rpc('get_business_cashback_dashboard_insights', {
      p_start_local_day: startLocalDay,
      p_end_local_day: endLocalDay,
      p_location_id: locationId ?? null,
      p_include_all_locations: includeAllLocations,
      p_requested_business_id: authorization.activeBusinessId,
    }),
  ])
  console.info('[dashboard-home] aggregate_rpc_ms', Date.now() - aggregateStarted)

  const { data, error } = dashboardResult

  if (error) {
    throw error
  }

  const response = data as BusinessHomeDashboardResponse
  if (!response?.success || !response.data) {
    throw new Error(response?.message ?? 'Error al cargar dashboard del negocio')
  }

  const cashbackResponse = cashbackResult.data as BusinessCashbackDashboardResponse
  const showCashbackInsights = Boolean(
    !cashbackResult.error && cashbackResponse?.success && cashbackResponse.data
  )
  if (cashbackResult.error || !cashbackResponse?.success) {
    console.error(
      'No se pudieron cargar los insights de cashback:',
      cashbackResult.error?.message ?? cashbackResponse?.message ?? 'Respuesta inválida'
    )
  }

  // Delivery fees only apply to a selected location whose active delivery
  // configuration requires a location but does not require a courier. The
  // aggregate analytics response cannot make that distinction by itself.
  let showDeliveryFees = false
  let deliveryFeeLocationName: string | null = null

  if (locationId && !includeAllLocations) {
    const { data: deliveryMethods, error: deliveryMethodsError } = await supabase
      .schema('mediasis')
      .from('delivery_methods_business')
      .select('uid, scope, delivery_methods_business_location(business_location_id)')
      .eq('business_id', authorization.activeBusinessId)
      .eq('visibility', true)
      .eq('require_location', true)
      .eq('require_courier', false)

    // Do not surface a potentially misleading fee card if configuration cannot
    // be read. The rest of the dashboard remains available.
    if (!deliveryMethodsError) {
      showDeliveryFees = (deliveryMethods ?? []).some((method) =>
        method.scope === 'all' || method.delivery_methods_business_location.some(
          (assignment) => assignment.business_location_id === locationId
        )
      )

      if (showDeliveryFees) {
        deliveryFeeLocationName = authorization.locations.find(
          (location) => location.business_location_id === locationId
        )?.short_name ?? null
      }
    }
  }

  let salesOverTime = response.data.timeseries.sales_over_time ?? []
  let ordersOverTime = response.data.timeseries.orders_over_time ?? []

  // Some versions of the legacy aggregate return correct totals and
  // breakdowns but either omit both chart arrays or emit placeholder zero
  // buckets for every day. Recover only those inconsistent responses through
  // the same permission- and location-scoped context.
  const mainSeriesHasNoValues =
    salesOverTime.length === 0 && ordersOverTime.length === 0
  const mainSeriesIsAllZero =
    salesOverTime.length > 0 &&
    ordersOverTime.length > 0 &&
    salesOverTime.every((point) => Number(point.amount ?? 0) === 0) &&
    ordersOverTime.every((point) => Number(point.count ?? 0) === 0)
  if (
    Number(response.data.summary.orders_count ?? 0) > 0 &&
    (mainSeriesHasNoValues || mainSeriesIsAllZero)
  ) {
    const { data: seriesData, error: seriesError } = await supabase
      .schema('mediasis')
      .rpc('get_business_home_timeseries_for_local_dates', {
        p_start_local_day: startLocalDay,
        p_end_local_day: endLocalDay,
        p_location_id: locationId ?? null,
        p_include_all_locations: includeAllLocations,
        p_bucket: bucket,
        p_requested_business_id: authorization.activeBusinessId,
      })

    if (seriesError) throw seriesError

    const seriesResponse = seriesData as {
      success?: boolean
      message?: string
      data?: {
        sales_over_time?: typeof salesOverTime
        orders_over_time?: typeof ordersOverTime
      }
    } | null

    if (!seriesResponse?.success || !seriesResponse.data) {
      throw new Error(seriesResponse?.message ?? 'Error al cargar las gráficas')
    }

    salesOverTime = seriesResponse.data.sales_over_time ?? []
    ordersOverTime = seriesResponse.data.orders_over_time ?? []
  }

  return {
    summary: {
      gross_sales: Number(response.data.summary.gross_sales ?? 0),
      orders_count: Number(response.data.summary.orders_count ?? 0),
      avg_ticket: Number(response.data.summary.avg_ticket ?? 0),
      views: Number(response.data.summary.views ?? 0),
    },
    timeseries: {
      sales_over_time: salesOverTime.map((point) => ({
        bucket: point.bucket,
        amount: Number(point.amount ?? 0),
      })),
      orders_over_time: ordersOverTime.map((point) => ({
        bucket: point.bucket,
        count: Number(point.count ?? 0),
      })),
      views_over_time: (response.data.timeseries.views_over_time ?? []).map((point) => ({
        bucket: point.bucket,
        views: Number(point.views ?? 0),
      })),
      sales_by_location_over_time: (
        response.data.timeseries.sales_by_location_over_time ?? []
      ).map((point) => ({
        bucket: point.bucket,
        location_id: point.location_id,
        location_name: point.location_name,
        amount: Number(point.amount ?? 0),
      })),
    },
    breakdowns: {
      delivery_methods: (response.data.breakdowns.delivery_methods ?? []).map((item) => ({
        id: item.id,
        label: item.label,
        instructions: item.instructions ?? "",
        orders_count: Number(item.orders_count ?? 0),
        sales_amount: Number(item.sales_amount ?? 0),
        pct_orders: Number(item.pct_orders ?? 0),
      })),
      payment_methods: (response.data.breakdowns.payment_methods ?? []).map((item) => ({
        id: item.id,
        label: item.label,
        orders_count: Number(item.orders_count ?? 0),
        sales_amount: Number(item.sales_amount ?? 0),
        pct_orders: Number(item.pct_orders ?? 0),
      })),
    },
    insights: {
      discounted_orders_count: Number(response.data.insights.discounted_orders_count ?? 0),
      discounted_orders_pct: Number(response.data.insights.discounted_orders_pct ?? 0),
      delivery_fee_total: Number(response.data.insights.delivery_fee_total ?? 0),
      delivery_fee_avg: Number(response.data.insights.delivery_fee_avg ?? 0),
      show_delivery_fees: showDeliveryFees && Boolean(response.data.insights.show_delivery_fees),
      delivery_fee_location_name: deliveryFeeLocationName,
      cashback_active_customers: showCashbackInsights
        ? Number(cashbackResponse?.data?.active_customers ?? 0)
        : 0,
      cashback_redeemed_amount: showCashbackInsights
        ? Number(cashbackResponse?.data?.redeemed_minor ?? 0) / 100
        : 0,
      show_cashback_insights: showCashbackInsights,
    },
    meta: {
      bucket: response.data.meta.bucket ?? 'day',
      location_scope: response.data.meta.location_scope ?? 'single',
      location_id: response.data.meta.location_id ?? null,
      date_from: response.data.meta.date_from,
      date_to: response.data.meta.date_to,
    },
  }
}
