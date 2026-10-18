import { useEffect, useMemo, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import StorefrontVisualPreview from "./StorefrontVisualPreview"

type PhoneProps = {
  domain?: string | null
  title?: string
  livePreview?: {
    businessName: string
    locationName: string
    phone: string
    slug: string
    primaryColor: string
    backgroundColor: string
    logoUrl?: string
    productName?: string | null
    productPrice?: string | number | null
    productDescription?: string | null
    productImageUrl?: string | null
    productSkipped?: boolean
    cashEnabled?: boolean
    pickupEnabled?: boolean
    tableEnabled?: boolean
  }
}

export default function Phone({
  domain,
  title = "Phone preview",
  livePreview,
}: PhoneProps) {
  const IOS_VIEWPORT_WIDTH = 393
  // The status-bar inset is translated outside the scaled storefront viewport.
  // Keep the content height to the remaining visible phone area.
  const IOS_VIEWPORT_HEIGHT = 792
  const TOP_SAFE_INSET = 43

  const [refreshKey, setRefreshKey] = useState(0)
  const [previewScale, setPreviewScale] = useState(1)
  const previewViewportRef = useRef<HTMLDivElement | null>(null)
  const normalizedDomain = (() => {
    const trimmed = domain?.trim() ?? ""
    if (!trimmed) return ""
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return `https://${trimmed}`
  })()
  const iframeSrc = useMemo(() => {
    if (!normalizedDomain) return ""
    try {
      const url = new URL(normalizedDomain)
      if (refreshKey) url.searchParams.set("refresh", String(refreshKey))
      return url.toString()
    } catch {
      return normalizedDomain
    }
  }, [normalizedDomain, refreshKey])
  useEffect(() => {
    const viewport = previewViewportRef.current
    if (!viewport) return

    const updateScale = () => {
      const { width, height } = viewport.getBoundingClientRect()
      if (!width || !height) return
      const widthScale = width / IOS_VIEWPORT_WIDTH
      const heightScale = height / IOS_VIEWPORT_HEIGHT
      setPreviewScale(Math.min(widthScale, heightScale))
    }

    updateScale()
    const observer = new ResizeObserver(() => updateScale())
    observer.observe(viewport)
    window.addEventListener("resize", updateScale)

    return () => {
      observer.disconnect()
      window.removeEventListener("resize", updateScale)
    }
  }, [])

  return (
    <div>
      <div className="mb-3 flex w-[312px] items-center justify-between text-xs text-foreground">
        <span>{livePreview ? "Vista previa visual · No interactiva" : "Vista previa de la app"}</span>
        {!livePreview && iframeSrc ? <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1 font-medium text-blue-600 transition-colors hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setRefreshKey(Date.now())}
          aria-label="Actualizar vista previa de la app"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Actualizar
        </button> : null}
      </div>
      <div className="relative w-[312px]">
        <div className="relative aspect-[1313/2674] w-full">
          <div
            ref={previewViewportRef}
            className="absolute overflow-hidden rounded-[9.5%]"
            style={{
              left: "5.1%",
              top: "2.2%",
              width: "89.8%",
              height: "95.6%",
              backgroundColor: "black",
            }}
          >
            {livePreview ? <div
              aria-label={title}
              title={title}
              className="absolute left-0 top-0 origin-top-left overflow-hidden bg-background"
              style={{
                width: `${IOS_VIEWPORT_WIDTH}px`,
                height: `${IOS_VIEWPORT_HEIGHT}px`,
                transform: `translateY(${TOP_SAFE_INSET}px) scale(${previewScale})`,
              }}
            ><StorefrontVisualPreview {...livePreview} /></div> : iframeSrc ? <iframe
              key={refreshKey}
              title={title} src={iframeSrc}
              className="absolute left-0 top-0 origin-top-left border-0 bg-background"
              style={{ width: `${IOS_VIEWPORT_WIDTH}px`, height: `${IOS_VIEWPORT_HEIGHT}px`, transform: `translateY(${TOP_SAFE_INSET}px) scale(${previewScale})` }}
              loading="lazy" referrerPolicy="no-referrer"
            /> : <div className="grid h-full place-items-center bg-muted px-6 text-center text-xs text-muted-foreground">Tu vista previa aparecerá cuando el link de la app esté listo.</div>}
          </div>

          <img
            src="/images/iphone-frame.svg"
            alt="iPhone frame"
            className="pointer-events-none absolute inset-0 h-full w-full select-none"
            draggable={false}
          />
        </div>
      </div>
    </div>
  )
}
