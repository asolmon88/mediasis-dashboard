import MainPage from "@/components/products-page/discounts/edit/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";
import type {
  DiscountSelectableCategory,
  DiscountSelectableProduct,
} from "@/lib/types/dashboardTypes";
import type { DiscountCodePayload } from "@/lib/FormSchemas/discountSchema";
import {
  getDiscountFormBlocksConfig,
  getDiscountTypeConfig,
} from "../discount-type-config";

type EditDiscountPageProps = {
  params: Promise<{
    discount_id: string;
  }>;
};

type DiscountRow = {
  discount_id: string;
  type: "code" | "free_delivery";
  active: boolean;
  title: string;
  starts_at: string;
  ends_at: string | null;
  applies_to: "orders" | "products" | "categories";
  min_requirement_type: "none" | "min_amount" | "min_items";
  min_amount: number | null;
  min_items: number | null;
  limit_total_uses: boolean;
  max_total_uses: number | null;
  limit_per_customer: boolean;
  max_uses_per_customer: number | null;
  limit_total_discount_amount: boolean;
  max_total_discount_amount: number | null;
  location_scope: "all" | "specific";
};

type DiscountCodeRow = {
  code: string;
  value_type: "percent" | "fixed_amount" | "free_delivery";
  percent_value: number | null;
  fixed_amount: number | null;
};

type ProductRow = {
  product_id: string;
  name: string;
  visibility: boolean;
  images: unknown;
};

type CategoryRow = {
  product_category_id: string;
  name: string;
  visible: boolean;
};

type DiscountTargetProductRow = {
  product_id: string;
};

type DiscountTargetCategoryRow = {
  category_id: string;
};

type DiscountBusinessLocationRow = {
  business_location_id: string;
};

type SelectValue = {
  value: string;
  label: string;
};

function formatDateToUtcText(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function getFirstImage(images: unknown): string | null {
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    return typeof first === "string" ? first : null;
  }
  return null;
}

function toMultiSelectValues(ids: string[], labelMap: Map<string, string>): SelectValue[] {
  return ids.map((id) => ({
    value: id,
    label: labelMap.get(id) ?? id,
  }));
}

