import { ShoppingBag } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export function ComingSoon() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShoppingBag />
        </EmptyMedia>
        <EmptyTitle>Funcionalidad en desarrollo</EmptyTitle>
        <EmptyDescription>
          En mediasis estamos mejorando todos los días, pronto podrás manejar el
          menú de tu app desde el panel de administración.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" disabled>
          Próximamente
        </Button>
      </EmptyContent>
    </Empty>
  )
}
