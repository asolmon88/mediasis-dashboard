import { z } from "zod";

const price = z.number().min(0, "El precio no puede ser negativo")

// each choice for checkbox / selection
const ChoiceSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(300),
  price,
  sequence: z.number().int().optional(),
  scope: z.enum(["all", "specific"]).optional(),
  location_ids: z.array(z.string().uuid()).optional(),
});

const OptionalPositiveInt = z.number().int().positive("Debe ser mayor que 0").optional();

// validation type for checkbox only
const ValidationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("not_applicable"),
  }),
  z.object({
    type: z.literal("select_at_least"),
    min: OptionalPositiveInt,
  }),
  z.object({
    type: z.literal("select_at_most"),
    max: OptionalPositiveInt,
  }),
  z.object({
    type: z.literal("select_between"),
    min: OptionalPositiveInt,
    max: OptionalPositiveInt,
  }),
]);

// the main Option schema
export const ProductOptionSchema = z
  .object({
    name: z.string().trim().min(1, "Nombre requerido").max(150, "Nombre demasiado largo, máximo 150 caracteres"),
    sequence: z
      .number()
      .int("Debe ser entero"),
    type: z.enum(["text", "number", "date", "checkbox", "selection", "media"]),
    required: z.boolean(),

    enable_quantity: z.boolean().optional(),

    // optional depending on type
    choices: z.array(ChoiceSchema).optional(),
    validation: ValidationSchema.optional(),
  })
  // conditional rules
  .superRefine((data, ctx) => {
    // For checkbox or selection, choices are required
    if (
      (data.type === "checkbox" || data.type === "selection") &&
      (!data.choices || data.choices.length === 0)
    ) {
      ctx.addIssue({
        path: ["choices"],
        code: 'custom',
        message: "Debe incluir al menos una opción",
      });
    }

    // For checkbox only, validation is required
    if (data.type === "checkbox" && !data.validation) {
      ctx.addIssue({
        path: ["validation"],
        code: 'custom',
        message: "Debe especificar una validación para el checkbox",
      });
    }

    if (data.validation?.type === "select_at_least" && data.validation.min == null) {
      ctx.addIssue({
        path: ["validation", "min"],
        code: "custom",
        message: "Debe indicar el mínimo",
      });
    }

    if (data.validation?.type === "select_at_most" && data.validation.max == null) {
      ctx.addIssue({
        path: ["validation", "max"],
        code: "custom",
        message: "Debe indicar el máximo",
      });
    }

    if (data.validation?.type === "select_between") {
      if (data.validation.min == null || data.validation.max == null) {
        ctx.addIssue({
          path: ["validation"],
          code: "custom",
          message: "Debe indicar mínimo y máximo",
        });
      } else if (data.validation.min > data.validation.max) {
        ctx.addIssue({
          path: ["validation"],
          code: "custom",
          message: "El valor mínimo debe ser menor o igual que el máximo",
        });
      }
    }

    // For non-checkbox types, validation must NOT exist
    if (
      data.type !== "checkbox" &&
      data.validation !== undefined &&
      data.validation !== null
    ) {
      ctx.addIssue({
        path: ["validation"],
        code: 'custom',
        message: "Solo los checkbox pueden tener validación",
      });
    }

    // For non-checkbox/selection types, choices must not exist
    if (
      !["checkbox", "selection"].includes(data.type) &&
      data.choices &&
      data.choices.length > 0
    ) {
      ctx.addIssue({
        path: ["choices"],
        code: 'custom',
        message: "Solo checkbox o selection pueden tener opciones",
      });
    }
  });

// array of options
export const ProductOptionsSchema = z
  .array(ProductOptionSchema)
  .max(100, "Demasiadas opciones");

// Side/extra group already attached — only sequence is editable here
export const AttachedGroupSequenceSchema = z.object({
  product_option_group_id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(["side", "extra"]),
  sequence: z.number().int(),
});

export const ProductVariantSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Nombre corto debe tener al menos 2 caracteres")
      .max(200, "Nombre corto no debe exceder 200 caracteres"),
    sequence: z
      .number()
      .int("Debe ser entero"),
    sku: z
      .string()
      .trim()
      .max(64, "SKU demasiado largo")
      .transform((s) => s.toUpperCase()).optional(),
    price: price,
    original_price: z.number().min(0, "El precio original no puede ser negativo").optional(),
    weight: z
    .number()
    .min(0, "El peso no puede ser negativo")
    .max(100_000, "Peso demasiado alto").optional(),
    business_locations: z.array(z.object({
      label: z.string(),
      value: z.string()
    })).optional(),
    images: z.array(z.string().trim()).optional(),
  })

export const ProductAddSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nombre corto debe tener al menos 2 caracteres")
    .max(200, "Nombre corto no debe exceder 200 caracteres"),
  
  visibility: z.boolean(),

  type: z.string().trim().min(1, "Tipo es requerido"),

  categories: z
    .array(
      z.object({
        label: z
          .string()
          .trim()
          .min(1, "La categoría es requerida")
          .max(100, "La categoría es demasiado larga"),
        value: z.string(),
      }),
    )
    .min(1, "La categoría es requerida"),

  sku: z
    .string()
    .trim()
    .max(64, "SKU demasiado largo")
    .transform((s) => s.toUpperCase()).optional(),

  weight: z
    .number()
    .min(0, "El peso no puede ser negativo")
    .max(100_000, "Peso demasiado alto").optional(),

  price: price,

  original_price: z.number().min(0, "El precio original no puede ser negativo"),

  business_locations: z.array(z.object({
    label: z.string(),
    value: z.string()
  })).optional(),

  description: z.string().optional(),

  delivery_methods: z.array(z.object({
    label: z.string(),
    value: z.string()
  })).optional(),

  images: z.array(z.string().trim()).optional(),

  variants: z.array(ProductVariantSchema).max(200, "Demasiadas variantes").optional(),

  options: z.array(ProductOptionSchema).max(100, "Demasiadas opciones").optional(),

  attached_group_sequences: z.array(AttachedGroupSequenceSchema).optional(),
});

export type ProductAddInput = z.infer<typeof ProductAddSchema>;

/**
[
  {
    name: '',
    sequence: 32131 num,
    type: could be text, number, date, checkbox, selection, media,
    required: bool,
    // if checkbox and selection
    choices: [
      {
        name: '',
        price: number
      }
    ],
    // if checkbox
    validation: could be not applicable, select at least, select at most, select between
  }
]
 */
