"use client"

import Link from "next/link"
import { Check, Circle, PackagePlus, Palette, CreditCard } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export type NewBusinessSetupChecklistData = {
  firstProductCompleted: boolean
  appearanceCompleted: boolean
  paymentMethodCompleted: boolean
  completedSteps: number
  totalSteps: number
  canManageProducts: boolean
  canManageAppearance: boolean
  canManagePaymentMethods: boolean
}

export function NewBusinessSetupChecklist({ data }: { data: NewBusinessSetupChecklistData }) {
  if (data.completedSteps === data.totalSteps) return null

  const nextStep = !data.firstProductCompleted
    ? { label: "Creá tu primer producto", href: "/admin/products", icon: PackagePlus, allowed: data.canManageProducts }
    : !data.appearanceCompleted
      ? { label: "Personalizá tu app", href: "/admin/app/appearance", icon: Palette, allowed: data.canManageAppearance }
      : { label: "Configurá cómo te pagan", href: "/admin/app/payment-methods", icon: CreditCard, allowed: data.canManagePaymentMethods }
  const Icon = nextStep.icon
  const steps = [
    { label: "Creá tu primer producto", complete: data.firstProductCompleted },
    { label: "Personalizá la apariencia de tu app", complete: data.appearanceCompleted },
    { label: "Configurá cómo te pagan", complete: data.paymentMethodCompleted },
  ]

  return (
    <Card className="overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="text-base font-semibold">Poné tu negocio en marcha</p>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                {data.completedSteps} de {data.totalSteps} completados
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {steps.map((step) => (
                <div key={step.label} className="flex items-center gap-2 text-sm">
                  {step.complete
                    ? <span className="grid size-5 place-items-center rounded-full bg-emerald-500 text-white"><Check className="size-3.5" /></span>
                    : <Circle className="size-5 text-muted-foreground/60" />}
                  <span className={step.complete ? "text-muted-foreground line-through" : "font-medium"}>{step.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground sm:flex"><Icon className="size-5" /></div>
            {nextStep.allowed ? <Button asChild><Link href={nextStep.href}>{nextStep.label}</Link></Button> : <p className="max-w-56 text-sm text-muted-foreground">Pedile a un administrador que complete este paso.</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
