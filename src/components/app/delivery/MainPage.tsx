"use client";

import { AddExpressButton } from "./AddExpressButton";
import { DeliveryTable } from "./DeliveryTable";
import { delivery_methods_for_table } from "@/lib/types/dashboardTypes";
import type { SelectOption } from "@/lib/types/dashboardTypes";

type ExpressMainPageProps = {
  delivery_methods: delivery_methods_for_table;
  predefinedMethods: SelectOption[];
};

export default function MainPage({ delivery_methods, predefinedMethods }: ExpressMainPageProps) {
  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Métodos de delivery</h1>
          <p className="text-sm text-muted-foreground">
            Administra y configura las opciones de entrega para tus pedidos.
          </p>
        </div>
        <AddExpressButton options={predefinedMethods} />
      </div>

      <DeliveryTable delivery_methods={delivery_methods} />
    </div>
  );
}
