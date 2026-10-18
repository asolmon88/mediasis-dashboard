import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Edit2, Loader2Icon, Plus } from "lucide-react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { ClosedSpecialDaySchema } from "@/lib/FormSchemas/closedSpecialDaySchema"
import { TimeSlotPicker } from "../reservations-page/TimeSlotPicker"
import { minutesToTime, timeToMinutes } from "@/lib/utils"
import { Textarea } from "../ui/textarea"
import { useState } from "react"
import { toast } from "sonner"
import { upsertClosedDays as  upsertClosedDaysReservation} from "@/app/admin/closed-days/actions"
import { upsertClosedDays as  upsertClosedDaysOrders} from "@/app/admin/app/closed-special-hours/actions"
import React from "react"
import { useActiveLocationId } from "@/stores/location-store"
import { useReservationLocation } from "@/hooks/use-reservation-location"

export function ClosedSpecialForm({
  edit = false,
  active_daterange,
  closed_all_day,
  hours,
  note,
  type = 'reservation',
  onChanged,
}:{
  edit?: boolean,
  active_daterange?: {
    from?: Date | undefined;
    to?: Date | undefined;
  },
  closed_all_day?: boolean,
  hours?: {
    start?: number | undefined;
    end?: number | undefined;
  },
  note?: string;
  type?: 'orders' | 'reservation';
  onChanged?: () => void;
}) {
  const orderingLocationId = useActiveLocationId();
  const { activeLocationId: reservationLocationId } = useReservationLocation();
  const activeLocationId = type === "reservation" ? reservationLocationId : orderingLocationId;
  const [loading, setLoading] = useState(false);
  const form = useForm<z.infer<typeof ClosedSpecialDaySchema>>({
    resolver: zodResolver(ClosedSpecialDaySchema),
    defaultValues: {
      active_daterange: active_daterange || {
        from: undefined,   // no date selected yet
        to: undefined,     // no end date selected
      },
      closed_all_day: closed_all_day || false,
      hours: hours || undefined,    // no hours by default
      note: note || "",
    },
  })

  React.useEffect(() => {
    form.register("active_daterange.from");
    form.register("active_daterange.to");
  }, [form]);

  // if you receive props with both dates, push them in once:
  React.useEffect(() => {
    if (active_daterange?.from) {
      form.setValue("active_daterange.from", active_daterange.from, { shouldDirty: false });
    }
    if (active_daterange?.to) {
      form.setValue("active_daterange.to", active_daterange.to, { shouldDirty: false });
    }
  }, [active_daterange, form]);

  async function onSubmit(values: z.infer<typeof ClosedSpecialDaySchema>) {
    if (!activeLocationId) {
      toast.error("Selecciona una ubicación activa.");
      return;
    }
    setLoading(true);
    const parsed = ClosedSpecialDaySchema.safeParse(values);
    if (parsed.success) {
      const upsert =
        type === 'reservation' ?
          await upsertClosedDaysReservation(parsed.data, activeLocationId)
          :
          await upsertClosedDaysOrders(parsed.data, activeLocationId)
      if (!upsert.success) {
        toast.error(upsert.message)
      } else {
        toast.success('Guardado!')
        onChanged?.()
      }
    } else {
      toast.error(z.prettifyError(parsed.error))
    }
    setLoading(false);
  }

  const closedAllDay = form.watch("closed_all_day")

  return (
    <Dialog>
      <DialogTrigger asChild>
        {edit ?
          <Button type="button" variant="outline" size="sm" onClick={() => console.log('edit')} className="rounded-full">
            <Edit2 />
          </Button> :
          <Button variant="outline">
            <Plus/>
            Agregar
          </Button>
        }
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit, (errors) => {
            console.log("Form validation errors:", errors)
          })} className="space-y-8">
            <DialogHeader>
              <DialogTitle>Agregar</DialogTitle>
              <DialogDescription>
                Agrega un día de cierre u horario especial.<br/>
                <span className="font-bold">Fecha{active_daterange?.to && 's'}:</span> {active_daterange?.from?.toLocaleString().split(',')[0]}{active_daterange?.to ? `-${active_daterange?.to.toLocaleString().split(',')[0]}` : ''}
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="closed_all_day"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <FormControl>
                    <Select
                      onValueChange={(v) => {
                        const bool = v === "true"
                        field.onChange(bool)
                        if (bool) {
                          form.setValue("hours", undefined, { shouldValidate: true, shouldDirty: true }) // 👈 clear hours
                        }
                      }}
                      value={String(field.value)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Theme" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Cierre del día</SelectItem>
                        <SelectItem value="false">Horario especial</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>
                    Seleccione si quiere hacer un cierre del día o definir un horario especial.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {!closedAllDay && (
              <>
                <FormField
                  control={form.control}
                  name={`hours.start`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Horario de inicio</FormLabel>
                      <FormControl>
                        <TimeSlotPicker
                          value={minutesToTime(field.value)}          // minutes -> "HH:MM"
                          onChange={(s) => field.onChange(timeToMinutes(s))} // "HH:MM" -> minutes
                          startHour={0}
                          endHour={24}
                          stepMinutes={30}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`hours.end`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Horario de cierre</FormLabel>
                      <FormControl>
                        <TimeSlotPicker
                          value={minutesToTime(field.value)}          // minutes -> "HH:MM"
                          onChange={(s) => field.onChange(timeToMinutes(s))} // "HH:MM" -> minutes
                          startHour={0}
                          endHour={24}
                          stepMinutes={30}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </>
            )}
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nota para los clientes</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Describele a tus clientes la razón de este cierre u horario especial" {...field} className="text-sm"/>
                  </FormControl>
                  <FormDescription>
                    Razón de cierre u horario especial.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancelar</Button>
              </DialogClose>
              <Button type="submit" disabled={loading}>
                {!loading ?
                  "Guardar" : (
                    <div className="flex flex-row items-center justify-center gap-2">
                      <Loader2Icon className="animate-spin" />
                      Guardando
                    </div>
                  )
                }
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
