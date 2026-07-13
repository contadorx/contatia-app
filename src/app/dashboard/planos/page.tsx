import { UsageLimits } from "@/components/UsageLimits";
import { getUsage } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";
import { PlanPicker } from "@/components/PlanPicker";
import CancelSubscription from "@/components/CancelSubscription";

export const dynamic = "force-dynamic";

const FEATURES: Record<string, string[]> = {
  Essencial: [
    "Cadência de e-mail e WhatsApp (assistido)",
    "Pipeline de vendas completo",
    "1 caixa de e-mail",
    "Agendamento e lembretes de reunião",
    "Propostas com link rastreado",
  ],
  "Individual Pro": [
    "Tudo do Essencial",
    "Radar de CNPJs da Receita",
    "WhatsApp com captura de resposta",
    "Alerta de lead quente + lead scoring",
    "Relatório por passo + teste A/B",
  ],
  Profissional: [
    "Tudo do Individual Pro",
    "Vários usuários (cobrança por assento)",
    "Papéis e níveis de equipe",
    "Dashboard e metas por vendedor",
    "Roteamento round-robin de leads",
    "Múltiplas caixas + rotação de envio",
    "Integrações e webhooks",
  ],
  Performance: [
    "Tudo do Profissional",
    "IA que monta a cadência (contexto + rapport)",
    "Prioridade nos novos recursos de IA",
    "Suporte prioritário",
  ],
};

export default async function Planos() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase.from("profiles").select("tenant_id, role").eq("id", user?.id ?? "").maybeSingle();
  const tenantId = (prof as any)?.tenant_id;
  const isOwner = (prof as any)?.role === "owner";

  const { data: plans } = await supabase
    .from("platform_plans")
    .select("id, name, price_monthly, max_seats, sort, segment")
    .eq("is_active", true)
    .order("sort", { ascending: true });

  const { data: tenant } = await supabase
    .from("tenants")
    .select("plan_id, subscription_status, platform_plans(name)")
    .eq("id", tenantId ?? "")
    .maybeSingle();

  const { count: seats } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId ?? "");

  // faturas do workspace (central de cobranças) — mais recentes primeiro
  const { data: invoices } = await supabase
    .from("platform_invoices")
    .select("id, amount, description, due_date, status, payment_link, paid_at, created_at")
    .eq("tenant_id", tenantId ?? "")
    .order("created_at", { ascending: false })
    .limit(24);

  const status = (tenant as any)?.subscription_status as string | undefined;
  const currentPlanId = (tenant as any)?.plan_id as string | undefined;
  const currentPlanName = (tenant as any)?.platform_plans?.name as string | undefined;

  const statusLabel: Record<string, { t: string; c: string }> = {
    active: { t: "Assinatura ativa", c: "bg-signal/10 text-signal" },
    trialing: { t: "Período de teste", c: "bg-warn/10 text-warn" },
    pending: { t: "Aguardando pagamento", c: "bg-warn/10 text-warn" },
    past_due: { t: "Pagamento em atraso", c: "bg-danger/10 text-danger" },
    canceled: { t: "Cancelada", c: "bg-muted text-subtle" },
  };
  const sl = status ? statusLabel[status] : null;

  const usos = await getUsage();

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Planos e assinatura</h1>
          <p className="mt-1 text-sm text-subtle">Você paga por usuário ativo do workspace. Escolha o plano que cabe no seu momento.</p>
        </div>
        {sl && <span className={`rounded-full px-3 py-1 text-sm font-semibold ${sl.c}`}>{sl.t}{currentPlanName ? ` · ${currentPlanName}` : ""}</span>}
      </div>

      {!isOwner && (
        <div className="mt-4 rounded-lg bg-muted p-3 text-sm text-subtle">Apenas o dono do workspace pode contratar ou trocar de plano.</div>
      )}

      {usos.length > 0 && (
        <div className="mt-6">
          <UsageLimits usos={usos} />
        </div>
      )}

      <div className="mt-6">
        <PlanPicker
          plans={(plans as any[]) || []}
          features={FEATURES}
          seats={Math.max(1, seats ?? 1)}
          currentPlanId={currentPlanId}
          canSubscribe={isOwner}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-subtle">O valor é calculado por usuário ativo ({Math.max(1, seats ?? 1)} hoje) × o preço do plano. A cobrança é mensal via Asaas — você escolhe boleto, Pix ou cartão. Ao adicionar ou remover usuários, o valor se ajusta automaticamente.</p>
        {isOwner && currentPlanId && ["active", "past_due", "pending"].includes(status || "") && <CancelSubscription />}
      </div>

      {/* Central de faturas */}
      <div className="mt-10 border-t border-line pt-8">
        <h2 className="font-display text-lg font-bold">Suas faturas</h2>
        <p className="mt-1 text-sm text-subtle">Histórico de cobranças do workspace. As em aberto têm link de pagamento.</p>

        {(!invoices || invoices.length === 0) ? (
          <div className="card mt-4 p-6 text-center text-sm text-subtle">
            Nenhuma fatura ainda. Quando você assinar um plano, as cobranças aparecem aqui.
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-subtle">
                <tr>
                  <th className="px-4 py-2 font-semibold">Descrição</th>
                  <th className="px-4 py-2 font-semibold">Vencimento</th>
                  <th className="px-4 py-2 font-semibold">Valor</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(invoices as any[]).map((inv) => {
                  const st: Record<string, { t: string; c: string }> = {
                    paid: { t: "Paga", c: "bg-signal/10 text-signal" },
                    pending: { t: "Em aberto", c: "bg-warn/10 text-warn" },
                    overdue: { t: "Vencida", c: "bg-danger/10 text-danger" },
                    canceled: { t: "Cancelada", c: "bg-muted text-subtle" },
                  };
                  const s = st[inv.status] || st.pending;
                  const due = inv.due_date ? new Date(inv.due_date + "T12:00:00").toLocaleDateString("pt-BR") : "—";
                  const val = Number(inv.amount || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                  const openable = inv.payment_link && (inv.status === "pending" || inv.status === "overdue");
                  return (
                    <tr key={inv.id} className="border-t border-line">
                      <td className="px-4 py-3">{inv.description || "Assinatura Contatia"}</td>
                      <td className="px-4 py-3 text-subtle">{due}</td>
                      <td className="px-4 py-3 font-medium">{val}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.c}`}>{s.t}</span></td>
                      <td className="px-4 py-3 text-right">
                        {openable
                          ? <a href={inv.payment_link} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">Pagar →</a>
                          : inv.payment_link
                            ? <a href={inv.payment_link} target="_blank" rel="noreferrer" className="text-subtle hover:underline">Ver</a>
                            : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-subtle">As faturas são geradas e processadas pelo Asaas. O recibo de cada pagamento fica disponível no próprio link.</p>
      </div>
    </div>
  );
}
