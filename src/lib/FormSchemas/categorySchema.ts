import { z } from "zod";

export const CategoryProductSchema = z.object({
  product_id: z.string().trim().min(1, "Producto requerido"),
  sequence: z.number().int("Debe ser entero"),
});

export const CategoryAddSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(100, "Nombre muy largo"),
  visible: z.boolean(),
  image_url: z.string().trim().url().optional().nullable(),
  products: z.array(CategoryProductSchema).optional(),
});

export type CategoryAddInput = z.infer<typeof CategoryAddSchema>;
