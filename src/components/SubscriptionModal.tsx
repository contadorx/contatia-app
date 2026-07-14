"use client";

import { useState, useTransition } from "react";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";
import { getSubscription, saveSubscription } from "@/app/dashboard/superadmin/subscription-actions";

type Plan = { id: string; name: string; price_monthly: number };

const STATUS = [
  { v: "trialing", t: "Trial" },
  { v: "active", t: "Ativa" },
  { v: "pending", t: "Aguardando pagamento" },
  { v: "past_due", t: "Em atraso" },
  { v: "canceled", t: "Cancelada" },
];

const CICLOS = [
  { v: "monthly", t: "Mensal" },
  { v: "quarterly", t: "Trimestral" },
  { v: "yearly", t: "Anual" },
];

export function SubscriptionModal({ plans }: { plans: Plan[] }) {
  const [aberto, setAberto] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [dados, setDados] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // exposto no window para o botão da tabela abrir o modal
  if (typeof window !== "undefined") {
    (window as any).__abrirAssinatura = (id: string, n: string) => {
      setTenantId(id); setNome(n); setDados(null); setMsg(null); setAberto(true);
      start(async () => {
        const r = await getSubscription(id);
        if ((r as any).error) setMsg((r as any).error);
        else setDados((r as any).data);
      });
    };
  }

  if (!aberto) return null;

  const d = dados || {};
  const dataInput = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : "");

  function salvar(fd: FormData) {
    if (!tenantId) return;
    setMsg(null);
    start(async () => {
      const r = await saveSubscription(tenantId, fd);
      if ((r as any).error) setMsg((r as any).error);
      else { setAberto(false); window.location.reload(); }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onClick={() => setAberto(false)}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Assinatura — {nome}</h2>
          <button onClick={() => setAberto(false)} className="text-subtle hover:text-ink">✕</button>
        </div>

        {msg && <p className="mb-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{msg}</p>}
        {!dados && !msg && <p className="text-sm text-subtle">Carregando…</p>}

        {dados && (
          <form action={salvar} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="label">Status</label>
                <SmartSelect name="status" className="mt-1" options={STATUS.map((s): SmartOption => ({ value: s.v, label: s.t }))} defaultValue={d.subscription_status || "trialing"} />
              </div>
              <div>
                <label className="label">Plano</label>
                <SmartSelect name="plan_id" className="mt-1" placeholder="— sem plano —" clearable options={plans.map((p): SmartOption => ({ value: p.id, label: p.name }))} defaultValue={d.plan_id || ""} />
              </div>
              <div>
                <label className="label">Valor mensal (R$)</label>
                <input name="mrr" type="number" step="0.01" className="input mt-1" defaultValue={d.mrr ?? ""} />
              </div>
              <div>
                <label className="label">Ciclo</label>
                <SmartSelect name="cycle" className="mt-1" options={CICLOS.map((c): SmartOption => ({ value: c.v, label: c.t }))} defaultValue={d.billing_cycle || "monthly"} />
              </div>
              <div>
                <label className="label">Trial até</label>
                <input name="trial_ends_at" type="date" className="input mt-1" defaultValue={dataInput(d.trial_ends_at)} />
              </div>
              <div>
                <label className="label">Bônus até</label>
                <input name="bonus_until" type="date" className="input mt-1" defaultValue={dataInput(d.bonus_until)} />
                <p className="mt-1 text-xs text-subtle">Cortesia: acesso liberado sem cobrança.</p>
              </div>
              <div>
                <label className="label">Próximo vencimento</label>
                <input name="next_due_date" type="date" className="input mt-1" defaultValue={dataInput(d.next_due_date)} />
              </div>
              <div>
                <label className="label">Parceiro (ref)</label>
                <input name="partner_ref" className="input mt-1" defaultValue={d.partner_ref || ""} placeholder="ex.: PARC-JOAO" />
              </div>
            </div>

            <div>
              <label className="label">Observações internas</label>
              <textarea name="internal_notes" rows={3} className="input mt-1" defaultValue={d.internal_notes || ""} />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_test" defaultChecked={!!d.is_test_account} />
              <span>Conta de teste <span className="text-subtle">(fora das métricas da plataforma)</span></span>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="label">Asaas — cliente</label>
                <input name="asaas_customer" className="input mt-1" defaultValue={d.asaas_customer_id || ""} placeholder="cus_000000000000" />
              </div>
              <div>
                <label className="label">Asaas — assinatura</label>
                <input name="asaas_subscription" className="input mt-1" defaultValue={d.asaas_subscription_id || ""} placeholder="sub_000000000000" />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <button type="button" className="btn-ghost" onClick={() => setAberto(false)}>Cancelar</button>
              <button className="btn-brand" disabled={pending}>{pending ? "Salvando…" : "Salvar assinatura"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Botão que abre o modal (usado na tabela de workspaces). */
export function SubscriptionButton({ tenantId, name }: { tenantId: string; name: string }) {
  return (
    <button
      onClick={() => (window as any).__abrirAssinatura?.(tenantId, name)}
      className="rounded-lg border border-line px-3 py-1 text-xs font-semibold text-ink hover:border-brand hover:text-brand"
    >
      Assinatura
    </button>
  );
}
