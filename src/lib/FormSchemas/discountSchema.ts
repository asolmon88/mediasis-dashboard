import { z } from "zod";

const emptyToNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
};

const nullablePositiveNumber = (message: string) =>
  z.preprocess((value) => {
    const next = emptyToNull(value);
    if (next === null) return null;
    if (typeof next === "string") {
      const parsed = Number(next);
      return Number.isFinite(parsed) ? parsed : next;
    }
    return next;
  }, z.number().positive(message).nullable());

const nullablePositiveInt = (message: string) =>
  z.preprocess((value) => {
    const next = emptyToNull(value);
    if (next === null) return null;
    if (typeof next === "string") {
      const parsed = Number(next);
      return Number.isFinite(parsed) ? parsed : next;
    }
    return next;
  }, z.number().int("Debe ser entero").positive(message).nullable());

const nullableDateString = z.preprocess((value) => {
  const next = emptyToNull(value);
  if (next === null) return null;
  if (value instanceof Date) return value.toISOString();
  return typeof next === "string" ? next.trim() : next;
}, z.string().min(1, "Fecha requerida").nullable());

const requiredDateString = z.preprocess((value) => {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value.trim() : value;
}, z.string().min(1, "Fecha de inicio requerida"));

export const DiscountTypeSchema = z.enum(["code", "free_delivery"]);
export const DiscountAppliesToSchema = z.enum(["orders", "products", "categories"]);
export const DiscountMinimumRequirementTypeSchema = z.enum(["none", "min_amount", "min_items"]);
export const DiscountCodeValueTypeSchema = z.enum(["percent", "fixed_amount", "free_delivery"]);

export const DiscountTargetProductSchema = z.object({
  product_id: z.string().trim().min(1, "Producto requerido"),
});

export const DiscountTargetCategorySchema = z.object({
  category_id: z.string().trim().min(1, "Categoria requerida"),
});

