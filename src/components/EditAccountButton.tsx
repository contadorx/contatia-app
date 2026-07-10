"use client";

import { useState, useTransition } from "react";
import { updateAccount } from "@/app/dashboard/contas/actions";

type A = { id: string; name: string; cnpj?: string | null; uf?: string | null; domain?: string | null; phone?: string | null; website?: string | null };

export default function EditAccountButton({ account }: { account: A }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: account.name || "",
    cnpj: account.cnpj || "",
    uf: account.uf || "",
    domain: account.domain || "",
    phone: account.phone || "",
    website: account.website || "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  if (!open) return <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen(true)}>Editar dados</button>;

  return (
    <div className="mt-3 w-full rounded-xl border border-line bg-muted p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Nome *</label><input className="input mt-1" value={f.name} onChange={(e) => up("name", e.target.value)} /></div>
        <div><label className="label">CNPJ</label><input className="input mt-1" value={f.cnpj} onChange={(e) => up("cnpj", e.target.value)} /></div>
        <div><label className="label">UF</label><input className="input mt-1" value={f.uf} onChange={(e) => up("uf", e.target.value)} maxLength={2} placeholder="SP" /></div>
        <div><label className="label">Telefone</label><input className="input mt-1" value={f.phone} onChange={(e) => up("phone", e.target.value)} /></div>
        <div><label className="label">Domínio</label><input className="input mt-1" value={f.domain} onChange={(e) => up("domain", e.target.value)} placeholder="empresa.com.br" /></div>
        <div><label className="label">Website</label><input className="input mt-1" value={f.website} onChange={(e) => up("website", e.target.value)} /></div>
      </div>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <div className="mt-3 flex gap-2">
        <button
          className="btn-brand py-1.5 text-sm"
          disabled={pending}
          onClick={() => start(async () => {
            const res = (await updateAccount(account.id, f)) as { ok?: boolean; error?: string };
            if (res?.error) setMsg(res.error);
            else setOpen(false);
          })}
        >
          {pending ? "Salvando..." : "Salvar"}
        </button>
        <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}
