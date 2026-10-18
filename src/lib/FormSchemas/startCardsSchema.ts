import { z } from "zod";

const CategorySchema = z.object({
  label: z.string().trim().min(1, "Nombre requerido"),
  value: z.string().trim().min(1, "Id requerido"),
});

const StartCardSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("product_category"),
    category: CategorySchema,
    feature_only_four_products: z.boolean(),
    visible: z.boolean(),
  }),
  z.object({
    type: z.literal("link"),
    title: z.string().trim().min(1, "Título requerido"),
    link_to_link: z.string().trim().min(1, "Link requerido"),
    visible: z.boolean(),
  }),
  z.object({
    type: z.literal("text"),
    title: z.string().trim().min(1, "Texto requerido"),
    text: z.string().trim().min(1, "Texto requerido"),
    visible: z.boolean(),
  }),
  z.object({
    type: z.literal("image"),
    title: z.string().trim().min(1, "Título requerido"),
    links_to_image: z.array(z.string().trim().min(1, "Imagen requerida")).min(1, "Debe incluir al menos una imagen"),
    redirect_link: z.string().trim().min(1, "Link requerido").optional(),
    visible: z.boolean(),
  }),
  z.object({
    type: z.literal("video"),
    title: z.string().trim().min(1, "Título requerido"),
    link_to_video: z.string().trim().min(1, "Link requerido"),
    visible: z.boolean(),
  }),
]);

export const StartCardsSchema = z
  .array(StartCardSchema)
  .min(1, "Debe incluir al menos una tarjeta");

export type StartCardsInput = z.infer<typeof StartCardsSchema>;
