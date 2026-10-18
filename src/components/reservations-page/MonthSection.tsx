import { ArrowLeft, ArrowRight } from "lucide-react"
import { Button } from "../ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Calendar } from "../ui/calendar"
import { Dispatch, SetStateAction } from "react"
import { addMonths, subMonths } from "date-fns"

export default function MonthSection({
  currentDate,
  setCurrentDate,
}: {
  currentDate: Date
  setCurrentDate: Dispatch<SetStateAction<Date>>
}) {
  const goToPreviousMonth = () => {
    setCurrentDate((prev) => subMonths(prev, 1))
  }

  const goToNextMonth = () => {
    setCurrentDate((prev) => addMonths(prev, 1))
  }

  return (
    <div className="flex flex-row items-center justify-center gap-4">
      <Button variant="secondary" size="icon" onClick={goToPreviousMonth}>
        <ArrowLeft />
      </Button>
      <div className="text-sm">
        {currentDate.toLocaleDateString("es-ES", {
          month: "long",
          year: "numeric",
        }).toLocaleUpperCase()}
      </div>

      <Button variant="secondary" size="icon" onClick={goToNextMonth}>
        <ArrowRight />
      </Button>
    </div>
  )
}
