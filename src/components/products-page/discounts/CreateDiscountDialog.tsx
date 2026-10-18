"use client";

import {
  Hand,
  KeyRound,
  PackagePlus,
  ShoppingCart,
  Tag,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { DiscountTypeOption } from "@/lib/types/dashboardTypes";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type CreateDiscountDialogProps = {
  options: DiscountTypeOption[];
};

export default function CreateDiscountDialog({ options }: CreateDiscountDialogProps) {
  const router = useRouter();
  const iconMap: Record<DiscountTypeOption["icon"], LucideIcon> = {
    "key-round": KeyRound,
    "shopping-cart": ShoppingCart,
    tag: Tag,
    "package-plus": PackagePlus,
    hand: Hand,
    truck: Truck,
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button">Crear descuento</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crear descuento</DialogTitle>
          <DialogDescription>
            Estamos desarrollando más tipos de descuentos
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          {options.map((option) => {
            const Icon = iconMap[option.icon];
            return (
              <button
                key={option.type}
                type="button"
                disabled={!option.available}
                onClick={() => router.push(`/admin/products/discounts/add/${option.type}`)}
                className={`w-full text-left rounded-md p-3 transition-colors hover:bg-muted ${
                  option.available ? "cursor-pointer" : "cursor-not-allowed opacity-55"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon className="h-6 w-6 mt-0.5 text-muted-foreground" />
                  <div>
                    <p className="text-xl font-semibold">{option.title}</p>
                    <p className="text-muted-foreground text-sm leading-normal">
                      {option.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
