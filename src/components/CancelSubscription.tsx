"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelSubscription } from "@/app/dashboard/planos/actions";

export default function CancelSubscription() {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function doCancel() {
    setMsg(null);
    start(async () => {
      const res = (await cancelSubscription()) as { ok?: boolean; error?: string };
      if (res?.error) setMsg(res.error);
      else { setConfirm(false); router.refresh(); }
    });
  }

  if (!confirm) {
    return (
      <button className="text-sm text-subtle underline hover:text-danger" onClick={() => setConfirm(true)}>
        Cancelar assinatura
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
      <p className="text-sm font-semibold text-danger">Cancelar a assinatura?</p>
      <p className="mt-1 text-sm text-ink/80">
        A cobrança recorrente é encerrada no Asaas e o workspace volta ao estado sem plano. Você pode reassinar quando quiser.
      </p>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <div className="mt-3 flex gap-2">
        <button className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60" disabled={pending} onClick={doCancel}>
          {pending ? "Cancelando…" : "Sim, cancelar"}
        </button>
        <button className="btn-ghost py-1.5 text-sm" onClick={() => setConfirm(false)}>Voltar</button>
      </div>
    </div>
  );
}
