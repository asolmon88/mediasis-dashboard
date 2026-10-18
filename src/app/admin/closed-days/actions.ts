'use server'

import { ClosedSpecialDaySchema } from "@/lib/FormSchemas/closedSpecialDaySchema";
import { requireReservationsManagementAccess } from "@/lib/dashboard/reservation-authorization";
import { z } from "zod";

export type ReservationClosedDayRow = {
  active_daterange: string;
  closed_all_day: boolean;
  note: string;
  hours: string | null;
};
type RpcResult = { success?: boolean; message?: string; data?: ReservationClosedDayRow[] };
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate()+days); return next; };
const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const range = (from: Date, to?: Date) => `[${ymd(from)},${ymd(addDays(to ?? from,1))})`;

async function call(name: string,args: Record<string,unknown>) {
  const access=await requireReservationsManagementAccess();
  if(!access.success) return access;
  const {data,error}=await access.admin.schema("mediasis").rpc(name,{p_business_id:access.businessId,p_actor_app_user_id:access.actorAppUserId,...args});
  const result=data as RpcResult|null;
  if(error||!result?.success) return {success:false as const,message:error?.message??result?.message??"La operación no pudo completarse."};
  return {success:true as const,result};
}

export async function getReservationClosedDays(locationId:string){
  const response=await call("get_dashboard_reservation_special_hours",{p_location_id:locationId});
  return response.success?{success:true as const,rows:response.result.data??[]}:{...response,rows:[]};
}

export async function upsertClosedDays(values:z.infer<typeof ClosedSpecialDaySchema>,business_location_id:string){
  const parsed=ClosedSpecialDaySchema.safeParse(values);
  if(!parsed.success) return {success:false,message:"Revisá el horario especial."};
  const hours=parsed.data.closed_all_day?null:`[${parsed.data.hours?.start},${parsed.data.hours?.end})`;
  const response=await call("save_dashboard_reservation_special_hours",{
    p_location_id:business_location_id,p_active_daterange:range(parsed.data.active_daterange.from,parsed.data.active_daterange.to),
    p_closed_all_day:parsed.data.closed_all_day,p_hours:hours,p_note:parsed.data.note.trim(),
  });
  return response.success?{success:true}:response;
}

export async function deleteClosedDay(
  business_location_id:string,
  active:{from:Date;to?:Date},
): Promise<{success: boolean; message?: string}> {
  const response=await call("delete_dashboard_reservation_special_hours",{
    p_location_id:business_location_id,p_active_daterange:range(active.from,active.to),
  });
  return response.success?{success:true}:response;
}
