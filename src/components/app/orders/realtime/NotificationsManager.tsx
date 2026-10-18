"use client";

import { useEffect, useRef } from "react";

type NotificationsManagerProps = {
  enabled: boolean;
  count: number;
  triggerId: string | null;
  title: string;
  body?: string;
};

export function NotificationsManager({
  enabled,
  count,
  triggerId,
  title,
  body,
}: NotificationsManagerProps) {
  const originalTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (originalTitleRef.current === null) {
      originalTitleRef.current = document.title;
    }
    const baseTitle = originalTitleRef.current ?? "Pedidos en tiempo real";
    document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
  }, [count]);

  useEffect(() => {
    if (!enabled || !triggerId) return;
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (!document.hidden) return;

    const options: NotificationOptions & { renotify?: boolean } = {
      body,
      tag: triggerId,
      renotify: true,
    };

    const notification = new Notification(title, options);

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }, [enabled, triggerId, title, body]);

  return null;
}
