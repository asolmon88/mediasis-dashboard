"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateBillingEmail } from "./actions";

export function BillingEmailForm({ initialEmail }: { initialEmail: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  return <form className="flex gap-2" onSubmit={async (event) => { event.preventDefault(); setPending(true); const result = await updateBillingEmail(email); setPending(false); if (result.success) { toast.success(result.message); router.refresh(); } else toast.error(result.message); }}><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /><Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button></form>;
}
