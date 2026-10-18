import { z } from "zod";

const price = z.number().min(0, "El precio no puede ser negativo");

export const ChoiceSchema = z.object({
  product_option_choice_id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Nombre requerido").max(300),
  price,
  scope: z.enum(["all", "specific"]).optional(),
  sequence: z.number().int(),
  location_ids: z.array(z.string().uuid()).optional(),
});

const OptionalPositiveInt = z.number().int().positive("Debe ser mayor que 0").optional();

const ValidationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("not_applicable") }),
  z.object({ type: z.literal("select_at_least"), min: OptionalPositiveInt }),
  z.object({ type: z.literal("select_at_most"), max: OptionalPositiveInt }),
  z.object({ type: z.literal("select_between"), min: OptionalPositiveInt, max: OptionalPositiveInt }),
]);

export const GroupOptionSchema = z.object({
  product_option_id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Nombre requerido").max(150),
  type: z.enum(["text", "number", "date", "checkbox", "selection", "media"]),
  required: z.boolean(),
  enable_quantity: z.boolean().optional(),
  choices: z.array(ChoiceSchema).optional(),
  validation: ValidationSchema.optional(),
});

export const OptionGroupSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(150),
  kind: z.enum(["general", "side", "extra"]),
  options: z.array(GroupOptionSchema).optional(),
});

export type OptionGroupInput = z.infer<typeof OptionGroupSchema>;
export type GroupOptionInput = z.infer<typeof GroupOptionSchema>;
export type ChoiceInput = z.infer<typeof ChoiceSchema>;
