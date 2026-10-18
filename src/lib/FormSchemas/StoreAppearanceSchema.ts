import { z } from "zod";

const BannerSchema = z.object({
  text: z.string().trim().optional(),
  link: z.string().trim().optional(),
});

export const StoreAppearanceSchema = z.object({
  logo: z.string().trim().min(1, "Logo requerido"),
  front_page_image: z.string().trim().optional(),
  name: z.string().trim().min(1, "Nombre requerido"),
  description: z.string().trim().optional(),
  primary_color: z.string().trim().min(1, "Color primario requerido"),
  background_color: z.string().trim().min(1, "Color de fondo requerido"),
  banner: BannerSchema.optional(),
});

export type StoreAppearanceInput = z.infer<typeof StoreAppearanceSchema>;
