"use client"

import type { ReactNode } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { format, parseISO } from "date-fns"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  CalendarIcon,
  CircleDollarSign,
  HandCoins,
  MapPin,
  PackageOpen,
  Percent,
  UsersRound,
  Wallet,
} from "lucide-react"
import { DateRange } from "react-day-picker"

import { getBusinessHomeDashboard, getBusinessHomeInitialData, type ActiveBusinessTrialData } from "@/app/admin/actions"
import BusinessOverviewCard from "@/components/admin/BusinessOverviewCard"
import { NewBusinessSetupChecklist, type NewBusinessSetupChecklistData } from "@/components/admin/NewBusinessSetupChecklist"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider"
import { useCurrentUserName } from "@/hooks/use-current-user-name"
import { cn } from "@/lib/utils"
import {
  BusinessHomeBucket,
  BusinessHomeBreakdownItem,
  BusinessHomeDashboardData,
} from "@/lib/types/dashboardTypes"
import { useActiveLocationId, useBusinessLocations } from "@/stores/location-store"

const CHART_COLORS = [
  "#0067ff",
  "#20bc86",
  "#ffb21a",
  "#ff5b74",
  "#8b6cff",
  "#66a4ff",
]

const emptyDashboard: BusinessHomeDashboardData = {
  summary: {
    gross_sales: 0,
    orders_count: 0,
    avg_ticket: 0,
    views: 0,
  },
  timeseries: {
    sales_over_time: [],
    orders_over_time: [],
    views_over_time: [],
    sales_by_location_over_time: [],
  },
  breakdowns: {
    delivery_methods: [],
    payment_methods: [],
  },
  insights: {
    discounted_orders_count: 0,
    discounted_orders_pct: 0,
    delivery_fee_total: 0,
    delivery_fee_avg: 0,
    show_delivery_fees: false,
    delivery_fee_location_name: null,
    cashback_active_customers: 0,
    cashback_redeemed_amount: 0,
    show_cashback_insights: false,
  },
  meta: {
    bucket: "day",
    location_scope: "single",
    location_id: null,
    date_from: "",
    date_to: "",
  },
}

const countFormatter = new Intl.NumberFormat("en-US")

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

const BUCKET_OPTIONS: Array<{ value: BusinessHomeBucket; label: string }> = [
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
]

