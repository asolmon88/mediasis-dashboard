"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode
    color?: string
  }
>

type ChartContextValue = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextValue | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error("Chart components must be used inside ChartContainer")
  }

  return context
}

function ChartContainer({
  config,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
}) {
  const style = React.useMemo(
    () =>
      Object.entries(config).reduce<Record<string, string>>((acc, [key, value]) => {
        if (value.color) {
          acc[`--color-${key}`] = value.color
        }

        return acc
      }, {}),
    [config]
  )

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        className={cn(
          "flex aspect-auto justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/60 [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector:focus]:outline-none [&_.recharts-tooltip-cursor]:stroke-border [&_.recharts-tooltip-cursor]:fill-muted [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-layer]:outline-none",
          className
        )}
        style={style}
        {...props}
      >
        {children}
      </div>
    </ChartContext.Provider>
  )
}

function ChartTooltipContent({
  active,
  payload,
  label,
  valueFormatter,
  hideLabel = false,
}: {
  active?: boolean
  payload?: Array<{
    dataKey?: string | number
    name?: string
    value?: number | string
    color?: string
  }>
  label?: string
  valueFormatter?: (value: number, key: string) => string
  hideLabel?: boolean
}) {
  const { config } = useChart()

  if (!active || !payload?.length) {
    return null
  }

  return (
    <div className="min-w-40 rounded-lg border bg-background px-3 py-2 text-sm shadow-md">
      {!hideLabel && label ? (
        <div className="mb-2 text-xs font-medium text-muted-foreground">{label}</div>
      ) : null}
      <div className="space-y-1.5">
        {payload.map((item) => {
          const key = String(item.name ?? item.dataKey ?? "")
          const color = item.color ?? config[key]?.color ?? "var(--color-chart-1)"
          const rawValue = Number(item.value ?? 0)

          return (
            <div key={key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-muted-foreground">
                  {config[key]?.label ?? item.name ?? key}
                </span>
              </div>
              <span className="font-medium text-foreground">
                {valueFormatter ? valueFormatter(rawValue, key) : rawValue}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { ChartContainer, ChartTooltipContent }
