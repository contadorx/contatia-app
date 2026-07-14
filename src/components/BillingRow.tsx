"use client";

import { useState, useTransition } from "react";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { setTenantPlan } from "@/app/dashboard/superadmin/cobranca/actions";

type Plan = { id: string; name: string; price_monthly: number };

export default function BillingRow({
  tenant,
  plans,
}: {
  tenant: { id: string; plan_id: string | null; subscription_status: string; mrr: number; asaas_customer_id: string | null; asaas_subscription_id: string | null };
  plans: Plan[];
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    plan_id: tenant.plan_id || "",
    subscription_status: tenant.subscription_status,
    mrr: String(tenant.mrr || ""),
    asaas_customer_id: tenant.asaas_customer_id || "",
    asaas_subscription_id: tenant.asaas_subscription_id || "",
  });
  const [pending, start] = useTransition();
  const up = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const planOpts: SmartOption[] = plans.map((p) => ({ value: p.id, label: `${p.name} · R$${p.price_monthly}` }));
  const statusOpts: SmartOption[] = [
    { value: "trial", label: "Trial" },
    { value: "active", label: "Ativo" },
    { value: "past_due", label: "Vencido" },
    { value: "canceled", label: "Cancelado" },
  ];

  function save() {
    start(async () => {
      await setTenantPlan({
        tenant_id: tenant.id,
        plan_id: f.plan_id,
        subscription_status: f.subscription_status,
        mrr: Number(f.mrr),
        asaas_customer_id: f.asaas_customer_id,
        asaas_subscription_id: f.asaas_subscription_id,
      });
      setOpen(false);
    });
  }

  if (!open) return <button className="text-xs text-brand-dark hover:underline" onClick={() => setOpen(true)}>editar</button>;

  return (
    <div className="mt-2 rounded-lg border border-line bg-muted p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">Plano
          <SmartSelect className="mt-1 py-1 text-xs" placeholder="— sem plano" clearable options={planOpts} value={f.plan_id} onValueChange={(v) => up("plan_id", v)} />
        </label>
        <label className="text-xs">Status
          <SmartSelect className="mt-1 py-1 text-xs" options={statusOpts} value={f.subscription_status} onValueChange={(v) => up("subscription_status", v)} />
        </label>
        <label className="text-xs">MRR (R$)
          <input className="input mt-1 py-1 text-xs" type="number" value={f.mrr} onChange={(e) => up("mrr", e.target.value)} />
        </label>
        <label className="text-xs">Asaas customer id
          <input className="input mt-1 py-1 text-xs" value={f.asaas_customer_id} onChange={(e) => up("asaas_customer_id", e.target.value)} placeholder="cus_..." />
        </label>
        <label className="text-xs sm:col-span-2">Asaas subscription id
          <input className="input mt-1 py-1 text-xs" value={f.asaas_subscription_id} onChange={(e) => up("asaas_subscription_id", e.target.value)} placeholder="sub_..." />
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <button className="btn-brand py-1 text-xs" onClick={save} disabled={pending}>{pending ? "..." : "Salvar"}</button>
        <button className="btn-ghost py-1 text-xs" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}
