"use client";

import { useState, useTransition } from "react";
import { createContactForAccount } from "@/app/dashboard/contas/actions";

export default function NewContactForAccount({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", role_title: "", email: "", phone: "" });
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  function salvar() {
    setErro(null);
    start(async () => {
      const r: any = await createContactForAccount(accountId, f);
      if (r?.error) { setErro(r.error); return; }
      setF({ name: "", role_title: "", email: "", phone: "" });
      setOpen(false);
    });
  }

  if (!open) {
    return <button className="btn-brand py-1.5 text-sm" onClick={() => setOpen(true)}>+ Novo contato</button>;
  }

  return (
    <div className="card mt-2 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input" placeholder="Nome *" value={f.name} onChange={(e) => up("name", e.target.value)} />
        <input className="input" placeholder="Cargo" value={f.role_title} onChange={(e) => up("role_title", e.target.value)} />
        <input className="input" placeholder="E-mail" value={f.email} onChange={(e) => up("email", e.target.value)} />
        <input className="input" placeholder="Telefone" value={f.phone} onChange={(e) => up("phone", e.target.value)} />
      </div>
      {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button className="btn-brand py-1.5 text-sm" onClick={salvar} disabled={pending || !f.name.trim()}>
          {pending ? "Salvando…" : "Salvar contato"}
        </button>
        <button className="text-sm text-subtle hover:text-ink" onClick={() => setOpen(false)}>cancelar</button>
      </div>
    </div>
  );
}
