"use client";

import DeliveryForm from "./DeliveryForm";
import { DeliveryInput } from "@/lib/FormSchemas/deliverySchema";
import { BackButton } from "@/components/BackButton";

type DeliveryMethodMainPageProps = {
  deliveryMethodId: string;
  defaults: Pick<
    DeliveryInput,
    "visibility" | "require_location" | "require_courier" | "delivery_method_id" | "name" | "pickup_ready_offset_minutes"
  >;
  recordId?: string;
  paymentMethods: { id: string; name: string }[];
  canManageAllLocations?: boolean;
  canUseMediasisCourier?: boolean;
};

export default function DeliveryMethodMainPage({
  deliveryMethodId,
  defaults,
  recordId,
  paymentMethods,
  canManageAllLocations = true,
  canUseMediasisCourier = true,
}: DeliveryMethodMainPageProps) {
  return (
    <div className="px-4 py-4 space-y-4">
      <BackButton label="Métodos de delivery" />
      <div className="mb-4 space-y-1">
        <h1 className="text-lg font-semibold">Editar método de delivery</h1>
        {defaults?.name ? (
          <p className="text-sm text-muted-foreground">{defaults.name}</p>
        ) : null}
      </div>
      <div className="flex justify-center">
        <DeliveryForm
          deliveryMethodId={deliveryMethodId}
          recordId={recordId}
          defaultValues={defaults}
          paymentMethods={paymentMethods}
          canManageAllLocations={canManageAllLocations}
          canUseMediasisCourier={canUseMediasisCourier}
        />
      </div>
    </div>
  );
}
