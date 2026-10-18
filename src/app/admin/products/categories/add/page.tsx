import MainPage from "@/components/products-page/categories/add/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";
import { ProductCategorySelectable } from "@/lib/types/dashboardTypes";

type ProductRow = {
  product_id: string;
  name: string;
  visibility: boolean;
  images: unknown;
};

function getFirstImage(images: unknown): string | null {
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    return typeof first === "string" ? first : null;
  }
  return null;
}

export default async function AddCategoryPage() {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Categorías" description={authorized.message} />;
  }

  const { data, error } = await authorized.admin
    .schema("mediasis")
    .from("product")
    .select("product_id, name, visibility, images")
    .eq("business", authorized.businessId)
    .order("name");

  if (error) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>Error al cargar los productos, por favor recargue la pagina</p>
      </div>
    );
  }

  const products: ProductCategorySelectable = (data ?? []).map((row: ProductRow) => ({
    product_id: row.product_id,
    name: row.name ?? "",
    visibility: row.visibility ?? false,
    first_image: getFirstImage(row.images),
  }));

  return (
    <div className="px-6 py-6">
      <MainPage products={products} />
    </div>
  );
}
