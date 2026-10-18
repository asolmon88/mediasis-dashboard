"use client"

import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Control, Controller, useFieldArray, useForm, useFormContext } from "react-hook-form"
import { OpenHours, OpenHoursSchema } from "@/lib/FormSchemas/openHoursSchema"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Loader2Icon, ChevronDown, Copy, Plus, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { upsertOpenHours as upsertOpenHoursReservation} from "@/app/admin/open-hours/actions"
import { getReservationOpenHours } from "@/app/admin/open-hours/actions"
import { getOrderingOpenHours, upsertOpenHours as upsertOpenHoursOrders} from "@/app/admin/app/open-hours/actions"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import ApplyScheduleDialog from "@/components/locations/ApplyScheduleDialog"
import { useActiveLocationId, useLocationStore } from "@/stores/location-store"
import { useReservationLocation } from "@/hooks/use-reservation-location"

function minutesToTime(total: number): string {
  const h = Math.floor(total / 60).toString().padStart(2, "0");
  const m = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

function generateTimeSlots(stepMinutes = 30, startHour = 0, endHour = 24): string[] {
  const slots: string[] = [];
  for (let h = startHour; h <= endHour; h++) {
    for (let m = 0; m < 60; m += stepMinutes) {
      if (h === endHour && m > 0) break;
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return slots;
}

function TimeFieldWithQuickSelect({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value: string) => void;
}) {
  const [hourPart = "", minutePart = ""] = (value ?? "").split(":");
  const slots = useMemo(() => generateTimeSlots(30, 0, 24), []);

  const updateHour = (raw: string) => {
    const nextHour = raw.replace(/\D/g, "").slice(0, 2);
    onChange(`${nextHour}:${minutePart}`);
  };

  const updateMinute = (raw: string) => {
    const nextMinute = raw.replace(/\D/g, "").slice(0, 2);
    onChange(`${hourPart}:${nextMinute}`);
  };

  return (
    <div className="flex items-center gap-0.5">
      <Input
        value={hourPart}
        onChange={(e) => updateHour(e.target.value)}
        placeholder="HH"
        inputMode="numeric"
        className="w-11 px-1 text-center"
      />
      <span className="text-sm">:</span>
      <Input
        value={minutePart}
        onChange={(e) => updateMinute(e.target.value)}
        placeholder="MM"
        inputMode="numeric"
        className="w-11 px-1 text-center"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="size-8 rounded-md">
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-60 w-24 overflow-y-auto p-1">
          {slots.map((slot) => (
            <DropdownMenuItem key={slot} onSelect={() => onChange(slot)}>
              {slot}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function CopyDayDropdown({ dayIndex }: { dayIndex: 0|1|2|3|4|5|6 }) {
  const form = useFormContext<OpenHours>();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const otherDays = DAYS.map((_, i) => i).filter(i => i !== dayIndex);
  const allSelected = selected.size === otherDays.length;

  const toggleDay = (day: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(otherDays));
  };

  const handleCopy = () => {
    const source = form.getValues(`weekdays.${dayIndex}.hours`);
    selected.forEach(target => {
      form.setValue(
        `weekdays.${target as 0|1|2|3|4|5|6}.hours`,
        structuredClone(source),
        { shouldDirty: true, shouldValidate: true, shouldTouch: true }
      );
    });
    toast.success(`Horario de ${DAYS[dayIndex]} copiado`);
    setOpen(false);
    setSelected(new Set());
  };

  return (
    <DropdownMenu open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSelected(new Set()); }}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
          <Copy /> Copiar a…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuCheckboxItem
          checked={allSelected}
          onCheckedChange={toggleAll}
          onSelect={(e) => e.preventDefault()}
        >
          Todos los días
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {otherDays.map(day => (
          <DropdownMenuCheckboxItem
            key={day}
            checked={selected.has(day)}
            onCheckedChange={() => toggleDay(day)}
            onSelect={(e) => e.preventDefault()}
          >
            {DAYS[day]}
          </DropdownMenuCheckboxItem>
        ))}
        <div className="p-1">
          <Button type="button" size="sm" className="w-full" disabled={selected.size === 0} onClick={handleCopy}>
            Copiar
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DayHoursFieldArray({ control, dayIndex }: {
  control: Control<OpenHours>; dayIndex: 0|1|2|3|4|5|6;
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `weekdays.${dayIndex}.hours`,
  });

  return (
    <FormField
      control={control}
      name={`weekdays.${dayIndex}.hours`}
      render={() => (
        <FormItem className="rounded-2xl border bg-card p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <FormLabel className="mb-auto">{DAYS[dayIndex]}</FormLabel>
            <CopyDayDropdown dayIndex={dayIndex} />
          </div>
          {fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-1">
              <Controller
                control={control}
                name={`weekdays.${dayIndex}.hours.${i}.start`}
                render={({ field }) => (
                  <FormControl>
                    <TimeFieldWithQuickSelect value={field.value} onChange={field.onChange} />
                  </FormControl>
                )}
              />
              <span className="px-1 text-muted-foreground">-</span>
              <Controller
                control={control}
                name={`weekdays.${dayIndex}.hours.${i}.end`}
                render={({ field }) => (
                  <FormControl>
                    <TimeFieldWithQuickSelect value={field.value} onChange={field.onChange} />
                  </FormControl>
                )}
              />
              <Button type="button" variant="destructive" size="sm" onClick={() => remove(i)} className="rounded-full">
                <X />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => append({ start: "09:00", end: "17:00" })}
            className="mt-auto"
          >
            <Plus/>
          </Button>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export default function ScheduleConfigForm({type = 'reservation', canManageAllLocations = true}:{type?: 'orders' | 'reservation'; canManageAllLocations?: boolean}) {
  const generalActiveLocationId = useActiveLocationId();
  const reservationLocation = useReservationLocation();
  const activeLocationId = type === 'reservation' ? reservationLocation.activeLocationId : generalActiveLocationId;
  const setLocationChangeBlocked = useLocationStore(
    (state) => state.setLocationChangeBlocked
  );
  const [loading, setLoading] = useState<boolean>(false)
  const [loadingDBWeekdays, setLoadingDBWeekdays] = useState<boolean>(false);

  const form = useForm<OpenHours>({
    resolver: zodResolver(OpenHoursSchema),
    defaultValues: {
      weekdays: [
        { weekday: 1, hours: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }] },
        { weekday: 2, hours: [] },
        { weekday: 3, hours: [{ start: "11:00", end: "15:00" }] },
        { weekday: 4, hours: [{ start: "18:00", end: "23:30" }] },
        { weekday: 5, hours: [{ start: "00:00", end: "02:00" }, { start: "10:00", end: "16:00" }, { start: "18:00", end: "23:30" }] },
        { weekday: 6, hours: [{ start: "00:00", end: "02:00" }, { start: "12:00", end: "23:30" }] },
        { weekday: 7, hours: [{ start: "00:00", end: "01:00" }, { start: "09:00", end: "13:00" }] },
    ]},
    mode:"all"
  })

  useEffect(() => {
    let ignore = false;
    async function getWeekdays() {
      setLoadingDBWeekdays(true);
      if (!activeLocationId) {
        form.reset({
          weekdays: DAYS.map((_, index) => ({
            weekday: (index + 1) as 1|2|3|4|5|6|7,
            hours: [],
          })) as unknown as OpenHours["weekdays"],
        });
        setLoadingDBWeekdays(false);
        return;
      }

      let data: unknown[] | null = null;
      let error: { message: string } | null = null;
      if (type === "orders") {
        const result = await getOrderingOpenHours(activeLocationId);
        data = result.rows;
        error = result.success ? null : { message: result.message ?? "No se pudo cargar el horario." };
      } else {
        const result = await getReservationOpenHours(activeLocationId);
        data = result.rows;
        error = result.success ? null : { message: result.message ?? "No se pudo cargar el horario." };
      }
      if (ignore) return;
      if (error) {
        toast.error(error.message);
      }

      const rows = (data ?? []) as Array<{
        weekday: number;
        hours: Array<{ start?: number; end?: number }> | null;
      }>;
      const rowsByWeekday = new Map(rows.map((row) => [row.weekday, row]));
      const nextSchedule: OpenHours = {
        weekdays: DAYS.map((_, index) => {
          const weekday = (index + 1) as 1|2|3|4|5|6|7;
          const storedHours = rowsByWeekday.get(weekday)?.hours;
          const hours = Array.isArray(storedHours)
            ? storedHours
                .filter(
                  (hour): hour is { start: number; end: number } =>
                    typeof hour.start === "number" &&
                    Number.isFinite(hour.start) &&
                    typeof hour.end === "number" &&
                    Number.isFinite(hour.end)
                )
                .map((hour) => ({
                  start: minutesToTime(hour.start),
                  end: minutesToTime(hour.end),
                }))
            : [];
          return { weekday, hours };
        }) as unknown as OpenHours["weekdays"],
      };

      form.reset(nextSchedule, {
        keepErrors: false,
        keepDirty: false,
        keepTouched: false,
      });
      setLoadingDBWeekdays(false);
    }

    void getWeekdays();
    return () => {
      ignore = true;
    };
  }, [activeLocationId, form, type]);

  useEffect(() => {
    setLocationChangeBlocked(form.formState.isDirty);
    return () => setLocationChangeBlocked(false);
  }, [form.formState.isDirty, setLocationChangeBlocked]);

  async function onSubmit(values: z.infer<typeof OpenHoursSchema>) {
    if (!activeLocationId) {
      toast.error("Selecciona una ubicación activa.");
      return;
    }
    setLoading(true);
    const parsed = OpenHoursSchema.safeParse(values);
    if (parsed.success) {
      const insert =
        type === "reservation" ?
          await upsertOpenHoursReservation({ values:values, business_location_id: activeLocationId })
          :
          await upsertOpenHoursOrders({ values:values, business_location_id: activeLocationId })
      if (insert && !insert?.success) {
        toast.error(insert?.message)
        setLoading(false)
        return;
      }
      toast.success(insert.message);
      form.reset(parsed.data);
      setLoading(false)
      return;
    } else {
      toast.error(z.prettifyError(parsed.error))
      setLoading(false)
      return;
    }
  }

  if (loadingDBWeekdays) {
    return (
      <div className="flex flex-row items-center justify-center gap-2">
        <Loader2Icon className="animate-spin" />
        Cargando horarios
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit,(error)=> console.log(error))} className="space-y-4">
        <div className="grid xl:grid-cols-2 grid-cols-1 gap-2">
          <DayHoursFieldArray control={form.control} dayIndex={0}/>
          <DayHoursFieldArray control={form.control} dayIndex={1}/>
          <DayHoursFieldArray control={form.control} dayIndex={2}/>
          <DayHoursFieldArray control={form.control} dayIndex={3}/>
          <DayHoursFieldArray control={form.control} dayIndex={4}/>
          <DayHoursFieldArray control={form.control} dayIndex={5}/>
          <DayHoursFieldArray control={form.control} dayIndex={6}/>
        </div>
        <div className="flex items-center gap-2">
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
          <ApplyScheduleDialog type={type} canManageAllLocations={canManageAllLocations} />
        </div>
      </form>
    </Form>
  )
}
