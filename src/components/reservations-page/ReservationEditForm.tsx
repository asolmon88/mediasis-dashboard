"use client"
 
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useWatch } from "react-hook-form"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { ChevronDownIcon, Loader2Icon } from "lucide-react"
import { useState } from "react"
import { Popover, PopoverContent } from "../ui/popover"
import { PopoverTrigger } from "@radix-ui/react-popover"
import { Calendar } from "../ui/calendar"
import { TimeSlotPicker } from "./TimeSlotPicker"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../ui/select"
import { updateReservation } from "@/app/admin/reservations/actions"
import { Reservation } from "@/lib/types/dashboardTypes"
import { toast } from "sonner"
import { ReservationEditInput, ReservationEditSchema } from "@/lib/FormSchemas/reseravtionEditSchema"
import { statusOptions } from "@/lib/dashboardData"
import { ReservationSchema } from "@/lib/FormSchemas/reservationSchema"
import { toReservationEditFormValues, toReservationFormValues } from "@/lib/utils"
import z from "zod"
import { useCurrentOpenHours } from "@/hooks/use-current-user-open-hours"
import { GroupSizePicker } from "./GroupSizePicker"

const toStatus = (s: string) => {
  const allowed = ["pending", "confirmed", "seated", "done", "cancelled"] as const;
  return (allowed as readonly string[]).includes(s) ? (s as typeof allowed[number]) : "pending";
};

const hhmmLocal = (d: string | Date) => {
  const dt = new Date(d);
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

export default function ReservationEditForm({ reservation }:{
  reservation: Reservation;
}) {
  const [loading, setLoading] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false)
  const openHours= useCurrentOpenHours();
    
  function getDayIndex(date: Date): number {
    // Sunday=0 → make it 6, and shift others down
    const d = date.getDay(); // 0 (Sun) .. 6 (Sat)
    return (d + 6) % 7;      // Monday=0, Tuesday=1, ... Sunday=6
  }

  const form = useForm<ReservationEditInput>({
    resolver: zodResolver(ReservationEditSchema),
    defaultValues: {
      group_size: Number(reservation.size),
      date: new Date(reservation.date),
      time: hhmmLocal(reservation.date),
      status: toStatus(reservation.status),
    },
  })

  async function onSubmit(values: ReservationEditInput) {
    setLoading(true);
    const validate = ReservationEditSchema.safeParse(values);
    if (validate.success) {
      const processedValues = toReservationEditFormValues(values);
      const update = await updateReservation(reservation.id, values, processedValues)
  
      if (update.success) {
        toast.success(update.message)
      } else {
        toast.error(update.message);
      }
    } else {
      toast.error(z.prettifyError(validate.error));
    }
    setLoading(false);
  }
  const selectedDate = useWatch({ control: form.control, name: "date" });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="group_size"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tamaño del grupo</FormLabel>
              <FormControl>
                <GroupSizePicker
                  value={field.value}
                  onChange={(n) => field.onChange(n)}
                  min={1}
                  max={100}   // ajústalo si necesitas 500, 999, etc.
                  quickCount={10}
                />
              </FormControl>
              <FormDescription>Cantidad exacta de comensales.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* Día */}
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Día</FormLabel>
              <FormControl>
                <div className="flex flex-col gap-3">
                  <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        id="date-picker"
                        className="w-48 justify-between font-normal"
                      >
                        {field.value
                          ? field.value.toLocaleDateString("es-ES")
                          : "Seleccionar fecha"}
                        <ChevronDownIcon />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        captionLayout="dropdown"
                        onSelect={(date) => {
                          if (!date) return;
                          field.onChange(date);
                          setOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Hora */}
        <FormField
          control={form.control}
          name="time"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Hora</FormLabel>
              <FormControl>
                <div className="flex flex-col gap-3">
                  <TimeSlotPicker
                    value={field.value}
                    onChange={field.onChange}
                    startHour={9}
                    endHour={22}
                    stepMinutes={30}
                    openWindows={openHours.weekdays ? openHours.weekdays[getDayIndex(selectedDate)].hours : undefined}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Estado</FormLabel>
              <FormControl>
                <Select
                  value={field.value}                    // controlled
                  onValueChange={field.onChange}         // returns the english code (e.g. "pending")
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Selecciona estado" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusOptions).map(([spanish, english]) => (
                      <SelectItem key={english} value={english}>
                        {spanish}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormDescription>Selecciona el estado de la reservación.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button size="sm" disabled={loading} type="submit">
          {loading ? 
            <>
              <Loader2Icon className="animate-spin" />
              Actualizando
            </> :
            <>Actualizar Reserva</>
          }
        </Button>
      </form>
    </Form>
  );
}
