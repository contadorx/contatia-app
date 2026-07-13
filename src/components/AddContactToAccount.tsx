"use client";

import { useState, useTransition } from "react";
import { setContactAccount } from "@/app/dashboard/contas/actions";

type C = { id: string; name: string };

export default function AddContactToAccount({ accountId, available }: { accountId: string; available: C[] }) {
  const [sel, setSel] = useState("");
  const [pending, start] = useTransition();

  if (!available.length) return <p className="text-xs text-subtle">Nenhum contato livre para vincular.</p>;

  function add() {
    if (!sel) return;
    const id = sel;
    setSel("");
    start(async () => {
      await setContactAccount(id, accountId);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select className="input max-w-xs py-1.5" value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">Vincular contato existente…</option>
        {available.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button className="btn-ghost py-1.5 text-sm" onClick={add} disabled={pending || !sel}>
        {pending ? "..." : "Adicionar"}
      </button>
    </div>
  );
}
