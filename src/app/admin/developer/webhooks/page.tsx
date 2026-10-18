import MainPage from "@/components/developer/webhooks/MainPage";
import { getBusinessWebhooksData } from "./actions";

export default async function WebhooksPage() {
  const result = await getBusinessWebhooksData();
  if (!result.success) {
    return (
      <div className="flex justify-center items-center w-full">
        <p>Error al cargar los webhooks. Por favor recargue la página.</p>
      </div>
    );
  }

  return (
    <MainPage
      webhooks={result.webhooks}
      businessLocations={result.locations}
      canManageAllLocations={result.canManageAllLocations}
    />
  );
}
