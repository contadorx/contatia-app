import { createClient } from "@/lib/supabase/server";
import { HOT_THRESHOLD } from "@/lib/scoring";
import GoalPanel from "@/components/GoalPanel";

export const dynamic = "force-dynamic";

const brl = (v: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default async function Metricas() {
  const supabase = createClient();
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceISO = since.toISOString();

  // período corrente (YYYY-MM) e início do mês
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: stages }, { data: opps }, { data: events }, { data: meetings }, hot, { data: goal }, { data: monthEvents }, { data: monthWon }] =
    await Promise.all([
      supabase.from("pipeline_stages").select("id, name, position, is_won, is_lost").order("position", { ascending: true }),
      supabase.from("opportunities").select("stage_id, status, value_mrr"),
      supabase.from("events").select("type, created_at").gte("created_at", sinceISO),
      supabase.from("meetings").select("status"),
      supabase.from("contacts").select("id", { count: "exact", head: true }).gte("score", HOT_THRESHOLD),
      supabase.from("goals").select("mrr_target, touch_target").eq("user_id", user?.id ?? "").eq("period", period).maybeSingle(),
      supabase.from("events").select("type").in("type", ["task_done", "email_sent"]).gte("created_at", monthStart),
      supabase.from("opportunities").select("value_mrr").eq("status", "won").gte("updated_at", monthStart),
    ]);

  const stageList = (stages as any[]) || [];
  const oppList = (opps as any[]) || [];
  const evs = (events as any[]) || [];
  const mtgs = (meetings as any[]) || [];

  // Pipeline / ganho
  const openOpps = oppList.filter((o) => o.status === "open");
  const openValue = openOpps.reduce((s, o) => s + Number(o.value_mrr || 0), 0);
  const won = oppList.filter((o) => o.status === "won");
  const lost = oppList.filter((o) => o.status === "lost");
  const wonValue = won.reduce((s, o) => s + Number(o.value_mrr || 0), 0);
  const closed = won.length + lost.length;
  const winRate = closed > 0 ? Math.round((won.length / closed) * 100) : null;

  // Funil por estágio (oportunidades abertas)
  const funnel = stageList
    .filter((s) => !s.is_won && !s.is_lost)
    .map((s) => {
      const inStage = openOpps.filter((o) => o.stage_id === s.id);
      return { name: s.name, count: inStage.length, value: inStage.reduce((a, o) => a + Number(o.value_mrr || 0), 0) };
    });
  const maxCount = Math.max(1, ...funnel.map((f) => f.count));

  // Atividade (30 dias)
  const countType = (t: string) => evs.filter((e) => e.type === t).length;
  const emailsSent = countType("email_sent");
  const touchesDone = countType("task_done") + emailsSent;
  const replies = countType("replied");

  // Reuniões
  const realizadas = mtgs.filter((m) => m.status === "realizada").length;
  const noShows = mtgs.filter((m) => m.status === "no_show").length;
  const noShowBase = realizadas + noShows;
  const noShowRate = noShowBase > 0 ? Math.round((noShows / noShowBase) * 100) : null;

  const cards = [
    { label: "Pipeline aberto", value: brl(openValue), sub: `${openOpps.length} negócios` },
    { label: "Ganho (MRR)", value: brl(wonValue), sub: `${won.length} fechados` },
    { label: "Taxa de ganho", value: winRate === null ? "—" : `${winRate}%`, sub: `${won.length}/${closed} fechados` },
    { label: "Leads quentes", value: String(hot.count ?? 0), sub: `score ≥ ${HOT_THRESHOLD}`, hot: true },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Métricas</h1>
      <p className="mt-1 text-sm text-subtle">A saúde do funil e a atividade da sua operação de vendas.</p>

      <div className="mt-6">
        <GoalPanel
          period={period}
          mrrTarget={Number((goal as any)?.mrr_target) || 0}
          touchTarget={Number((goal as any)?.touch_target) || 0}
          wonMrr={((monthWon as any[]) || []).reduce((s, o) => s + Number(o.value_mrr || 0), 0)}
          touchesDone={((monthEvents as any[]) || []).length}
        />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <span className="label">{c.label}</span>
            <p className={`mt-2 font-display text-2xl font-bold ${c.hot ? "text-warn" : ""}`}>{c.value}</p>
            <p className="mt-1 text-xs text-subtle">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Funil */}
        <div className="card p-5">
          <h2 className="font-display text-lg font-bold">Funil (negócios abertos)</h2>
          <div className="mt-4 space-y-3">
            {funnel.map((f) => (
              <div key={f.name}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{f.name}</span>
                  <span className="text-subtle">
                    {f.count} · {brl(f.value)}/mês
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${(f.count / maxCount) * 100}%` }} />
                </div>
              </div>
            ))}
            {!funnel.length && <p className="text-sm text-subtle">Sem estágios abertos.</p>}
          </div>
        </div>

        {/* Atividade */}
        <div className="card p-5">
          <h2 className="font-display text-lg font-bold">Atividade (últimos 30 dias)</h2>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Metric label="Toques executados" value={touchesDone} />
            <Metric label="E-mails enviados" value={emailsSent} />
            <Metric label="Respostas" value={replies} />
            <Metric label="Reuniões realizadas" value={realizadas} />
          </div>
          <div className="mt-4 rounded-xl bg-muted p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Taxa de no-show</span>
              <span className={`font-bold ${noShowRate !== null && noShowRate > 30 ? "text-danger" : "text-ink"}`}>
                {noShowRate === null ? "—" : `${noShowRate}%`}
              </span>
            </div>
            <p className="mt-1 text-xs text-subtle">{noShows} no-shows em {noShowBase} reuniões concluídas</p>
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs text-subtle">
        Dados deste workspace. Números pequenos no começo são normais — as métricas ganham sentido conforme a operação roda.
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-display text-2xl font-bold">{value}</p>
      <p className="text-xs text-subtle">{label}</p>
    </div>
  );
}