export default async function EditDiscountPage({ params }: EditDiscountPageProps) {
  const { discount_id } = await params;
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Descuentos" description={authorized.message} />;
  }
  const supabase = authorized.admin;

  const { data: appAvailableData, error: appAvailableError } = await supabase
    .schema("mediasis")
    .from("businesses")
    .select("app_active")
    .eq("uid", authorized.businessId)
    .maybeSingle();

  if (appAvailableError || (authorized.context.mode !== "staff" && !appAvailableData?.app_active)) {
    return <DashboardAccessDenied
      title="Descuentos no disponibles"
      description={appAvailableError
        ? "No se pudo validar el estado de la app de pedidos."
        : "La app de pedidos no está activa para este negocio."}
    />;
  }

  const [{ data: discountData, error: discountError }, { data: discountCodeData, error: codeError }] =
    await Promise.all([
      supabase
        .schema("mediasis")
        .from("discounts")
        .select(
          "discount_id, type, active, title, starts_at, ends_at, applies_to, min_requirement_type, min_amount, min_items, limit_total_uses, max_total_uses, limit_per_customer, max_uses_per_customer, limit_total_discount_amount, max_total_discount_amount, location_scope",
        )
        .eq("discount_id", discount_id)
        .eq("business_uid", authorized.businessId)
        .maybeSingle(),
      supabase
        .schema("mediasis")
        .from("discount_code")
        .select("code, value_type, percent_value, fixed_amount")
        .eq("discount_id", discount_id)
        .eq("business_uid", authorized.businessId)
        .maybeSingle(),
    ]);

  if (discountError || !discountData || codeError || !discountCodeData) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>No se pudo cargar el descuento, por favor recargue la pagina</p>
      </div>
    );
  }

  const discount = discountData as DiscountRow;
  const discountCode = discountCodeData as DiscountCodeRow;

  const discountTypeConfig = getDiscountTypeConfig(discount.type);
  if (!discountTypeConfig || !discountTypeConfig.available) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>Tipo de descuento invalido.</p>
      </div>
    );
  }

  const formBlocks = getDiscountFormBlocksConfig(discount.type);

  const [
    { data: productsData, error: productsError },
    { data: categoriesData, error: categoriesError },
    { data: targetProductsData, error: targetProductsError },
    { data: targetCategoriesData, error: targetCategoriesError },
    { data: businessLocationsData, error: businessLocationsError },
  ] = await Promise.all([
    supabase
      .schema("mediasis")
      .from("product")
      .select("product_id, name, visibility, images")
      .eq("business", authorized.businessId)
      .order("name"),
    supabase
      .schema("mediasis")
      .from("product_category")
      .select("product_category_id, name, visible")
      .eq("business", authorized.businessId)
      .order("name"),
    supabase
      .schema("mediasis")
      .from("discount_targets_products")
      .select("product_id")
      .eq("discount_id", discount_id),
    supabase
      .schema("mediasis")
      .from("discount_targets_categories")
      .select("category_id")
      .eq("discount_id", discount_id),
    supabase
      .schema("mediasis")
      .from("discount_business_locations")
      .select("business_location_id")
      .eq("discount_id", discount_id),
  ]);

  if (
    productsError ||
    categoriesError ||
    targetProductsError ||
    targetCategoriesError ||
    businessLocationsError
  ) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>No se pudo cargar el descuento, por favor recargue la pagina</p>
      </div>
    );
  }

  const products: DiscountSelectableProduct[] = (productsData ?? []).map(
    (row: ProductRow) => ({
      product_id: row.product_id,
      name: row.name ?? "",
      visibility: row.visibility ?? false,
      first_image: getFirstImage(row.images),
    }),
  );

  const categories: DiscountSelectableCategory[] = (categoriesData ?? []).map(
    (row: CategoryRow) => ({
      product_category_id: row.product_category_id,
      name: row.name ?? "",
      visible: row.visible ?? false,
    }),
  );

  const productLabelMap = new Map<string, string>(
    products.map((item) => [item.product_id, item.name]),
  );
  const categoryLabelMap = new Map<string, string>(
    categories.map((item) => [item.product_category_id, item.name]),
  );

  const selectedProductIds = (targetProductsData ?? []).map(
    (row: DiscountTargetProductRow) => row.product_id,
  );
  const selectedCategoryIds = (targetCategoriesData ?? []).map(
    (row: DiscountTargetCategoryRow) => row.category_id,
  );
  const selectedLocationIds = (businessLocationsData ?? [])
    .map((row: DiscountBusinessLocationRow) => row.business_location_id)
    .filter(
      (locationId) =>
        authorized.canManageAllLocations || authorized.allowedLocationIds.has(locationId),
    );

  const startsAtText = formatDateToUtcText(discount.starts_at);
  if (!startsAtText) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>No se pudo cargar el descuento, por favor recargue la pagina</p>
      </div>
    );
  }

  const endsAtText = formatDateToUtcText(discount.ends_at);
  const valueAmount =
    discountCode.value_type === "percent"
      ? discountCode.percent_value ?? 0
      : discountCode.fixed_amount ?? 0;

  const initialValues: DiscountCodePayload = {
    type: discount.type,
    active: discount.active ?? true,
    title: discount.title ?? "",
    code: discountCode.code ?? "",
    value_type: discountCode.value_type,
    value_amount: valueAmount,
    applies_to: discount.applies_to,
    selected_products: toMultiSelectValues(selectedProductIds, productLabelMap),
    selected_categories: toMultiSelectValues(selectedCategoryIds, categoryLabelMap),
    min_requirement_type: discount.min_requirement_type,
    min_amount: discount.min_amount,
    min_items: discount.min_items,
    limit_total_uses: discount.limit_total_uses ?? false,
    max_total_uses: discount.max_total_uses,
    limit_per_customer: discount.limit_per_customer ?? false,
    max_uses_per_customer: discount.max_uses_per_customer,
    limit_total_discount_amount: discount.limit_total_discount_amount ?? false,
    max_total_discount_amount: discount.max_total_discount_amount,
    starts_at: startsAtText,
    ends_at: endsAtText,
    location_scope: discount.location_scope,
    business_location_ids:
      discount.location_scope === "specific" ? selectedLocationIds : [],
  };

  return (
    <div className="px-6 py-6 mb-16">
      <MainPage
        discountId={discount.discount_id}
        discountType={discountTypeConfig.type}
        discountTypeTitle={discountTypeConfig.title}
        formBlocks={formBlocks}
        products={products}
        categories={categories}
        initialValues={initialValues}
      />
    </div>
  );
}