export default function AdminHomeDashboard() {
  const authorization = useDashboardAuthorization()
  if (!authorization.market) throw new Error("El negocio no tiene configuración regional.")
  const market = authorization.market
  const currencyFormatter = useMemo(() => new Intl.NumberFormat(market.locale, {
    style: "currency", currency: market.currencyCode,
  }), [market.locale, market.currencyCode])
  const compactCurrencyFormatter = useMemo(() => new Intl.NumberFormat(market.locale, {
    style: "currency", currency: market.currencyCode, notation: "compact", maximumFractionDigits: 1,
  }), [market.locale, market.currencyCode])
  // Legacy sessions historically stored the business name in Supabase user
  // metadata. Clerk identities represent people, so their name must never be
  // used as the business heading; the active Mediasis business is authoritative.
  const legacyBusinessName = useCurrentUserName()
  const activeBusiness = authorization.businesses.find(
    (business) => business.businessId === authorization.activeBusinessId
  )
  const businessName = activeBusiness?.name ?? authorization.businesses[0]?.name ?? legacyBusinessName
  const firstName = authorization.user.name.trim().split(/\s+/)[0] || ""
  const locationId = useActiveLocationId() ?? undefined
  const locations = useBusinessLocations()
  const [showAllLocations, setShowAllLocations] = useState(false)
  const activeLocation = locations.find(
    (location) => location.business_location_id === locationId
  )
  const heading = showAllLocations || !activeLocation
    ? businessName
    : `${businessName} - ${activeLocation.short_name}`
  const hasMultipleLocations = locations.length > 1
  const [bucket, setBucket] = useState<BusinessHomeBucket>("day")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    return { from: start, to: today }
  })
  const [dashboard, setDashboard] = useState<BusinessHomeDashboardData>(emptyDashboard)
  const [loading, setLoading] = useState(true)
  const initialLoadedFor = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [setupChecklist, setSetupChecklist] = useState<NewBusinessSetupChecklistData | null>(null)
  const [trial, setTrial] = useState<ActiveBusinessTrialData>(null)

  useEffect(() => {
    if (!hasMultipleLocations && showAllLocations) {
      setShowAllLocations(false)
    }
  }, [hasMultipleLocations, showAllLocations])

  useEffect(() => {
    if (!dateRange?.from || !dateRange?.to) return
    if (!showAllLocations && !locationId) {
      setLoading(false)
      return
    }

    const startLocalDay = format(dateRange.from, "yyyy-MM-dd")
    const endLocalDay = format(dateRange.to, "yyyy-MM-dd")

    let active = true
    setLoading(true)
    setError(null)

    const params = {
      startLocalDay,
      endLocalDay,
      locationId,
      includeAllLocations: showAllLocations,
      bucket,
    }
    const initial = initialLoadedFor.current !== authorization.activeBusinessId
    const request = initial ? getBusinessHomeInitialData(params) : getBusinessHomeDashboard(params)
    request
      .then((data) => {
        if (!active) return
        if ('dashboard' in data) {
          setDashboard(data.dashboard)
          setSetupChecklist(data.checklist)
          setTrial(data.trial)
          initialLoadedFor.current = authorization.activeBusinessId
        } else setDashboard(data)
      })
      .catch((fetchError) => {
        console.error(fetchError)
        if (!active) return
        setError("No se pudo cargar el dashboard en este momento.")
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [
    dateRange?.from?.getTime(),
    dateRange?.to?.getTime(),
    locationId,
    showAllLocations,
    bucket,
    authorization.activeBusinessId,
  ])

  const bucketLabels = useMemo(() => getBucketLabels(bucket), [bucket])

  const rangeLabel = useMemo(() => {
    if (!dateRange?.from) return "Selecciona un rango"
    const formatter = new Intl.DateTimeFormat(market.locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
    if (!dateRange.to) return formatter.format(dateRange.from)
    return `${formatter.format(dateRange.from)} - ${formatter.format(dateRange.to)}`
  }, [dateRange?.from, dateRange?.to, market.locale])

  const salesSeries = useMemo(
    () =>
      dashboard.timeseries.sales_over_time.map((point) => ({
        bucket: formatBucketShortLabel(point.bucket, bucket, market.locale),
        fullLabel: formatBucketFullLabel(point.bucket, bucket, market.locale),
        amount: point.amount ?? 0,
      })),
    [bucket, dashboard.timeseries.sales_over_time, market.locale]
  )

  const ordersSeries = useMemo(
    () =>
      dashboard.timeseries.orders_over_time.map((point) => ({
        bucket: formatBucketShortLabel(point.bucket, bucket, market.locale),
        fullLabel: formatBucketFullLabel(point.bucket, bucket, market.locale),
        count: point.count ?? 0,
      })),
    [bucket, dashboard.timeseries.orders_over_time, market.locale]
  )

  const deliveryBreakdown = useMemo(
    () =>
      dashboard.breakdowns.delivery_methods.map((item, index) => ({
        ...item,
        fill: CHART_COLORS[index % CHART_COLORS.length],
      })),
    [dashboard.breakdowns.delivery_methods]
  )

  const paymentBreakdown = useMemo(
    () =>
      dashboard.breakdowns.payment_methods.map((item, index) => ({
        ...item,
        fill: CHART_COLORS[index % CHART_COLORS.length],
      })),
    [dashboard.breakdowns.payment_methods]
  )

  const chartConfig = useMemo(
    () => ({
      amount: { label: "Ventas", color: CHART_COLORS[0] },
      count: { label: "Órdenes", color: CHART_COLORS[0] },
    }),
    []
  )

  const locationSeriesMeta = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; color: string }>()

    dashboard.timeseries.sales_by_location_over_time.forEach((point, index) => {
      if (!seen.has(point.location_id)) {
        seen.set(point.location_id, {
          id: point.location_id,
          label: point.location_name,
          color: CHART_COLORS[seen.size % CHART_COLORS.length],
        })
      }
    })

    return Array.from(seen.values())
  }, [dashboard.timeseries.sales_by_location_over_time])

  const locationChartConfig = useMemo(
    () =>
      locationSeriesMeta.reduce<Record<string, { label: string; color: string }>>(
        (acc, location) => {
          acc[location.id] = {
            label: location.label,
            color: location.color,
          }
          return acc
        },
        {}
      ),
    [locationSeriesMeta]
  )

  const salesByLocationSeries = useMemo(() => {
    const baseRows = new Map<
      string,
      { bucket: string; fullLabel: string } & Record<string, number | string>
    >()

    dashboard.timeseries.sales_over_time.forEach((point) => {
      const fullLabel = formatBucketFullLabel(point.bucket, bucket, market.locale)
      const row: { bucket: string; fullLabel: string } & Record<string, number | string> = {
        bucket: formatBucketShortLabel(point.bucket, bucket, market.locale),
        fullLabel,
      }

      locationSeriesMeta.forEach((location) => {
        row[location.id] = 0
      })

      baseRows.set(point.bucket, row)
    })

    dashboard.timeseries.sales_by_location_over_time.forEach((point) => {
      const existing = baseRows.get(point.bucket)
      if (!existing) return
      existing[point.location_id] = point.amount
    })

    return Array.from(baseRows.values())
  }, [
    bucket,
    dashboard.timeseries.sales_by_location_over_time,
    dashboard.timeseries.sales_over_time,
    locationSeriesMeta,
    market.locale,
  ])

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      {trial ? (
        <section className="flex flex-col gap-3 rounded-2xl bg-[#edf6ff] px-5 py-3.5 text-[#155a9f] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Estás en tu prueba gratis</p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#4d82ba]">Tiempo restante</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-[#155a9f]">{trial.daysRemaining} {trial.daysRemaining === 1 ? "día" : "días"}</p>
          </div>
        </section>
      ) : null}
      <section className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-[1.75rem]">
            ¡Hola{firstName ? `, ${firstName}` : ""}! <span aria-hidden="true">👋</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Aquí tienes un resumen de lo que está pasando en {heading}.
          </p>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="dashboard-control inline-flex p-1">
            {BUCKET_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={bucket === option.value ? "secondary" : "ghost"}
                size="sm"
                className="rounded-lg px-3"
                onClick={() => setBucket(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "dashboard-control h-10 w-full justify-start text-left font-medium sm:w-[285px]",
                  !dateRange?.from && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {rangeLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>

          {hasMultipleLocations ? (
            <div className="dashboard-control flex items-center gap-3 px-4 py-2">
              <div className="space-y-0.5">
                <p className="text-xs font-medium">Todas las ubicaciones</p>
                <p className="text-[11px] text-muted-foreground">Vista global</p>
              </div>
              <Switch
                checked={showAllLocations}
                onCheckedChange={setShowAllLocations}
                aria-label="Mostrar todas las ubicaciones"
              />
            </div>
          ) : null}
        </div>
      </section>

      {setupChecklist ? <NewBusinessSetupChecklist data={setupChecklist} /> : null}

      <BusinessOverviewCard summary={dashboard.summary} loading={loading} />

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.28fr)_minmax(340px,0.92fr)]">
        <MetricChartCard
          title={`Ventas por ${bucketLabels.singular}`}
          description={`Ingresos reconocidos agrupados por ${bucketLabels.singular}.`}
          loading={loading}
          empty={!hasSeriesData(salesSeries, "amount")}
        >
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesSeries}>
                <defs>
                  <linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-amount)" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="var(--color-amount)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={88}
                  tickFormatter={(value) => compactCurrencyFormatter.format(Number(value))}
                />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} minTickGap={24} />
                <Tooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      valueFormatter={(value) => currencyFormatter.format(value)}
                    />
                  }
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke="var(--color-amount)"
                  fill="url(#sales-fill)"
                  strokeWidth={2.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </MetricChartCard>

        <InsightsCard
          loading={loading}
          discountedOrdersCount={dashboard.insights.discounted_orders_count}
          discountedOrdersPct={dashboard.insights.discounted_orders_pct}
          deliveryFeeTotal={dashboard.insights.delivery_fee_total}
          deliveryFeeAvg={dashboard.insights.delivery_fee_avg}
          showDeliveryFees={dashboard.insights.show_delivery_fees}
          deliveryFeeLocationName={dashboard.insights.delivery_fee_location_name}
          cashbackActiveCustomers={dashboard.insights.cashback_active_customers}
          cashbackRedeemedAmount={dashboard.insights.cashback_redeemed_amount}
          showCashbackInsights={dashboard.insights.show_cashback_insights}
        />
      </section>

      <section
        className={cn(
          "grid gap-4",
          showAllLocations ? "xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" : ""
        )}
      >
        <MetricChartCard
          title={`Órdenes por ${bucketLabels.singular}`}
          description={`Cantidad de órdenes incluidas agrupadas por ${bucketLabels.singular}.`}
          loading={loading}
          empty={!hasSeriesData(ordersSeries, "count")}
        >
          <ChartContainer config={chartConfig} className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ordersSeries}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} minTickGap={24} />
                <Tooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      valueFormatter={(value) => countFormatter.format(value)}
                    />
                  }
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                />
                <Bar dataKey="count" fill="var(--color-count)" radius={[5, 5, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </MetricChartCard>

        {showAllLocations ? (
          <MultiLocationSalesCard
            loading={loading}
            items={salesByLocationSeries}
            locations={locationSeriesMeta}
            config={locationChartConfig}
            bucketLabel={bucketLabels.singular}
          />
        ) : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <BreakdownPieCard
          title="Métodos de entrega"
          description="Cómo se distribuyen las órdenes entre canales de entrega."
          loading={loading}
          items={deliveryBreakdown}
        />
        <BreakdownPieCard
          title="Métodos de pago"
          description="Qué formas de pago generan más órdenes y ventas."
          loading={loading}
          items={paymentBreakdown}
        />
      </section>
    </div>
  )
}

function MetricChartCard({
  title,
  description,
  loading,
  empty,
  children,
}: {
  title: string
  description: string
  loading: boolean
  empty: boolean
  children: ReactNode
}) {
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-[15px] tracking-[-0.01em]">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {loading ? (
          <Skeleton className="h-[280px] w-full rounded-xl" />
        ) : empty ? (
          <Empty className="min-h-[280px]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageOpen />
              </EmptyMedia>
              <EmptyTitle>Sin datos en este rango</EmptyTitle>
              <EmptyDescription>
                Ajusta el rango de fechas o cambia el alcance de ubicaciones.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}

function InsightsCard({
  loading,
  discountedOrdersCount,
  discountedOrdersPct,
  deliveryFeeTotal,
  deliveryFeeAvg,
  showDeliveryFees,
  deliveryFeeLocationName,
  cashbackActiveCustomers,
  cashbackRedeemedAmount,
  showCashbackInsights,
}: {
  loading: boolean
  discountedOrdersCount: number
  discountedOrdersPct: number
  deliveryFeeTotal: number
  deliveryFeeAvg: number
  showDeliveryFees: boolean
  deliveryFeeLocationName: string | null
  cashbackActiveCustomers: number
  cashbackRedeemedAmount: number
  showCashbackInsights: boolean
}) {
  const market = useDashboardAuthorization().market
  if (!market) throw new Error("El negocio no tiene configuración regional.")
  const currencyFormatter = new Intl.NumberFormat(market.locale, { style: "currency", currency: market.currencyCode })
  const insightItems = [
    {
      label: "Órdenes con descuento",
      value: countFormatter.format(discountedOrdersCount),
      description: percentFormatter.format(discountedOrdersPct),
      icon: Percent,
    },
    ...(showDeliveryFees
      ? [
          {
            label: "Comisiones de entrega",
            value: currencyFormatter.format(deliveryFeeTotal),
            description: deliveryFeeLocationName
              ? `Para ${deliveryFeeLocationName}`
              : "Acumuladas en el período",
            icon: CircleDollarSign,
          },
          {
            label: "Comisión promedio",
            value: currencyFormatter.format(deliveryFeeAvg),
            description: deliveryFeeLocationName
              ? `Por orden · ${deliveryFeeLocationName}`
              : "Por orden incluida",
            icon: Wallet,
          },
      ]
      : []),
    ...(showCashbackInsights
      ? [
          {
            label: "Clientes con cashback",
            value: countFormatter.format(cashbackActiveCustomers),
            description: "Saldo disponible",
            icon: UsersRound,
          },
          {
            label: "Cashback utilizado",
            value: currencyFormatter.format(cashbackRedeemedAmount),
            description: "En el período",
            icon: HandCoins,
          },
        ]
      : []),
  ]

  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-[15px] tracking-[-0.01em]">Insights rápidos</CardTitle>
        <CardDescription className="text-xs">
          Indicadores complementarios para descuentos y costos relevantes del período.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2.5 px-5">
        {insightItems.map((item) => {
          const Icon = item.icon

          return (
            <div
              key={item.label}
              className="flex min-h-[72px] items-center justify-between gap-4 rounded-xl border border-border/80 bg-card px-3.5 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs font-medium">{item.label}</p>
                  {loading ? (
                    <Skeleton className="h-6 w-28" />
                  ) : (
                    <p className="truncate text-base font-semibold tracking-tight">{item.value}</p>
                  )}
                </div>
              </div>
              <p className="shrink-0 text-right text-[11px] text-muted-foreground">{item.description}</p>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function BreakdownPieCard({
  title,
  description,
  loading,
  items,
}: {
  title: string
  description: string
  loading: boolean
  items: Array<BusinessHomeBreakdownItem & { fill: string }>
}) {
  const market = useDashboardAuthorization().market
  if (!market) throw new Error("El negocio no tiene configuración regional.")
  const currencyFormatter = new Intl.NumberFormat(market.locale, { style: "currency", currency: market.currencyCode })
  const config = useMemo(
    () =>
      items.reduce<Record<string, { label: string; color: string }>>((acc, item) => {
        acc[item.id] = {
          label: item.label,
          color: item.fill,
        }
        return acc
      }, {}),
    [items]
  )

  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-[15px] tracking-[-0.01em]">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 px-5 lg:grid-cols-[190px_minmax(0,1fr)] lg:items-center">
        {loading ? (
          <>
            <Skeleton className="mx-auto size-[190px] rounded-full" />
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </>
        ) : items.length === 0 ? (
          <div className="lg:col-span-2">
            <Empty className="min-h-[260px]">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MapPin />
                </EmptyMedia>
                <EmptyTitle>Sin distribución disponible</EmptyTitle>
                <EmptyDescription>
                  Cuando entren órdenes en este rango, verás la mezcla de canales aquí.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <>
            <ChartContainer config={config} className="mx-auto h-[190px] w-full max-w-[190px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        hideLabel
                        valueFormatter={(value, key) => {
                          const item = items.find((entry) => entry.id === key)
                          if (!item) return countFormatter.format(value)
                          return `${countFormatter.format(item.orders_count)} órdenes`
                        }}
                      />
                    }
                  />
                  <Pie
                    data={items}
                    dataKey="orders_count"
                    nameKey="id"
                    innerRadius={50}
                    outerRadius={76}
                    paddingAngle={3}
                  >
                    {items.map((item) => (
                      <Cell key={item.id} fill={item.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>

            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-border/80 bg-muted/20 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: item.fill }}
                      />
                      <p className="font-medium">{item.label}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {percentFormatter.format(item.pct_orders)}
                    </p>
                  </div>
                  {item.instructions ? (
                    <p className="mt-1 text-xs text-muted-foreground">{item.instructions}</p>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span>{countFormatter.format(item.orders_count)} órdenes</span>
                    <span className="font-medium">
                      {currencyFormatter.format(item.sales_amount)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function MultiLocationSalesCard({
  loading,
  items,
  locations,
  config,
  bucketLabel,
}: {
  loading: boolean
  items: Array<{ bucket: string; fullLabel: string } & Record<string, number | string>>
  locations: Array<{ id: string; label: string; color: string }>
  config: Record<string, { label: string; color: string }>
  bucketLabel: string
}) {
  const market = useDashboardAuthorization().market
  if (!market) throw new Error("El negocio no tiene configuración regional.")
  const currencyFormatter = new Intl.NumberFormat(market.locale, { style: "currency", currency: market.currencyCode })
  const compactCurrencyFormatter = new Intl.NumberFormat(market.locale, { style: "currency", currency: market.currencyCode, notation: "compact", maximumFractionDigits: 1 })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ventas por ubicación</CardTitle>
        <CardDescription>
          Barras apiladas por {bucketLabel} para ver aporte y mezcla de cada ubicación.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <>
            <Skeleton className="h-[320px] w-full rounded-xl" />
          </>
        ) : locations.length === 0 ? (
          <Empty className="min-h-[320px]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageOpen />
              </EmptyMedia>
              <EmptyTitle>Sin comparación entre ubicaciones</EmptyTitle>
              <EmptyDescription>
                Activa todas las ubicaciones en un rango con ventas para ver esta curva.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <ChartContainer config={config} className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={items}>
                  <CartesianGrid vertical={false} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={88}
                    tickFormatter={(value) => compactCurrencyFormatter.format(Number(value))}
                  />
                  <XAxis dataKey="bucket" tickLine={false} axisLine={false} minTickGap={24} />
                  <Tooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        valueFormatter={(value) => currencyFormatter.format(value)}
                      />
                    }
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                  />
                  {locations.map((location) => (
                    <Bar
                      key={location.id}
                      dataKey={location.id}
                      stackId="locations"
                      fill={location.color}
                      radius={[2, 2, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>

            <div className="flex flex-wrap gap-2">
              {locations.map((location) => (
                <div
                  key={location.id}
                  className="flex items-center gap-2 rounded-full border bg-muted/20 px-3 py-1.5 text-sm"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: location.color }}
                  />
                  <span>{location.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function hasSeriesData<T extends Record<string, number | string>>(data: T[], key: keyof T) {
  return data.some((item) => Number(item[key] ?? 0) > 0)
}

function getBucketLabels(bucket: BusinessHomeBucket) {
  if (bucket === "week") {
    return { singular: "semana" }
  }

  if (bucket === "month") {
    return { singular: "mes" }
  }

  return { singular: "día" }
}

function formatBucketShortLabel(bucketStart: string, bucket: BusinessHomeBucket, locale: string) {
  const date = parseISO(bucketStart)
  const shortDateFormatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" })
  const monthLabelFormatter = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" })

  if (bucket === "week") {
    return `Sem ${shortDateFormatter.format(date)}`
  }

  if (bucket === "month") {
    return capitalizeFirst(monthLabelFormatter.format(date))
  }

  return capitalizeFirst(shortDateFormatter.format(date))
}

function formatBucketFullLabel(bucketStart: string, bucket: BusinessHomeBucket, locale: string) {
  const date = parseISO(bucketStart)
  const longDateFormatter = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
  const monthLongFormatter = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" })

  if (bucket === "week") {
    return `Semana del ${longDateFormatter.format(date)}`
  }

  if (bucket === "month") {
    return capitalizeFirst(monthLongFormatter.format(date))
  }

  return capitalizeFirst(longDateFormatter.format(date))
}

function capitalizeFirst(value: string) {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}
