import MainPage from "@/components/products-page/discounts/add/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";

import {
  getDiscountFormBlocksConfig,
  getDiscountTypeConfig,
} from "../../discount-type-config";

type AddDiscountPageProps = {
  params: Promise<{
    discount_type: string;
  }>;
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

function getFirstImage(images: unknown): string | null {
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    return typeof first === "string" ? first : null;
  }
  return null;
}

export default async function AddDiscountPage({ params }: AddDiscountPageProps) {
  const { discount_type } = await params;

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

  if (authorized.context.mode !== "staff" && !appAvailableData?.app_active) {
    return <DashboardAccessDenied
      title="Descuentos no disponibles"
      description="La app de pedidos no está activa para este negocio."
    />;
  }

  const discountTypeConfig = getDiscountTypeConfig(discount_type);
  if (!discountTypeConfig) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>Tipo de descuento invalido.</p>
      </div>
    );
  }

  if (!discountTypeConfig.available) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>Este tipo de descuento todavia no esta disponible.</p>
      </div>
    );
  }

  const formBlocks = getDiscountFormBlocksConfig(discount_type);
  const { data: productsData, error: productsError } = await supabase
    .schema("mediasis")
    .from("product")
    .select("product_id, name, visibility, images")
    .eq("business", authorized.businessId)
    .order("name");

  if (productsError) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>Error al cargar los productos, por favor recargue la pagina</p>
      </div>
    );
  }

  const { data: categoriesData, error: categoriesError } = await supabase
    .schema("mediasis")
    .from("product_category")
    .select("product_category_id, name, visible")
    .eq("business", authorized.businessId)
    .order("name");

  if (categoriesError) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>Error al cargar las categorías, por favor recargue la pagina</p>
      </div>
    );
  }

  const products = (productsData ?? []).map((row: ProductRow) => ({
    product_id: row.product_id,
    name: row.name ?? "",
    visibility: row.visibility ?? false,
    first_image: getFirstImage(row.images),
  }));

  const categories = (categoriesData ?? []).map((row: CategoryRow) => ({
    product_category_id: row.product_category_id,
    name: row.name ?? "",
    visible: row.visible ?? false,
  }));

  return (
    <div className="px-6 py-6 mb-16">
      <MainPage
        discountType={discountTypeConfig.type}
        discountTypeTitle={discountTypeConfig.title}
        formBlocks={formBlocks}
        products={products}
        categories={categories}
      />
    </div>
  );
}
