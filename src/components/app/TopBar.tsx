"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { topBarOptions } from "@/lib/dashboardData"
import { cn, normalizePath } from "@/lib/utils"
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider"

type TopBarProps = {
  pathname: string | null
}

export default function TopBar({ pathname }: TopBarProps) {
  const basePath = "/admin/app"
  const authorization = useDashboardAuthorization()
  const options = authorization.mode === "clerk"
    ? topBarOptions.filter((option) => ["/start", "/checkout", "/appearance"].includes(normalizePath(option.url)))
    : topBarOptions

  return (
    <div className="w-full border-b">
      <div className="flex w-full items-end gap-8">
        {options.map((option) => {
          const optionPath = normalizePath(option.url)
          const href = `${basePath}${optionPath}`
          const isActive =
            pathname === href || (pathname?.startsWith(href + "/") ?? false)

          return (
            <Button
              key={option.name}
              asChild
              variant="ghost"
              className={cn(
                "h-auto rounded-none px-1 pb-3 pt-2 text-sm font-medium text-foreground/70 hover:bg-transparent hover:text-foreground -mb-px border-b-2 border-transparent",
                isActive && "text-foreground border-foreground"
              )}
            >
              <Link aria-current={isActive ? "page" : undefined} href={href}>
                {option.name}
              </Link>
            </Button>
          )
        })}
      </div>
    </div>
  )
}
