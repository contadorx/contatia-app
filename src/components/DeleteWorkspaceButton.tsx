"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteWorkspace } from "@/app/dashboard/superadmin/workspace-actions";

// Excluir workspace (superadmin) com confirmação por digitação do nome exato.
export default function DeleteWorkspaceButton({ tenantId, name }: { tenantId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        className="rounded-lg border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/10"
        onClick={() => setOpen(true)}
      >
        excluir
      </button>
    );
  }

  const canDelete = confirmText.trim() === name.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <div className="card w-full max-w-sm p-5 text-left" onClick={(e) => e.stopPropagation()}>
        <p className="font-display text-base font-bold text-danger">Excluir workspace</p>
        <p className="mt-2 text-sm text-subtle">
          Isto apaga <b className="text-ink">{name}</b> e <b>todos os dados</b> dele — contatos, cadências,
          negócios, tarefas, reuniões. Os usuários ficam sem workspace. <b>Não dá para desfazer.</b>
        </p>
        <p className="mt-3 text-xs text-subtle">Para confirmar, digite o nome do workspace:</p>
        <input className="input mt-1" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={name} />
        {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
        <div className="mt-4 flex gap-2">
          <button
            className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={pending || !canDelete}
            onClick={() => start(async () => {
              setMsg(null);
              const r = (await deleteWorkspace(tenantId)) as any;
              if (r?.error) setMsg(r.error);
              else { setOpen(false); router.refresh(); }
            })}
          >
            {pending ? "Excluindo..." : "Excluir definitivamente"}
          </button>
          <button className="btn-ghost py-1.5 text-sm" onClick={() => { setOpen(false); setConfirmText(""); setMsg(null); }}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
