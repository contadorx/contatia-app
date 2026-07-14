"use client";

import { useState, useTransition } from "react";
import { updateContact } from "@/app/dashboard/contatos/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

const STATUS_OPTS: SmartOption[] = [
  { value: "novo", label: "Novo" },
  { value: "ativo", label: "Ativo" },
  { value: "qualificado", label: "Qualificado" },
  { value: "descartado", label: "Descartado" },
];

type C = { id: string; name: string; email?: string | null; phone?: string | null; company?: string | null; company_domain?: string | null; role_title?: string | null; cnpj?: string | null; status?: string | null };

export default function EditContactButton({ contact }: { contact: C }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: contact.name || "",
    email: contact.email || "",
    phone: contact.phone || "",
    company: contact.company || "",
    company_domain: contact.company_domain || "",
    role_title: contact.role_title || "",
    cnpj: contact.cnpj || "",
    status: contact.status || "novo",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  if (!open) return <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen(true)}>Editar dados</button>;

  return (
    <div className="mt-3 w-full rounded-xl border border-line bg-muted p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Nome *</label><input className="input mt-1" value={f.name} onChange={(e) => up("name", e.target.value)} /></div>
        <div><label className="label">Cargo</label><input className="input mt-1" value={f.role_title} onChange={(e) => up("role_title", e.target.value)} placeholder="Sócio, Diretor…" /></div>
        <div><label className="label">E-mail</label><input className="input mt-1" value={f.email} onChange={(e) => up("email", e.target.value)} /></div>
        <div><label className="label">Telefone</label><input className="input mt-1" value={f.phone} onChange={(e) => up("phone", e.target.value)} /></div>
        <div><label className="label">Empresa (texto livre)</label><input className="input mt-1" value={f.company} onChange={(e) => up("company", e.target.value)} /></div>
        <div>
          <label className="label">Site / domínio da empresa</label>
          <input className="input mt-1" value={f.company_domain} onChange={(e) => up("company_domain", e.target.value)} placeholder="empresa.com.br" />
          <p className="mt-1 text-xs text-subtle">Permite procurar o e-mail do decisor.</p>
        </div>
        <div><label className="label">CNPJ</label><input className="input mt-1" value={f.cnpj} onChange={(e) => up("cnpj", e.target.value)} /></div>
        <div>
          <label className="label">Situação</label>
          <SmartSelect
            className="mt-1"
            options={STATUS_OPTS}
            value={f.status}
            onValueChange={(v) => up("status", v)}
          />
        </div>
      </div>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <div className="mt-3 flex gap-2">
        <button
          className="btn-brand py-1.5 text-sm"
          disabled={pending}
          onClick={() => start(async () => {
            const res = (await updateContact(contact.id, f)) as { ok?: boolean; error?: string };
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
