"use client";

import { useState, useTransition } from "react";
import { viewDocument, deleteDocument } from "@/app/dashboard/propostas/actions";

export default function ViewDocButton({ documentId, hasFile }: { documentId: string; hasFile?: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  function open() {
    setErr(null);
    start(async () => {
      const res = (await viewDocument(documentId)) as { url?: string; error?: string };
      if (res?.url) window.open(res.url, "_blank", "noopener");
      else setErr(res?.error || "Erro ao abrir.");
    });
  }
  function del() {
    setErr(null);
    start(async () => {
      const res = (await deleteDocument(documentId)) as { ok?: boolean; error?: string };
      if (res?.error) setErr(res.error);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {hasFile && (
        <button className="text-xs font-semibold text-brand-dark hover:underline" onClick={open} disabled={pending}>
          {pending ? "..." : "Ver arquivo"}
        </button>
      )}
      {!confirm ? (
        <button className="text-xs text-subtle hover:text-danger" onClick={() => setConfirm(true)} disabled={pending}>excluir</button>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs">
          <span className="text-subtle">confirma?</span>
          <button className="font-semibold text-danger hover:underline" onClick={del} disabled={pending}>sim</button>
          <button className="text-subtle hover:text-ink" onClick={() => setConfirm(false)}>não</button>
        </span>
      )}
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}
