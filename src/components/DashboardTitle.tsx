"use client";

import { data } from "@/lib/dashboardData";
import { LucideIcon } from "lucide-react";
import { usePathname } from "next/navigation";
type ChildItem = { title: string; url: string };
type ProjectEntry = {
  name: string;
  url: string;
  icon: LucideIcon;
  title?: string;
  isActive?: boolean;
  items?: ChildItem[];
};

type FlatItem = {
  title: string;
  url: string;
  parent?: { name: string };
};

export default function DashboardTitle() {
  const pathname = usePathname();

  // If your data already has a type, use it instead of ProjectEntry[]
  const projects: ProjectEntry[] = data.projects;

  const flattened: FlatItem[] = projects.flatMap<FlatItem>((entry) =>
    entry.items && entry.items.length
      ? entry.items.map((item) => ({
          title: item.title,
          url: item.url,
          parent: { name: entry.name },
        }))
      : [
          {
            title: entry.name, // normalize top-level "name" into "title"
            url: entry.url,
          },
        ]
  );

  const match = flattened.find((i) => i.url === pathname);

  return (
    <h1 className="truncate text-sm font-medium text-muted-foreground">
      {match
        ? match.parent
          ? `${match.parent.name} | ${match.title}`
          : match.title
        : "Sin título"}
    </h1>
  );
}
