import { createClient } from "@/lib/supabase/server";
import { PlanPicker } from "@/components/PlanPicker";

export const dynamic = "force-dynamic";

const FEATURES: Record<string, string[]> = {
  Essencial: [
    "Cadência de e-mail e WhatsApp",
    "Pipeline de vendas completo",
    "1 caixa de e-mail conectada",
    "Agendamento e lembretes de reunião",
  ],
  Profissional: [
    "Tudo do Essencial",
    "Radar de CNPJs da Receita",
    "IA que monta a cadência",
    "Alerta de lead quente em tempo real",
    "WhatsApp com captura de resposta",
    "Relatório por passo + teste A/B",
  ],
  Time: [
    "Tudo do Profissional",
    "Múltiplas caixas + rotação de envio",
    "Dashboard por vendedor",
    "Roteamento e round-robin de leads",
    "Integrações e webhooks",
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
    .select("id, name, price_monthly, max_seats, sort")
    .eq("is_active", true)
    .order("sort", { ascending: true });

  const { data: tenant } = await supabase
    .from("tenants")
    .select("plan_id, subscription_status, platform_plans(name)")
    .eq("id", tenantId ?? "")
    .maybeSingle();

  const { count: seats } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId ?? "");

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

      <div className="mt-6">
        <PlanPicker
          plans={(plans as any[]) || []}
          features={FEATURES}
          seats={Math.max(1, seats ?? 1)}
          currentPlanId={currentPlanId}
          canSubscribe={isOwner}
        />
      </div>

      <p className="mt-6 text-xs text-subtle">O valor é calculado por usuário ativo ({Math.max(1, seats ?? 1)} hoje) × o preço do plano. A cobrança é mensal via Asaas — você escolhe boleto, Pix ou cartão. Cancele quando quiser.</p>
    </div>
  );
}
