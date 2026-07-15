"use client";

import { useState, useTransition } from "react";
import { createOpportunityForAccount } from "@/app/dashboard/contas/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

type C = { id: string; name: string };

export default function NewOpportunityForAccount({
  accountId,
  accountName,
  contacts,
}: {
  accountId: string;
  accountName: string;
  contacts: C[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(accountName);
  const [valor, setValor] = useState("");
  const [contatoId, setContatoId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function salvar() {
    setErro(null);
    start(async () => {
      const r: any = await createOpportunityForAccount(accountId, {
        title,
        value_mrr: Number(valor.replace(",", ".")) || 0,
        primary_contact_id: contatoId || undefined,
      });
      if (r?.error) { setErro(r.error); return; }
      setValor(""); setContatoId(""); setOpen(false);
    });
  }

  if (!open) {
    return <button className="btn-brand py-1.5 text-sm" onClick={() => setOpen(true)}>+ Nova oportunidade</button>;
  }

  const opts: SmartOption[] = contacts.map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="card mt-2 p-3">
      <div className="grid gap-2">
        <input className="input" placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input" placeholder="Valor mensal (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          {opts.length > 0 && (
            <SmartSelect options={opts} value={contatoId} onValueChange={setContatoId} placeholder="Contato principal (opcional)" clearable />
          )}
        </div>
      </div>
      {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={salvar} disabled={pending}>
          {pending ? "Criando…" : "Criar oportunidade"}
        </button>
        <button className="text-sm text-subtle hover:text-ink" onClick={() => setOpen(false)}>cancelar</button>
      </div>
    </div>
  );
}
