import CustomScriptsForm from "@/components/developer/custom-scripts/CustomScriptsForm";
import { getCustomTrackingCode } from "./actions";

export default async function CustomScriptsPage() {
  const result = await getCustomTrackingCode();
  if (!result.success) {
    return (
      <div className="flex w-full items-center justify-center">
        <p>Error al cargar los scripts personalizados. Por favor recargue la página.</p>
      </div>
    );
  }

  return <CustomScriptsForm initialCode={result.code} />;
}