export const DiscountSchema = z
  .object({
    type: DiscountTypeSchema.default("code"),
    active: z.boolean(),
    title: z.string().trim().min(1, "Titulo requerido").max(100, "Titulo muy largo"),

    starts_at: requiredDateString,
    ends_at: nullableDateString,

    applies_to: DiscountAppliesToSchema,

    min_requirement_type: DiscountMinimumRequirementTypeSchema,
    min_amount: nullablePositiveNumber("Monto minimo debe ser mayor a 0"),
    min_items: nullablePositiveInt("Cantidad minima debe ser mayor a 0"),

    limit_total_uses: z.boolean(),
    max_total_uses: nullablePositiveInt("Maximo de usos debe ser mayor a 0"),

    limit_per_customer: z.boolean(),
    max_uses_per_customer: nullablePositiveInt("Maximo por cliente debe ser mayor a 0"),

    limit_total_discount_amount: z.boolean(),
    max_total_discount_amount: nullablePositiveNumber("Maximo de descuento debe ser mayor a 0"),

    code: z
      .string()
      .trim()
      .min(1, "Codigo requerido")
      .max(64, "Codigo muy largo")
      .transform((value) => value.toUpperCase()),

    value_type: DiscountCodeValueTypeSchema,
    percent_value: nullablePositiveNumber("Porcentaje debe ser mayor a 0"),
    fixed_amount: nullablePositiveNumber("Monto fijo debe ser mayor a 0"),

    products: z.array(DiscountTargetProductSchema).default([]),
    categories: z.array(DiscountTargetCategorySchema).default([]),
  })
  .superRefine((data, ctx) => {
    const startsAt = new Date(data.starts_at).getTime();
    if (Number.isNaN(startsAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["starts_at"],
        message: "Fecha de inicio invalida",
      });
    }

    if (data.ends_at !== null) {
      const endsAt = new Date(data.ends_at).getTime();
      if (Number.isNaN(endsAt)) {
        ctx.addIssue({
          code: "custom",
          path: ["ends_at"],
          message: "Fecha de finalizacion invalida",
        });
      } else if (!Number.isNaN(startsAt) && endsAt <= startsAt) {
        ctx.addIssue({
          code: "custom",
          path: ["ends_at"],
          message: "La fecha final debe ser mayor que la fecha inicial",
        });
      }
    }

    if (data.min_requirement_type === "min_amount") {
      if (data.min_amount === null) {
        ctx.addIssue({
          code: "custom",
          path: ["min_amount"],
          message: "Monto minimo requerido",
        });
      }
      if (data.min_items !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["min_items"],
          message: "No aplica cuando el minimo es por monto",
        });
      }
    }

    if (data.min_requirement_type === "min_items") {
      if (data.min_items === null) {
        ctx.addIssue({
          code: "custom",
          path: ["min_items"],
          message: "Cantidad minima requerida",
        });
      }
      if (data.min_amount !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["min_amount"],
          message: "No aplica cuando el minimo es por cantidad",
        });
      }
    }

    if (data.min_requirement_type === "none") {
      if (data.min_amount !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["min_amount"],
          message: "Debe estar vacio cuando no hay minimo",
        });
      }
      if (data.min_items !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["min_items"],
          message: "Debe estar vacio cuando no hay minimo",
        });
      }
    }

    if (data.limit_total_uses && data.max_total_uses === null) {
      ctx.addIssue({
        code: "custom",
        path: ["max_total_uses"],
        message: "Maximo de usos total requerido",
      });
    }

    if (!data.limit_total_uses && data.max_total_uses !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["max_total_uses"],
        message: "Debe estar vacio cuando no se limita el total de usos",
      });
    }

    if (data.limit_per_customer && data.max_uses_per_customer === null) {
      ctx.addIssue({
        code: "custom",
        path: ["max_uses_per_customer"],
        message: "Maximo por cliente requerido",
      });
    }

    if (!data.limit_per_customer && data.max_uses_per_customer !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["max_uses_per_customer"],
        message: "Debe estar vacio cuando no se limita por cliente",
      });
    }

    if (data.limit_total_discount_amount && data.max_total_discount_amount === null) {
      ctx.addIssue({
        code: "custom",
        path: ["max_total_discount_amount"],
        message: "Maximo total de descuento requerido",
      });
    }

    if (!data.limit_total_discount_amount && data.max_total_discount_amount !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["max_total_discount_amount"],
        message: "Debe estar vacio cuando no se limita el descuento total",
      });
    }

    if (data.value_type === "percent") {
      if (data.percent_value === null) {
        ctx.addIssue({
          code: "custom",
          path: ["percent_value"],
          message: "Porcentaje requerido",
        });
      } else if (data.percent_value > 100) {
        ctx.addIssue({
          code: "custom",
          path: ["percent_value"],
          message: "El porcentaje debe ser menor o igual a 100",
        });
      }

      if (data.fixed_amount !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["fixed_amount"],
          message: "No aplica para descuentos porcentuales",
        });
      }
    }

    if (data.value_type === "fixed_amount") {
      if (data.fixed_amount === null) {
        ctx.addIssue({
          code: "custom",
          path: ["fixed_amount"],
          message: "Monto fijo requerido",
        });
      }

      if (data.percent_value !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["percent_value"],
          message: "No aplica para descuentos de monto fijo",
        });
      }
    }

    if (data.value_type === "free_delivery") {
      if (data.type !== "free_delivery") {
        ctx.addIssue({
          code: "custom",
          path: ["value_type"],
          message: "Envio gratis solo aplica para descuentos de envio gratis",
        });
      }

      if (data.percent_value !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["percent_value"],
          message: "No aplica para descuentos de envio gratis",
        });
      }

      if (data.fixed_amount !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["fixed_amount"],
          message: "No aplica para descuentos de envio gratis",
        });
      }
    }

    if (data.type === "free_delivery") {
      if (data.value_type !== "free_delivery") {
        ctx.addIssue({
          code: "custom",
          path: ["value_type"],
          message: "Envio gratis requiere valor de envio gratis",
        });
      }

      if (data.limit_total_discount_amount || data.max_total_discount_amount !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["limit_total_discount_amount"],
          message: "Envio gratis no permite limite de monto total",
        });
      }
    }

    if (data.applies_to === "products") {
      if (data.products.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["products"],
          message: "Debe seleccionar al menos un producto",
        });
      }

      if (data.categories.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["categories"],
          message: "No aplica cuando el descuento es para productos",
        });
      }
    }

    if (data.applies_to === "categories") {
      if (data.categories.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["categories"],
          message: "Debe seleccionar al menos una categoria",
        });
      }

      if (data.products.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["products"],
          message: "No aplica cuando el descuento es para categorias",
        });
      }
    }

    if (data.applies_to === "orders") {
      if (data.products.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["products"],
          message: "No debe incluir productos para descuentos de orden",
        });
      }

      if (data.categories.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["categories"],
          message: "No debe incluir categorias para descuentos de orden",
        });
      }
    }
  });

export type DiscountSchemaInput = z.infer<typeof DiscountSchema>;

export type DiscountCodePayload = Pick<
  DiscountSchemaInput,
  | "type"
  | "active"
  | "title"
  | "code"
  | "value_type"
  | "applies_to"
  | "min_requirement_type"
  | "min_amount"
  | "min_items"
  | "limit_total_uses"
  | "max_total_uses"
  | "limit_per_customer"
  | "max_uses_per_customer"
  | "limit_total_discount_amount"
  | "max_total_discount_amount"
  | "starts_at"
  | "ends_at"
> & {
  value_amount: number;
  selected_products: { value: string; label: string }[];
  selected_categories: { value: string; label: string }[];
  location_scope: "all" | "specific";
  business_location_ids: string[];
};

export type DiscountInput = z.infer<typeof DiscountSchema>;
export type DiscountTargetProductInput = z.infer<typeof DiscountTargetProductSchema>;
export type DiscountTargetCategoryInput = z.infer<typeof DiscountTargetCategorySchema>;
