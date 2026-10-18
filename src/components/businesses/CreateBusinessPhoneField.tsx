"use client";

import type { ComponentProps } from "react";

import { PhoneInput } from "@/components/ui/phone-input";

type PhoneValue = ComponentProps<typeof PhoneInput>["value"];

export default function CreateBusinessPhoneField({
  value,
  name,
  disabled,
  onBlur,
  onChange,
  defaultCountry,
}: {
  value: string;
  name: string;
  disabled?: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
  defaultCountry: NonNullable<ComponentProps<typeof PhoneInput>["defaultCountry"]>;
}) {
  return (
    <PhoneInput
      defaultCountry={defaultCountry}
      name={name}
      value={value as PhoneValue}
      disabled={disabled}
      onBlur={onBlur}
      onChange={(nextValue) => onChange(nextValue ?? "")}
    />
  );
}
