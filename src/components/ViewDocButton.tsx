"use client";

import { useState, useTransition } from "react";
import { viewDocument } from "@/app/dashboard/propostas/actions";

export default function ViewDocButton({ documentId }: { documentId: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function open() {
    setErr(null);
    start(async () => {
      const res = (await viewDocument(documentId)) as { url?: string; error?: string };
      if (res?.url) window.open(res.url, "_blank", "noopener");
      else setErr(res?.error || "Erro ao abrir.");
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button className="text-xs font-semibold text-brand-dark hover:underline" onClick={open} disabled={pending}>
        {pending ? "Abrindo..." : "Ver arquivo"}
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}
