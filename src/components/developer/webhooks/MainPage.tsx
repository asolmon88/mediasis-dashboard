"use client";

import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteBusinessWebhook,
  rotateBusinessWebhookSecret,
} from "@/app/admin/developer/webhooks/actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  BusinessLocations,
  BusinessWebhookRow,
  BusinessWebhookRows,
} from "@/lib/types/dashboardTypes";

import WebhookCreateSheet from "./WebhookCreateSheet";
import WebhooksTable from "./WebhooksTable";

type WebhooksMainPageProps = {
  webhooks: BusinessWebhookRows;
  businessLocations: BusinessLocations;
  canManageAllLocations: boolean;
};

type CreatedSecretState = {
  secret: string;
} | null;

type ActionTargetState = {
  webhook_id: string;
  endpoint_url: string;
} | null;

export default function MainPage({ webhooks, businessLocations, canManageAllLocations }: WebhooksMainPageProps) {
  const [rows, setRows] = useState<BusinessWebhookRows>(webhooks);
  const [createdSecret, setCreatedSecret] = useState<CreatedSecretState>(null);
  const [rotateTarget, setRotateTarget] = useState<ActionTargetState>(null);
  const [deleteTarget, setDeleteTarget] = useState<ActionTargetState>(null);
  const [pendingWebhookId, setPendingWebhookId] = useState<string | null>(null);

  const handleCreated = (webhook: BusinessWebhookRow, plaintextSecret: string) => {
    setRows((currentRows) => {
      const existingIndex = currentRows.findIndex((row) => row.webhook_id === webhook.webhook_id);
      if (existingIndex === -1) return [webhook, ...currentRows];

      return currentRows.map((row) => (row.webhook_id === webhook.webhook_id ? webhook : row));
    });
    setCreatedSecret({
      secret: plaintextSecret,
    });
  };

  const handleSecretDialogOpenChange = (open: boolean) => {
    if (!open) setCreatedSecret(null);
  };

  const handleCopySecret = async () => {
    if (!createdSecret?.secret) return;

    try {
      await navigator.clipboard.writeText(createdSecret.secret);
      toast.success("Secreto copiado");
    } catch {
      toast.error("No se pudo copiar el secreto");
    }
  };

  const handleRotateClick = (webhook: BusinessWebhookRow) => {
    setRotateTarget({
      webhook_id: webhook.webhook_id,
      endpoint_url: webhook.endpoint_url,
    });
  };

  const handleDeleteClick = (webhook: BusinessWebhookRow) => {
    setDeleteTarget({
      webhook_id: webhook.webhook_id,
      endpoint_url: webhook.endpoint_url,
    });
  };

  const handleConfirmRotate = async () => {
    if (!rotateTarget) return;

    setPendingWebhookId(rotateTarget.webhook_id);
    const result = await rotateBusinessWebhookSecret({
      webhook_id: rotateTarget.webhook_id,
    });
    setPendingWebhookId(null);

    if (!result.success) {
      toast.error(result.message);
      return;
    }
    if (!result.data) {
      toast.error("No se pudo rotar el secreto");
      return;
    }

    setRows((currentRows) =>
      currentRows.map((row) =>
        row.webhook_id === result.data.webhook.webhook_id ? result.data.webhook : row,
      ),
    );
    setRotateTarget(null);
    setCreatedSecret({
      secret: result.data.plaintext_secret,
    });
    toast.success("Secreto rotado");
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    setPendingWebhookId(deleteTarget.webhook_id);
    const result = await deleteBusinessWebhook({
      webhook_id: deleteTarget.webhook_id,
    });
    setPendingWebhookId(null);

    if (!result.success) {
      toast.error(result.message ?? "No se pudo eliminar el webhook");
      return;
    }

    setRows((currentRows) =>
      currentRows.filter((row) => row.webhook_id !== deleteTarget.webhook_id),
    );
    setDeleteTarget(null);
    toast.success("Webhook eliminado");
  };

  return (
    <>
      <div className="px-4 py-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Webhooks</h1>
            <p className="text-sm text-muted-foreground">
              Administra los endpoints que reciben eventos de pedidos desde Mediasis.
            </p>
          </div>
          <WebhookCreateSheet
            businessLocations={businessLocations}
            canManageAllLocations={canManageAllLocations}
            onCreated={handleCreated}
          />
        </div>

        <WebhooksTable
          webhooks={rows}
          businessLocations={businessLocations}
          pendingWebhookId={pendingWebhookId}
          onRotate={handleRotateClick}
          onDelete={handleDeleteClick}
        />
      </div>

      <Dialog open={!!createdSecret} onOpenChange={handleSecretDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Secreto del webhook</DialogTitle>
            <DialogDescription>
              Guarda este secreto ahora. Por seguridad no volverá a mostrarse.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/40 p-3">
            <code className="block break-all text-sm">{createdSecret?.secret}</code>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCopySecret}>
              <Copy className="h-4 w-4" />
              Copiar
            </Button>
            <Button type="button" onClick={() => setCreatedSecret(null)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!rotateTarget}
        onOpenChange={(open) => {
          if (!open && !pendingWebhookId) setRotateTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotar secreto del webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              El secreto actual de {rotateTarget?.endpoint_url} dejará de funcionar. Se generará
              un nuevo secreto y solo se mostrará una vez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!pendingWebhookId}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              onClick={handleConfirmRotate}
              disabled={!!pendingWebhookId}
            >
              {pendingWebhookId === rotateTarget?.webhook_id ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Rotando...
                </>
              ) : (
                "Rotar secreto"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !pendingWebhookId) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará {deleteTarget?.endpoint_url} y no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!pendingWebhookId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={!!pendingWebhookId}>
              {pendingWebhookId === deleteTarget?.webhook_id ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Eliminando...
                </>
              ) : (
                "Eliminar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
