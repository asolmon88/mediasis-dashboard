import { OpenHours } from '@/lib/FormSchemas/openHoursSchema'
import { createClient } from '@/lib/supabase/client'
import { minutesToTime } from '@/lib/utils'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useActiveLocationId } from '@/stores/location-store'

export const useCurrentOpenHours = () => {
  const [openHours, setOpenHours] = useState<OpenHours | undefined>(undefined);
  const activeLocationId = useActiveLocationId();
  useEffect(() => {
    let ignore = false;
    const fetchOpenHours = async () => {
      if (!activeLocationId) {
        setOpenHours(undefined);
        return;
      }
      const supabase = await createClient();

      const { data, error } = await supabase.schema('mediasis').from('business_location_open_hours').select('weekday, hours').eq('business_location_id', activeLocationId).order('weekday');
      if (!ignore && data) setOpenHours({
        weekdays: data.map((d: { weekday: number; hours: { start: number; end: number }[] }) => ({ weekday: d.weekday as 1|2|3|4|5|6|7, hours: d.hours.map((h:{start:number,end:number}) => ({ start: minutesToTime(h.start), end: minutesToTime(h.end), })), })) as unknown as OpenHours["weekdays"],
      })
      if (error) {
        toast('Error al cargar el horario, por favor recargue la página.')
      }
    }
    void fetchOpenHours()
    return () => {
      ignore = true;
    }
  }, [activeLocationId])
  return openHours || {} as OpenHours
}
