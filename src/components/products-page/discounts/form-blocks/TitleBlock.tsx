"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type TitleBlockProps = {
  discountType: string;
  discountTypeTitle: string;
  isActive: boolean;
  onActiveChange: (value: boolean) => void;
  title: string;
  onTitleChange: (value: string) => void;
  code: string;
  onCodeChange: (value: string) => void;
};

export default function TitleBlock({
  discountType,
  discountTypeTitle,
  isActive,
  onActiveChange,
  title,
  onTitleChange,
  code,
  onCodeChange,
}: TitleBlockProps) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Switch checked={isActive} onCheckedChange={onActiveChange} />
        <span className="text-base font-medium">Activo</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Información general</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid grid-cols-1 gap-6">
            <Field>
              <FieldLabel>Tipo</FieldLabel>
              <p className="text-sm text-muted-foreground">
                {discountTypeTitle}
              </p>
            </Field>

            <Field>
              <FieldLabel>
                Título <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                placeholder="Título"
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
              />
            </Field>

            {discountType === "code" || discountType === "free_delivery" ? (
              <Field>
                <FieldLabel>
                  Código <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  placeholder="Código"
                  value={code}
                  onChange={(event) => onCodeChange(event.target.value)}
                />
              </Field>
            ) : null}
          </FieldGroup>
        </CardContent>
      </Card>
    </>
  );
}
