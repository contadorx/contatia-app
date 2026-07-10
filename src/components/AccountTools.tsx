"use client";

import { useState, useTransition } from "react";
import { createAccount } from "@/app/dashboard/contas/actions";

export default function AccountTools() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", cnpj: "", uf: "", domain: "", phone: "", website: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function up(k: string, v: string) {
    setF((s) => ({ ...s, [k]: v }));
  }
  function save() {
    setMsg(null);
    start(async () => {
      const res = await createAccount(f);
      if (res?.error) setMsg(res.error);
      else {
        setF({ name: "", cnpj: "", uf: "", domain: "", phone: "", website: "" });
        setOpen(false);
      }
    });
  }

  if (!open)
    return (
      <button className="btn-brand" onClick={() => setOpen(true)}>
        + Empresa
      </button>
    );

  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label">Nome da empresa *</label>
          <input className="input mt-1" value={f.name} onChange={(e) => up("name", e.target.value)} />
        </div>
        <div>
          <label className="label">UF</label>
          <input className="input mt-1" value={f.uf} onChange={(e) => up("uf", e.target.value)} placeholder="SP" />
        </div>
        <div>
          <label className="label">CNPJ</label>
          <input className="input mt-1" value={f.cnpj} onChange={(e) => up("cnpj", e.target.value)} />
        </div>
        <div>
          <label className="label">Domínio</label>
          <input className="input mt-1" value={f.domain} onChange={(e) => up("domain", e.target.value)} placeholder="empresa.com.br" />
        </div>
        <div>
          <label className="label">Telefone</label>
          <input className="input mt-1" value={f.phone} onChange={(e) => up("phone", e.target.value)} />
        </div>
      </div>
      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <button className="btn-brand" onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Salvar"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
