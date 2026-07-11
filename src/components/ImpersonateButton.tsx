"use client";

import { useTransition } from "react";
import { startImpersonation } from "@/app/dashboard/superadmin/impersonate-actions";

export function ImpersonateButton({ tenantId, name }: { tenantId: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => {
        if (confirm(`Entrar no workspace "${name}" para dar suporte? Você verá o app como o cliente vê.`)) {
          start(() => { startImpersonation(tenantId); });
        }
      }}
      disabled={pending}
      className="rounded-lg border border-line px-3 py-1 text-xs font-semibold text-brand hover:border-brand disabled:opacity-50"
    >
      {pending ? "Entrando..." : "Entrar →"}
    </button>
  );
}
