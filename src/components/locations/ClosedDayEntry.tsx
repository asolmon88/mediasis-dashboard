import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "../ui/button";
import { Edit2, X } from "lucide-react";
import { minutesToTime } from "@/lib/utils";
import { ClosedSpecialForm } from "./ClosedSpecialForm";
import { deleteClosedDay as deleteClosedDayReservation} from "@/app/admin/closed-days/actions";
import { deleteClosedDay as deleteClosedDayOrders} from "@/app/admin/app/closed-special-hours/actions";
import { toast } from "sonner";
import { useActiveLocationId } from "@/stores/location-store";
import { useReservationLocation } from "@/hooks/use-reservation-location";

export default function ClosedDayEntry({
  active_daterange,
  closed_all_day,
  hours,
  note,
  type = 'reservation',
  onChanged,
}:{
  active_daterange: {
    from: Date;
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
  async function callDelete() {
    if (!activeLocationId) {
      toast.error("Selecciona una ubicación activa.")
      return
    }
    const deleteResult = type === 'reservation' ? 
      await deleteClosedDayReservation(activeLocationId, active_daterange) :
      await deleteClosedDayOrders(activeLocationId, active_daterange)
    if (deleteResult.success) {
      toast.success('Borrado con éxito')
      onChanged?.()
    } else {
      toast.error(`ERROR: ${deleteResult.message}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{active_daterange?.from?.toLocaleString().split(',')[0]}{active_daterange?.to ? `-${active_daterange?.to.toLocaleString().split(',')[0]}` : ''}</CardTitle>
        <CardDescription>{`${closed_all_day ? 'Cerrado todo el día' : `Horario especial ${minutesToTime(hours?.start)} - ${minutesToTime(hours?.end)}`} - ${note}`}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <ClosedSpecialForm active_daterange={active_daterange} closed_all_day={closed_all_day} hours={hours} note={note} edit type={type} onChanged={onChanged}/>
        <Button type="button" variant="destructive" size="sm" onClick={callDelete} className="rounded-full">
          <X />
        </Button>
      </CardContent>
    </Card>
  );
}
