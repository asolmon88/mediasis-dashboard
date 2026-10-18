import { BackButton } from "@/components/BackButton";
import { OptionGroupForm } from "@/components/option-groups-page/OptionGroupForm";
import { getBusinessLocations, createOptionGroup } from "../actions";
import { OptionGroupInput } from "@/lib/FormSchemas/optionGroupSchema";

export default async function NewOptionGroupPage() {
  const locResult = await getBusinessLocations();
  const locations = locResult.success ? (locResult.data ?? []) : [];

  async function handleCreate(values: OptionGroupInput) {
    "use server";
    return createOptionGroup(values);
  }

  return (
    <div className="px-4 mb-32">
      <BackButton label="Acompañamientos / Extras" />

      <div className="flex justify-center">
        <div className="w-full max-w-xl space-y-4">
          <h1 className="text-xl font-semibold">Nuevo grupo</h1>
          <OptionGroupForm
            locations={locations}
            onSubmit={handleCreate}
            submitLabel="Crear grupo"
            backUrl="/admin/products/product-option-groups"
          />
        </div>
      </div>
    </div>
  );
}
