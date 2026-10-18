"use server";

import type { DiscountListRows } from "@/lib/types/dashboardTypes";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";

type DiscountRow = {
  discount_id: string;
  title: string;
  type: string;
  active: boolean;
  applies_to: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
};

export async function getCurrentBusinessDiscounts() {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;

  const { data, error } = await authorized.admin
    .schema("mediasis")
    .from("discounts")
    .select("discount_id, title, type, active, applies_to, starts_at, ends_at, created_at")
    .eq("business_uid", authorized.businessId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return { success: false, message: error };
  }

  const rows: DiscountListRows = ((data ?? []) as DiscountRow[]).map((row) => ({
    discount_id: row.discount_id,
    title: row.title,
    type: row.type,
    active: row.active,
    applies_to: row.applies_to,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    created_at: row.created_at,
  }));

  return { success: true, data: rows };
}
