import { BackButton } from "@/components/BackButton";
import EditProductForm from "@/components/products-page/EditProductForm";
import DeleteProductButton from "@/components/products-page/DeleteProductButton";
import { requireProductAccess, sanitizeProductLocationScope } from "@/lib/dashboard/product-authorization";
import { notFound } from "next/navigation";

type EditProductPageProps = {
  params: Promise<{
    product_id: string;
  }>;
};

export default async function EditProductPage({ params }: EditProductPageProps) {
  const { product_id } = await params;

  const authorized = await requireProductAccess(product_id);
  if (!authorized.success) notFound();

  const { data: productData, error: productDataError } = await authorized.admin.schema('mediasis').rpc('get_product_for_edit_authoritative', {
    p_product_id: product_id
  })

  if (productDataError) {
    return (
      <div className="px-4 mb-32">
        <p> Error al cargar el producto, por favor recargue la página. </p>
      </div>
    )
  }

  // Map RPC fields to form field names.
  // Options come from the normalized general group (future-proof);
  // fall back to product.options JSONB for products created before normalization.
  const normalizedProduct = productData
    ? {
        ...productData,
        options: productData.attached_general_groups?.[0]?.options ?? productData.options ?? [],
        attached_group_sequences: productData.attached_side_extra_groups ?? [],
      }
    : undefined;
  const safeProduct = normalizedProduct
    ? sanitizeProductLocationScope(
        normalizedProduct,
        authorized.allowedLocationIds,
        authorized.canManageAllLocations,
      )
    : undefined;

  return (
    <div className="px-4 mb-32">
      <div className="flex items-center justify-between gap-4">
        <BackButton label="Productos"/>
        <DeleteProductButton productId={product_id} product={productData} />
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-xl">
          <EditProductForm productId={product_id} product={safeProduct}/>
        </div>
      </div>
    </div>
  );
}
