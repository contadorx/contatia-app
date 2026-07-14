"use client";

import { useState, useTransition } from "react";
import { setContactAccount } from "@/app/dashboard/contas/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

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

  const opts: SmartOption[] = available.map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="flex items-center gap-2">
      <SmartSelect
        className="max-w-xs py-1.5"
        options={opts}
        value={sel}
        onValueChange={(v) => setSel(v)}
        placeholder="Vincular contato existente…"
        clearable
      />
      <button className="btn-ghost py-1.5 text-sm" onClick={add} disabled={pending || !sel}>
        {pending ? "..." : "Adicionar"}
      </button>
    </div>
  );
}
