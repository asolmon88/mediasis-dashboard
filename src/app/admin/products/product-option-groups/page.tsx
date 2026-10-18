import Link from "next/link";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { getBusinessOptionGroups } from "./actions";

export default async function OptionGroupsPage() {
  const result = await getBusinessOptionGroups();
  const groups = result.success
    ? (result.data ?? []).filter((g) => g.kind !== "general")
    : [];

  const kindLabel: Record<string, string> = {
    general: "General",
    side: "Acompañamiento",
    extra: "Extra",
  };

  return (
    <div className="px-4 mb-32">
      <BackButton label="Productos" />

      <div className="flex justify-center">
        <div className="w-full max-w-xl space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Acompañamientos / Extras</h1>
            <Link href="/admin/products/product-option-groups/new">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Nuevo grupo
              </Button>
            </Link>
          </div>

          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay grupos creados. Crea uno nuevo para empezar.
            </p>
          )}

          <div className="space-y-2">
            {groups.map((group) => (
              <Link
                key={group.product_option_group_id}
                href={`/admin/products/product-option-groups/${group.product_option_group_id}`}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Badge variant={group.kind === "general" ? "secondary" : group.kind === "side" ? "default" : "outline"}>
                    {kindLabel[group.kind] ?? group.kind}
                  </Badge>
                  <span className="font-medium">{group.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {(group.options ?? []).length} opción(es)
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
