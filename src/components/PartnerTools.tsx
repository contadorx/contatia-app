"use client";

import { useState, useTransition } from "react";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { createPartner, togglePartner, recordReferral, setReferralStatus } from "@/app/dashboard/superadmin/parceiros/actions";

export function PartnerForm() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", ref_code: "", commission_rate: "20", pix_key: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  function save() {
    setMsg(null);
    start(async () => {
      const res = await createPartner({
        name: f.name,
        email: f.email,
        ref_code: f.ref_code,
        commission_rate: Number(f.commission_rate),
        pix_key: f.pix_key,
      });
      if (res?.error) setMsg(res.error);
      else { setF({ name: "", email: "", ref_code: "", commission_rate: "20", pix_key: "" }); setOpen(false); }
    });
  }

  if (!open) return <button className="btn-brand" onClick={() => setOpen(true)}>+ Parceiro</button>;

  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className="label">Nome *</label><input className="input mt-1" value={f.name} onChange={(e) => up("name", e.target.value)} placeholder="Nome do parceiro" /></div>
        <div><label className="label">E-mail</label><input className="input mt-1" value={f.email} onChange={(e) => up("email", e.target.value)} placeholder="email@parceiro.com" /></div>
        <div><label className="label">Código ?ref= (opcional)</label><input className="input mt-1" value={f.ref_code} onChange={(e) => up("ref_code", e.target.value)} placeholder="auto pelo nome" /></div>
        <div><label className="label">Comissão %</label><input className="input mt-1" type="number" value={f.commission_rate} onChange={(e) => up("commission_rate", e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Chave PIX (pagamento)</label><input className="input mt-1" value={f.pix_key} onChange={(e) => up("pix_key", e.target.value)} placeholder="CPF/CNPJ/e-mail/telefone" /></div>
      </div>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <button className="btn-brand" onClick={save} disabled={pending}>{pending ? "Salvando..." : "Salvar parceiro"}</button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}

export function PartnerToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-signal/10 text-signal" : "bg-muted text-subtle"}`}
      disabled={pending}
      onClick={() => start(async () => void (await togglePartner(id, !active)))}
    >
      {active ? "Ativo" : "Inativo"}
    </button>
  );
}

export function ReferralForm({ partners, tenants }: { partners: { id: string; name: string }[]; tenants: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ partner_id: "", tenant_id: "", label: "", mrr: "", status: "active" });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  function save() {
    setMsg(null);
    start(async () => {
      const res = await recordReferral({ partner_id: f.partner_id, tenant_id: f.tenant_id || undefined, label: f.label, mrr: Number(f.mrr), status: f.status });
      if (res?.error) setMsg(res.error);
      else { setF({ partner_id: "", tenant_id: "", label: "", mrr: "", status: "active" }); setOpen(false); }
    });
  }

  if (!open) return <button className="btn-ghost" onClick={() => setOpen(true)}>+ Registrar indicação</button>;

  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Parceiro *</label>
          <SmartSelect className="mt-1" placeholder="Escolha…" options={partners.map((p): SmartOption => ({ value: p.id, label: p.name }))} value={f.partner_id} onValueChange={(v) => up("partner_id", v)} />
        </div>
        <div>
          <label className="label">Workspace indicado</label>
          <SmartSelect className="mt-1" placeholder="— (ainda não é cliente)" clearable options={tenants.map((t): SmartOption => ({ value: t.id, label: t.name }))} value={f.tenant_id} onValueChange={(v) => up("tenant_id", v)} />
        </div>
        <div><label className="label">MRR do indicado (R$)</label><input className="input mt-1" type="number" value={f.mrr} onChange={(e) => up("mrr", e.target.value)} placeholder="ex.: 179" /></div>
        <div className="sm:col-span-2"><label className="label">Rótulo (se ainda não virou workspace)</label><input className="input mt-1" value={f.label} onChange={(e) => up("label", e.target.value)} placeholder="Escritório Fulano" /></div>
        <div>
          <label className="label">Status</label>
          <SmartSelect className="mt-1" options={[
            { value: "active", label: "Ativo" },
            { value: "pending", label: "Pendente" },
            { value: "churned", label: "Cancelado" },
          ]} value={f.status} onValueChange={(v) => up("status", v)} />
        </div>
      </div>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <button className="btn-brand" onClick={save} disabled={pending}>{pending ? "Salvando..." : "Registrar"}</button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}

export function ReferralStatus({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const map: Record<string, string> = { active: "bg-signal/10 text-signal", pending: "bg-warn/10 text-warn", churned: "bg-muted text-subtle" };
  return (
    <SmartSelect
      className={`rounded-full border-0 px-2 py-1 text-xs font-semibold ${map[status] || ""}`}
      options={[
        { value: "active", label: "Ativo" },
        { value: "pending", label: "Pendente" },
        { value: "churned", label: "Cancelado" },
      ]}
      value={status}
      disabled={pending}
      onValueChange={(v) => start(async () => void (await setReferralStatus(id, v)))}
    />
  );
}
