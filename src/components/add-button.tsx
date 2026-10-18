"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface AddButtonProps {
  label: string;
  onClick?: () => void;
  className?: string;
}

export function AddButton({ label, onClick, className }: AddButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className={`w-full justify-center gap-2 ${className || ""}`}
    >
      <Plus className="h-4 w-4" />
      {label}
    </Button>
  );
}