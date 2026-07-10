import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import BillingRow from "@/components/BillingRow";

export const dynamic = "force-dynamic";

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const STATUS: Record<string, { l: string; c: string }> = {
  trial: { l: "Trial", c: "bg-brand-soft text-brand-dark" },
  active: { l: "Ativo", c: "bg-signal/10 text-signal" },
  past_due: { l: "Vencido", c: "bg-danger/10 text-danger" },
  canceled: { l: "Cancelado", c: "bg-muted text-subtle" },
};

export default async function Cobranca() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  if (!(me as any)?.is_superadmin) {
    return <div className="card mx-auto max-w-lg p-8 text-center"><p className="font-display text-lg font-bold">Acesso restrito</p></div>;
  }

  const admin = createAdminClient();
  const db = admin || supabase;

  const [{ data: tenants }, { data: plans }] = await Promise.all([
    db.from("tenants").select("id, name, legal_name, plan_id, subscription_status, mrr, current_period_end, asaas_customer_id, asaas_subscription_id, platform_plans(name)").order("created_at", { ascending: false }),
    db.from("platform_plans").select("id, name, price_monthly").eq("is_active", true).order("sort", { ascending: true }),
  ]);

  const tList = (tenants as any[]) || [];
  const pList = (plans as any[]) || [];

  const today = new Date().toISOString().slice(0, 10);
  const rows = tList.map((t) => {
    const overdue = t.subscription_status === "past_due" || (t.current_period_end && t.current_period_end < today && t.subscription_status === "active");
    let daysOverdue = 0;
    if (t.current_period_end && t.current_period_end < today) {
      daysOverdue = Math.floor((Date.now() - new Date(t.current_period_end).getTime()) / 86400000);
    }
    return { ...t, name: t.name || t.legal_name || "(sem nome)", planName: t.platform_plans?.name || "—", overdue, daysOverdue };
  });

  const activeMrr = rows.filter((r) => r.subscription_status === "active").reduce((s, r) => s + Number(r.mrr || 0), 0);
  const overdueList = rows.filter((r) => r.overdue);
  const trialCount = rows.filter((r) => r.subscription_status === "trial").length;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-subtle">
        <Link href="/dashboard/superadmin" className="hover:text-ink">Plataforma</Link>
        <span>/</span>
        <span className="text-ink">Cobrança</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-bold">Cobrança & assinaturas</h1>
      <p className="mt-1 text-sm text-subtle">Planos, MRR real e régua de vencidos. O webhook do Asaas atualiza o status sozinho.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <div className="card p-5"><p className="text-xs text-subtle">MRR ativo</p><p className="mt-1 font-display text-2xl font-bold text-signal">{brl(activeMrr)}</p></div>
        <div className="card p-5"><p className="text-xs text-subtle">Assinantes ativos</p><p className="mt-1 font-display text-2xl font-bold">{rows.filter((r) => r.subscription_status === "active").length}</p></div>
        <div className="card p-5"><p className="text-xs text-subtle">Em trial</p><p className="mt-1 font-display text-2xl font-bold">{trialCount}</p></div>
        <div className="card p-5"><p className="text-xs text-subtle">Vencidos</p><p className="mt-1 font-display text-2xl font-bold text-danger">{overdueList.length}</p></div>
      </div>

      {/* Régua de cobrança */}
      {overdueList.length > 0 && (
        <div className="card mt-6 border-danger/30 bg-danger/5 p-5">
          <p className="text-sm font-semibold text-danger">Régua de cobrança — {overdueList.length} vencido(s)</p>
          <div className="mt-3 space-y-2">
            {overdueList.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-danger">{r.daysOverdue > 0 ? `${r.daysOverdue} dia(s) em atraso` : "vencido"} · {brl(Number(r.mrr))}/mês</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-subtle">Ação sugerida: e-mail D+1 (lembrete), D+5 (aviso), D+10 (suspensão). A automação de e-mail entra numa próxima fatia.</p>
        </div>
      )}

      <h2 className="mt-8 mb-3 font-display text-lg font-bold">Assinaturas</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-subtle">
            <tr>
              <th className="px-4 py-3 font-medium">Workspace</th>
              <th className="px-4 py-3 font-medium">Plano</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">MRR</th>
              <th className="px-4 py-3 font-medium">Vence</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = STATUS[r.subscription_status] || STATUS.trial;
              return (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 text-subtle">{r.planName}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.c}`}>{st.l}</span></td>
                  <td className="px-4 py-3">{brl(Number(r.mrr))}</td>
                  <td className="px-4 py-3 text-xs text-subtle">{r.current_period_end || "—"}</td>
                  <td className="px-4 py-3">
                    <BillingRow tenant={r} plans={pList} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-subtle">
        Para o Asaas atualizar sozinho: configure o webhook para <b>/api/webhooks/asaas?token=SEU_TOKEN</b> e a env <b>ASAAS_WEBHOOK_TOKEN</b>. Enquanto não integra, dá pra lançar plano/status manualmente em &ldquo;editar&rdquo;.
      </p>
    </div>
  );
}
