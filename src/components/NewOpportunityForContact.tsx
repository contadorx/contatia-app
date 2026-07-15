"use client";

import { useState, useTransition } from "react";
import { createOpportunityForContact } from "@/app/dashboard/contatos/ficha-actions";

export default function NewOpportunityForContact({ contactId, defaultTitle }: { contactId: string; defaultTitle: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function salvar() {
    setErro(null);
    start(async () => {
      const r: any = await createOpportunityForContact(contactId, { title, value_mrr: Number(valor.replace(",", ".")) || 0 });
      if (r?.error) { setErro(r.error); return; }
      setValor("");
      setOpen(false);
    });
  }

  if (!open) {
    return <button className="btn-brand py-1.5 text-sm" onClick={() => setOpen(true)}>+ Nova oportunidade</button>;
  }

  return (
    <div className="card mt-2 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input sm:col-span-2" placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" placeholder="Valor mensal (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
      </div>
      {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={salvar} disabled={pending}>{pending ? "Criando…" : "Criar oportunidade"}</button>
        <button className="text-sm text-subtle hover:text-ink" onClick={() => setOpen(false)}>cancelar</button>
      </div>
    </div>
  );
}
