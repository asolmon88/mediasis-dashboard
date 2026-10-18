import MainPage from "@/components/products-page/categories/edit/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";
import { ProductCategorySelectable } from "@/lib/types/dashboardTypes";

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
  image_url: string | null;
};

type CategoryProductRow = {
  sequence: number;
  product_id:
    | {
        product_id: string;
        name: string;
        visibility: boolean;
        images: unknown;
      }
    | {
        product_id: string;
        name: string;
        visibility: boolean;
        images: unknown;
      }[]
    | null;
};

function getFirstImage(images: unknown): string | null {
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    return typeof first === "string" ? first : null;
  }
  return null;
}

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ category_id: string }>;
}) {
  const { category_id } = await params;
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Categorías" description={authorized.message} />;
  }
  const supabase = authorized.admin;

  const { data: category, error: categoryError } = await supabase
    .schema("mediasis")
    .from("product_category")
    .select("product_category_id, name, visible, image_url")
    .eq("product_category_id", category_id)
    .eq("business", authorized.businessId)
    .single();

  if (categoryError || !category) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>No se pudo cargar la categoria, por favor recargue la pagina</p>
      </div>
    );
  }

  const { count: childCount } = await supabase.schema("mediasis")
    .from("product_category").select("product_category_id", { count: "exact", head: true })
    .eq("parent_category_id", category_id).eq("business", authorized.businessId);

  const { data: products, error: productsError } = await supabase
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

  const { data: categoryProducts, error: categoryProductsError } =
    await supabase
      .schema("mediasis")
      .from("product_category_product")
      .select("sequence, product_id(product_id, name, visibility, images)")
      .eq("product_category_id", category_id)
      .order("sequence", { ascending: true });

  if (categoryProductsError) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>Error al cargar los productos de la categoria</p>
      </div>
    );
  }

  const productOptions: ProductCategorySelectable = (products ?? []).map(
    (row: ProductRow) => ({
      product_id: row.product_id,
      name: row.name ?? "",
      visibility: row.visibility ?? false,
      first_image: getFirstImage(row.images),
    })
  );

  const selectedProducts = (categoryProducts ?? [])
    .map((row: CategoryProductRow) => {
      const relation = row.product_id;
      const product = Array.isArray(relation) ? relation[0] : relation;
      if (!product?.product_id) return null;
      return {
        product_id: product.product_id,
        name: product.name ?? "",
        visibility: product.visibility ?? false,
        first_image: getFirstImage(product.images),
        sequence: row.sequence ?? 0,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="px-6 py-6">
      <MainPage
        categoryId={category.product_category_id}
        products={productOptions}
        initialCategory={{
          name: category.name ?? "",
          visible: category.visible ?? true,
          image_url: category.image_url ?? null,
        }}
        initialSelectedProducts={selectedProducts}
        hasChildren={(childCount ?? 0) > 0}
      />
    </div>
  );
}
