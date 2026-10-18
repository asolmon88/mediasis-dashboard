"use client"

import type { ReactNode } from "react"
import { Eye, ShoppingBag, Ticket, TrendingUp } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { BusinessHomeSummary } from "@/lib/types/dashboardTypes"
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider"

type BusinessOverviewCardProps = {
  summary: BusinessHomeSummary
  loading?: boolean
}

const countFormatter = new Intl.NumberFormat("en-US")

export default function BusinessOverviewCard({
  summary,
  loading = false,
}: BusinessOverviewCardProps) {
  const market = useDashboardAuthorization().market
  if (!market) throw new Error("El negocio no tiene configuración regional.")
  const currencyFormatter = new Intl.NumberFormat(market.locale, { style: "currency", currency: market.currencyCode })
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <SummaryStatCard
        label="Ventas totales"
        value={currencyFormatter.format(summary.gross_sales)}
        icon={<TrendingUp className="size-5" />}
        tone="blue"
        loading={loading}
      />
      <SummaryStatCard
        label="Órdenes"
        value={countFormatter.format(summary.orders_count)}
        icon={<ShoppingBag className="size-5" />}
        tone="green"
        loading={loading}
      />
      <SummaryStatCard
        label="Ticket promedio"
        value={currencyFormatter.format(summary.avg_ticket)}
        icon={<Ticket className="size-5" />}
        tone="violet"
        loading={loading}
      />
      <SummaryStatCard
        label="Visitas"
        value={countFormatter.format(summary.views)}
        icon={<Eye className="size-5" />}
        tone="coral"
        loading={loading}
      />
    </section>
  )
}

function SummaryStatCard({
  label,
  value,
  icon,
  loading,
  tone,
}: {
  label: string
  value: string
  icon: ReactNode
  loading: boolean
  tone: "blue" | "green" | "violet" | "coral"
}) {
  const tones = {
    blue: "bg-blue-50 text-primary dark:bg-primary/15",
    green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
    violet: "bg-violet-50 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
    coral: "bg-rose-50 text-mediasis dark:bg-mediasis/15",
  }

  return (
    <Card className="gap-0 py-0 transition-transform duration-200 hover:-translate-y-0.5">
      <CardContent className="flex items-start gap-4 p-5">
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</div>
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="h-8 w-28" />
          ) : (
            <p className="truncate text-xl font-semibold tracking-[-0.025em] xl:text-2xl">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
