"use client";

import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";

type NotificationsControlProps = {
  enabled: boolean;
  onRequestPermission: () => void;
};

export function NotificationsControl({ enabled, onRequestPermission }: NotificationsControlProps) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onRequestPermission}
      disabled={enabled}
      className="w-fit"
    >
      <Bell className="h-4 w-4" />
      {enabled ? "Notificaciones activadas" : "Habilitar notificaciones"}
    </Button>
  );
}
