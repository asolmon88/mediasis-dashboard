"use server";
import { ClosedSpecialDaySchema, type UIClosedSpecialDay } from "@/lib/FormSchemas/closedSpecialDaySchema";
import { requireScheduleManagementAccess, validateScheduleLocation } from "@/lib/dashboard/schedule-authorization";
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const rangeText = (range: { from: Date; to?: Date }) => `[${ymd(range.from)},${ymd(addDays(range.to ?? range.from,1))})`;

async function contextFor(locationId: string) {
  const authorized = await requireScheduleManagementAccess();
  if (!authorized.success) return authorized;
  const access = validateScheduleLocation(locationId, authorized);
  return access.success ? authorized : access;
}

export async function getOrderingSpecialHours(locationId: string) {
  const authorized = await contextFor(locationId);
  if (!authorized.success) return { ...authorized, rows: [] };
  const { data, error } = await authorized.admin.schema("mediasis").rpc("get_ordering_app_special_hours", {
    p_business_id: authorized.businessId, p_actor_app_user_id: authorized.actorAppUserId, p_location_id: locationId,
  });
  return error ? { success:false, message:"No se pudieron cargar los horarios especiales.", rows:[] }
    : { success:true, rows:(data ?? []) as Array<{ active_daterange:string; closed_all_day:boolean; note:string; hours:string|null }> };
}

export async function upsertClosedDays(values: UIClosedSpecialDay, businessLocationId: string) {
  const parsed = ClosedSpecialDaySchema.safeParse(values);
  if (!parsed.success) return { success:false, message:"Revisá el horario especial." };
  const authorized = await contextFor(businessLocationId);
  if (!authorized.success) return authorized;
  const hours = parsed.data.closed_all_day ? null : `[${parsed.data.hours?.start},${parsed.data.hours?.end})`;
  const { data,error } = await authorized.admin.schema("mediasis").rpc("save_ordering_app_special_hours", {
    p_business_id:authorized.businessId,p_actor_app_user_id:authorized.actorAppUserId,p_location_id:businessLocationId,
    p_active_daterange:rangeText(parsed.data.active_daterange),p_closed_all_day:parsed.data.closed_all_day,
    p_hours:hours,p_note:parsed.data.note,
  });
  const result=data as {success?:boolean;message?:string}|null;
  return error||!result?.success?{success:false,message:error?.message??result?.message??"No se pudo guardar."}:{success:true};
}

export async function deleteClosedDay(businessLocationId:string,activeRange:{from:Date;to?:Date}) {
  const authorized=await contextFor(businessLocationId);
  if(!authorized.success)return authorized;
  const {data,error}=await authorized.admin.schema("mediasis").rpc("delete_ordering_app_special_hours",{
    p_business_id:authorized.businessId,p_actor_app_user_id:authorized.actorAppUserId,p_location_id:businessLocationId,
    p_active_daterange:rangeText(activeRange),
  });
  const result=data as {success?:boolean;message?:string}|null;
  return error||!result?.success?{success:false,message:error?.message??result?.message??"No se pudo borrar."}:{success:true};
}
