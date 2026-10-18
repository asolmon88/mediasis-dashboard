import { z } from "zod";

const price = z.number().min(0, "El precio no puede ser negativo");

// shared choice format used for select and checkbox questions
const ChoiceSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(200, "Nombre demasiado largo"),
  price,
});

// validation options for checkbox questions
const ValidationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("not_applicable"),
  }),
  z.object({
    type: z.literal("select_at_least"),
    min: z.number().int().positive("Debe ser mayor que 0"),
  }),
  z.object({
    type: z.literal("select_at_most"),
    max: z.number().int().positive("Debe ser mayor que 0"),
  }),
  z.object({
    type: z.literal("select_between"),
    min: z.number().int().positive("Debe ser mayor que 0"),
    max: z.number().int().positive("Debe ser mayor que 0"),
  }),
]);

export const CheckoutOptionSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("short_answer"),
      question: z.string().trim().min(1, "Pregunta requerida"),
      description: z.string().trim().optional(),
      required: z.boolean(),
    }),
    z.object({
      type: z.literal("media"),
      question: z.string().trim().min(1, "Pregunta requerida"),
      description: z.string().trim().optional(),
      required: z.boolean(),
    }),
    z.object({
      type: z.literal("select"),
      question: z.string().trim().min(1, "Pregunta requerida"),
      description: z.string().trim().optional(),
      required: z.boolean(),
      choices: z.array(ChoiceSchema).min(1, "Debe incluir al menos una opción"),
    }),
    z.object({
      type: z.literal("checkbox"),
      question: z.string().trim().min(1, "Pregunta requerida"),
      description: z.string().trim().optional(),
      required: z.boolean(),
      choices: z.array(ChoiceSchema).min(1, "Debe incluir al menos una opción"),
      validation: ValidationSchema,
    }),
    z.object({
      type: z.literal("text"),
      text: z.string().trim().min(1, "Texto requerido"),
    }),
  ])
  .superRefine((data, ctx) => {
    if (
      data.type === "checkbox" &&
      data.validation?.type === "select_between" &&
      data.validation.min >= data.validation.max
    ) {
      ctx.addIssue({
        path: ["validation"],
        code: "custom",
        message: "El valor mínimo debe ser menor que el máximo",
      });
    }
  });

export const CheckoutSchema = z.object({
  enable_discounts: z.boolean(),
  redirect_to_whatsapp: z.boolean(),
  customer_sends_whatsapp_manually: z.boolean().optional(),
  customer_sends_whatsapp_manually_location_ids: z.array(z.string().uuid()).optional(),
  enable_electronic_invoice: z.boolean(),
  show_loyalty_program_in_whatsapp: z.boolean(),
  options: z.array(CheckoutOptionSchema).max(100, "Demasiadas opciones").optional(),
});

export type CheckoutInput = z.infer<typeof CheckoutSchema>;
