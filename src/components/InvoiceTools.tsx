"use client";

import { useState, useTransition } from "react";
import { createInvoice, sendInvoiceEmail, setInvoiceStatus } from "@/app/dashboard/superadmin/cobranca/invoice-actions";

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const ST: Record<string, { l: string; c: string }> = {
  pending: { l: "Pendente", c: "bg-warn/10 text-warn" },
  paid: { l: "Paga", c: "bg-signal/10 text-signal" },
  overdue: { l: "Vencida", c: "bg-danger/10 text-danger" },
  canceled: { l: "Cancelada", c: "bg-muted text-subtle" },
};

type Tenant = { id: string; name: string };
type Invoice = {
  id: string; amount: number; description: string | null; due_date: string | null; status: string;
  payment_link: string | null; sent_at: string | null; tenant_id: string; tenants?: { name: string | null };
};

export function InvoiceForm({ tenants }: { tenants: Tenant[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ tenant_id: "", amount: "", description: "Assinatura Contatia", due_date: "", payment_link: "", asaas_payment_id: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  if (!open) return <button className="btn-brand py-1.5 text-sm" onClick={() => setOpen(true)}>+ Nova fatura</button>;

  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Workspace *</label>
          <select className="input mt-1" value={f.tenant_id} onChange={(e) => up("tenant_id", e.target.value)}>
            <option value="">Escolha…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div><label className="label">Valor (R$) *</label><input className="input mt-1" type="number" value={f.amount} onChange={(e) => up("amount", e.target.value)} placeholder="179" /></div>
        <div><label className="label">Descrição</label><input className="input mt-1" value={f.description} onChange={(e) => up("description", e.target.value)} /></div>
        <div><label className="label">Vencimento</label><input className="input mt-1" type="date" value={f.due_date} onChange={(e) => up("due_date", e.target.value)} /></div>
        <div className="sm:col-span-2">
          <label className="label">Link de pagamento Asaas *</label>
          <input className="input mt-1" value={f.payment_link} onChange={(e) => up("payment_link", e.target.value)} placeholder="https://www.asaas.com/c/..." />
          <p className="mt-1 text-xs text-subtle">Crie o link no Asaas (cobrança avulsa) e cole aqui. A Contatia envia a fatura por e-mail e controla o pagamento — sem pagar a comunicação do Asaas.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label">ID da cobrança Asaas (opcional, casa o webhook)</label>
          <input className="input mt-1" value={f.asaas_payment_id} onChange={(e) => up("asaas_payment_id", e.target.value)} placeholder="pay_..." />
        </div>
      </div>
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <button className="btn-brand" disabled={pending} onClick={() => start(async () => {
          const res = (await createInvoice({ ...f, amount: Number(f.amount) })) as { ok?: boolean; error?: string };
          if (res?.error) setMsg(res.error);
          else { setF({ tenant_id: "", amount: "", description: "Assinatura Contatia", due_date: "", payment_link: "", asaas_payment_id: "" }); setOpen(false); }
        })}>{pending ? "Salvando..." : "Criar fatura"}</button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}

export function InvoiceRow({ inv }: { inv: Invoice }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const st = ST[inv.status] || ST.pending;

  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-4 py-3 font-medium">{inv.tenants?.name || "—"}<span className="block text-xs text-subtle">{inv.description}</span></td>
      <td className="px-4 py-3">{brl(Number(inv.amount))}</td>
      <td className="px-4 py-3 text-xs text-subtle">{inv.due_date ? new Date(inv.due_date).toLocaleDateString("pt-BR") : "—"}</td>
      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.c}`}>{st.l}</span></td>
      <td className="px-4 py-3 text-xs text-subtle">{inv.sent_at ? `enviada ${new Date(inv.sent_at).toLocaleDateString("pt-BR")}` : "não enviada"}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {inv.status !== "paid" && inv.status !== "canceled" && (
            <button className="font-semibold text-brand-dark hover:underline" disabled={pending}
              onClick={() => start(async () => { const r = (await sendInvoiceEmail(inv.id, inv.sent_at ? "lembrete" : "fatura")) as any; setMsg(r?.error || (inv.sent_at ? "✓ lembrete enviado" : "✓ fatura enviada")); })}>
              {inv.sent_at ? "Reenviar lembrete" : "Enviar fatura"}
            </button>
          )}
          {inv.status !== "paid" && (
            <button className="text-subtle hover:text-signal" disabled={pending} onClick={() => start(async () => void (await setInvoiceStatus(inv.id, "paid")))}>marcar paga</button>
          )}
          {inv.status !== "canceled" && inv.status !== "paid" && (
            <button className="text-subtle hover:text-danger" disabled={pending} onClick={() => start(async () => void (await setInvoiceStatus(inv.id, "canceled")))}>cancelar</button>
          )}
        </div>
        {msg && <p className={`mt-1 text-xs ${msg.startsWith("✓") ? "text-signal" : "text-danger"}`}>{msg}</p>}
      </td>
    </tr>
  );
}
