"use client";

import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createBusinessWebhook } from "@/app/admin/developer/webhooks/actions";
import { restrictedDefaultLocationIds } from "@/lib/dashboard/location-scope";
import {
  WEBHOOK_EVENT_TYPE_OPTIONS,
  WebhookCreateFormInput,
  WebhookCreateInput,
  WebhookCreateSchema,
} from "@/lib/FormSchemas/webhookSchema";
import type {
  BusinessLocations,
  BusinessWebhookRow,
} from "@/lib/types/dashboardTypes";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  MultiSelector,
  MultiSelectorContent,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
  type MultiSelectValue,
} from "@/components/ui/multi-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";

type WebhookCreateSheetProps = {
  businessLocations: BusinessLocations;
  canManageAllLocations: boolean;
  onCreated: (webhook: BusinessWebhookRow, plaintextSecret: string) => void;
};

const FORM_ID = "webhook-create-form";

export default function WebhookCreateSheet({
  businessLocations,
  canManageAllLocations,
  onCreated,
}: WebhookCreateSheetProps) {
  const [open, setOpen] = useState(false);
  const [availableEverywhere, setAvailableEverywhere] = useState(canManageAllLocations);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<WebhookCreateFormInput, unknown, WebhookCreateInput>({
    resolver: zodResolver(WebhookCreateSchema),
    defaultValues: {
      endpoint_url: "",
      enabled: true,
      event_types: ["order.paid"],
      location_ids: [],
    },
  });

  const selectedLocations = form.watch("location_ids") ?? [];
  const selectedLocationValues = useMemo<MultiSelectValue[]>(
    () =>
      selectedLocations.map((locationId) => ({
        value: locationId,
        label:
          businessLocations.find((location) => location.business_location_id === locationId)
            ?.short_name ?? locationId,
      })),
    [businessLocations, selectedLocations],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && !canManageAllLocations) {
      setAvailableEverywhere(false);
      form.setValue("location_ids", restrictedDefaultLocationIds(businessLocations));
    }
    if (!nextOpen) {
      form.reset();
      setAvailableEverywhere(canManageAllLocations);
      setIsSubmitting(false);
    }
  };

  const handleAvailableEverywhereChange = (checked: boolean) => {
    setAvailableEverywhere(checked);
    if (checked) {
      form.setValue("location_ids", [], {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  };

  const handleSelectedLocationsChange = (values: MultiSelectValue[]) => {
    form.setValue(
      "location_ids",
      values.map((value) => value.value),
      {
        shouldDirty: true,
        shouldValidate: true,
      },
    );
  };

  async function onSubmit(values: WebhookCreateInput) {
    if (isSubmitting) return;

    if (!availableEverywhere && values.location_ids.length === 0) {
      form.setError("location_ids", {
        message: "Seleccione al menos una ubicación o active todas las ubicaciones",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const parsed = WebhookCreateSchema.safeParse(values);
      if (!parsed.success) {
        toast.error("Datos invalidos");
        return;
      }

      const result = await createBusinessWebhook(parsed.data);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      if (!result.data) {
        toast.error("No se pudo crear el webhook");
        return;
      }

      toast.success("Webhook creado");
      onCreated(result.data.webhook, result.data.plaintext_secret);
      handleOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button type="button">
          <Plus className="h-4 w-4" />
          Crear webhook
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex h-dvh max-h-dvh w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="shrink-0 pb-4">
          <SheetTitle>Crear webhook</SheetTitle>
          <SheetDescription>
            Configura el endpoint que recibirá eventos de pedidos.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 pr-4">
          <form id={FORM_ID} onSubmit={form.handleSubmit(onSubmit)} className="px-4 pb-4">
            <FieldGroup className="gap-6">
              <Controller
                name="endpoint_url"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel>URL del endpoint *</FieldLabel>
                    <Input placeholder="https://api.farmacia.com/webhooks/mediasis" {...field} />
                    <FieldDescription>
                      Debe ser una URL HTTPS pública.
                    </FieldDescription>
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />

              <Controller
                name="enabled"
                control={form.control}
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                    <FieldContent>
                      <FieldTitle>Webhook activo</FieldTitle>
                      <FieldDescription>
                        Mediasis enviará eventos a este endpoint cuando esté activo.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                )}
              />

              <Controller
                name="event_types"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel>Eventos *</FieldLabel>
                    <div className="space-y-3 rounded-md border p-3">
                      {WEBHOOK_EVENT_TYPE_OPTIONS.map((option) => {
                        const checked = (field.value ?? []).includes(option.value);

                        return (
                          <Field key={option.value} orientation="horizontal">
                            <Checkbox
                              checked={checked}
                              disabled={!option.available}
                              onCheckedChange={(value) => {
                                const nextChecked = Boolean(value);
                                const current = new Set(field.value ?? []);
                                if (nextChecked) {
                                  current.add(option.value);
                                } else {
                                  current.delete(option.value);
                                }
                                field.onChange(Array.from(current));
                              }}
                            />
                            <FieldContent>
                              <FieldTitle>{option.label}</FieldTitle>
                              <FieldDescription>{option.value}</FieldDescription>
                            </FieldContent>
                          </Field>
                        );
                      })}
                    </div>
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />

              <Field>
                {canManageAllLocations ? <div className="flex items-start gap-3">
                  <Checkbox
                    id="webhook-all-locations"
                    checked={availableEverywhere}
                    disabled={!canManageAllLocations}
                    onCheckedChange={(checked) => handleAvailableEverywhereChange(Boolean(checked))}
                  />
                  <div className="space-y-1">
                    <label
                      htmlFor="webhook-all-locations"
                      className="text-sm font-medium leading-none"
                    >
                      Enviar eventos de todas las ubicaciones a este webhook
                    </label>
                    <p className="text-sm text-muted-foreground">
                      Desactívalo para limitar este endpoint a ubicaciones específicas.
                    </p>
                  </div>
                </div> : null}
                {!canManageAllLocations ? (
                  <p className="text-sm text-muted-foreground">
                    Solo podés seleccionar las ubicaciones que tenés asignadas.
                  </p>
                ) : null}

                {(!canManageAllLocations || !availableEverywhere) ? (
                  <div className="space-y-2">
                    <MultiSelector
                      values={selectedLocationValues}
                      onValuesChange={handleSelectedLocationsChange}
                      loop
                      className="w-full"
                    >
                      <MultiSelectorTrigger>
                        <MultiSelectorInput placeholder="Selecciona ubicaciones" />
                      </MultiSelectorTrigger>
                      <MultiSelectorContent>
                        <MultiSelectorList>
                          {businessLocations.map((location) => (
                            <MultiSelectorItem
                              key={location.business_location_id}
                              value={location.business_location_id}
                              label={location.short_name}
                            >
                              {location.short_name}
                            </MultiSelectorItem>
                          ))}
                        </MultiSelectorList>
                      </MultiSelectorContent>
                    </MultiSelector>
                    {form.formState.errors.location_ids ? (
                      <FieldError errors={[form.formState.errors.location_ids]} />
                    ) : null}
                  </div>
                ) : null}
              </Field>
            </FieldGroup>
          </form>
        </ScrollArea>

        <SheetFooter className="shrink-0 pt-4">
          <Button type="submit" form={FORM_ID} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creando...
              </>
            ) : (
              "Crear"
            )}
          </Button>
          <SheetClose asChild>
            <Button type="button" variant="outline" disabled={isSubmitting}>
              Cerrar
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
