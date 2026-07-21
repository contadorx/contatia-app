"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { hideOnboarding } from "@/app/dashboard/setup-actions";

// "Não mostrar mais" da caixa de primeiros passos. Persistido no perfil.
export default function DismissOnboarding() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="text-xs text-subtle hover:text-ink disabled:opacity-50"
      disabled={pending}
      title="Esconde este guia de vez. Ele também some sozinho quando você completa os passos."
      onClick={() => start(async () => { await hideOnboarding(); router.refresh(); })}
    >
      {pending ? "…" : "✕ não mostrar mais"}
    </button>
  );
}
