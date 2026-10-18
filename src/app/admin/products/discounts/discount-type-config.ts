import "server-only";
import type { DiscountFormBlocksConfig, DiscountTypeOption } from "@/lib/types/dashboardTypes";

const DISCOUNT_TYPE_CONFIG: DiscountTypeOption[] = [
  {
    type: "code",
    title: "Código de descuento",
    description: "Crea un código de descuento y compártelo con clientes",
    icon: "key-round",
    available: true,
  },
  {
    type: "order_value",
    title: "Descuento por valor de orden",
    description: "Aplica un descuento cuando el total de la orden supera un monto específico",
    icon: "shopping-cart",
    available: false,
  },
  {
    type: "automatic",
    title: "Descuento automático",
    description: "Aplica un descuento a todos los productos",
    icon: "tag",
    available: false,
  },
  {
    type: "bundle",
    title: "Descuento por combo",
    description: "Ofrece un descuento por comprar múltiples productos",
    icon: "package-plus",
    available: false,
  },
  {
    type: "buy_x_get_y",
    title: "Compra X y lleva Y",
    description: "Ofrece artículos gratis cuando el cliente compra artículos específicos",
    icon: "hand",
    available: false,
  },
  {
    type: "free_delivery",
    title: "Envío gratis",
    description: "Configura condiciones para envío y delivery gratis",
    icon: "truck",
    available: true,
  },
];

export function getDiscountTypeConfigList() {
  return DISCOUNT_TYPE_CONFIG;
}

export function getDiscountTypeConfig(type: string) {
  return DISCOUNT_TYPE_CONFIG.find((item) => item.type === type) ?? null;
}

export function getDiscountFormBlocksConfig(type: string): DiscountFormBlocksConfig {
  if (type === "code") {
    return {
      showGeneralBlock: true,
      showValueBlock: true,
      showMinimumRequirementsBlock: true,
      showMaximumUsesBlock: true,
      showActiveDatesBlock: true,
      showTargetsBlock: true,
    };
  }

  if (type === "free_delivery") {
    return {
      showGeneralBlock: true,
      showValueBlock: true,
      showMinimumRequirementsBlock: true,
      showMaximumUsesBlock: true,
      showActiveDatesBlock: true,
      showTargetsBlock: true,
    };
  }

  return {
    showGeneralBlock: false,
    showValueBlock: false,
    showMinimumRequirementsBlock: false,
    showMaximumUsesBlock: false,
    showActiveDatesBlock: false,
    showTargetsBlock: false,
  };
}
