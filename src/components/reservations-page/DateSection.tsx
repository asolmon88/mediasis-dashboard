import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Calendar } from "../ui/calendar";
import { Dispatch, SetStateAction } from "react";

export default function DateSection({
  currentDate,
  setCurrentDate,
  goToPreviousDay,
  goToNextDay
}:{
  currentDate: Date,
  setCurrentDate: Dispatch<SetStateAction<Date>>,
  goToPreviousDay: () => void,
  goToNextDay: () => void,
}) {
  return (
    <div className="flex flex-row items-center justify-center gap-4">
      <div className="flex flex-col items-center justify-center space-y-2">
        <Button variant="secondary" size="icon" onClick={goToPreviousDay}>
          <ArrowLeft/>
        </Button>
        <p className="text-xs text-primary">
          {new Date(
            new Date(currentDate).setDate(currentDate.getDate() - 1)
          ).toLocaleDateString("es-ES", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            {currentDate.toLocaleDateString("es-ES", {
              day: "numeric",
              month: "long",
              year: "numeric"
            })}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <Calendar
            mode="single"
            defaultMonth={currentDate}
            selected={currentDate}
            onSelect={(date) => { if (date) setCurrentDate(date); }}
            className="rounded-lg border"
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex flex-col items-center justify-center space-y-2">
        <Button variant="secondary" size="icon" onClick={goToNextDay}>
          <ArrowRight/>
        </Button>
        <p className="text-xs text-primary">
          {new Date(
            new Date(currentDate).setDate(currentDate.getDate() + 1)
          ).toLocaleDateString("es-ES", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })}
        </p>
      </div>
    </div>
  );
}