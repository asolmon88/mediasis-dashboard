import { z } from "zod";

export const dailyPreparationResetSchema = z.object({
  enabled: z.boolean(),
  availableEverywhere: z.boolean(),
  businessLocationIds: z.array(z.string().uuid()).max(100),
  methodValues: z.array(z.object({
    id: z.string().uuid(),
    resetMinutes: z.number().int().min(1).max(180).nullable(),
  })).max(1000),
}).superRefine((value, context) => {
  if (value.enabled && !value.availableEverywhere && !value.businessLocationIds.length) {
    context.addIssue({ code: "custom", path: ["businessLocationIds"], message: "Seleccioná al menos una ubicación." });
  }
  if (new Set(value.methodValues.map((method) => method.id)).size !== value.methodValues.length) {
    context.addIssue({ code: "custom", path: ["methodValues"], message: "Hay métodos de delivery duplicados." });
  }
});

export type DailyPreparationResetInput = z.infer<typeof dailyPreparationResetSchema>;

export type DailyPreparationResetSettings = {
  enabled: boolean;
  available_everywhere: boolean;
  global_configuration_active: boolean;
  can_manage_all_locations: boolean;
  selected_location_ids: string[];
  locations: Array<{ business_location_id: string; short_name: string }>;
  timezone: string | null;
  timezone_valid: boolean;
  methods: Array<{
    id: string;
    name: string | null;
    reset_minutes: number;
    uses_default: boolean;
    available_everywhere: boolean;
    location_ids: string[];
    can_edit: boolean;
  }>;
};
