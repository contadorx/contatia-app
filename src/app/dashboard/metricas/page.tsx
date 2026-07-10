import { createClient } from "@/lib/supabase/server";
import { HOT_THRESHOLD } from "@/lib/scoring";
import GoalPanel from "@/components/GoalPanel";

export const dynamic = "force-dynamic";

const brl = (v: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default async function Metricas({ searchParams }: { searchParams: { vendedor?: string; dias?: string } }) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role, team_role").eq("id", user?.id ?? "").maybeSingle();
  const isManager = (me as any)?.role === "owner" || ["admin", "gestor"].includes((me as any)?.team_role);

  // filtros
  const dias = Number(searchParams.dias) || 30;
  // gestor pode filtrar por vendedor; vendedor comum vê só o próprio
  const vendedor = isManager ? (searchParams.vendedor || "") : (user?.id ?? "");

  const since = new Date();
  since.setDate(since.getDate() - dias);
  const sinceISO = since.toISOString();

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // membros para o seletor (só gestor)
  const { data: members } = isManager
    ? await supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name", { ascending: true })
    : { data: [] as any[] };

  // queries — aplicam filtro de vendedor quando houver
  let oppsQ = supabase.from("opportunities").select("stage_id, status, value_mrr, owner_id, created_at, updated_at, loss_reason");
  if (vendedor) oppsQ = oppsQ.eq("owner_id", vendedor);

  let evsQ = supabase.from("events").select("type, created_at, contact_id").gte("created_at", sinceISO);
  // eventos por vendedor = via contatos atribuídos (filtramos depois em memória se preciso)

  const [{ data: stages }, { data: opps }, { data: events }, { data: meetings }, { data: goal }, { data: monthWon }, { data: assignedContacts }] =
    await Promise.all([
      supabase.from("pipeline_stages").select("id, name, position, is_won, is_lost").order("position", { ascending: true }),
      oppsQ,
      evsQ,
      supabase.from("meetings").select("status, owner_id"),
      supabase.from("goals").select("mrr_target, touch_target").eq("user_id", vendedor || user?.id || "").eq("period", period).maybeSingle(),
      (vendedor
        ? supabase.from("opportunities").select("value_mrr").eq("status", "won").eq("owner_id", vendedor).gte("updated_at", monthStart)
        : supabase.from("opportunities").select("value_mrr").eq("status", "won").gte("updated_at", monthStart)),
      vendedor ? supabase.from("contacts").select("id").eq("assigned_to", vendedor) : Promise.resolve({ data: null as any }),
    ]);

  const stageList = (stages as any[]) || [];
  const oppList = (opps as any[]) || [];
  let evs = (events as any[]) || [];
  let mtgs = (meetings as any[]) || [];

  // se filtrando por vendedor: eventos só dos contatos dele; reuniões só dele
  if (vendedor) {
    const ids = new Set(((assignedContacts as any[]) || []).map((c) => c.id));
    evs = evs.filter((e) => e.contact_id && ids.has(e.contact_id));
    mtgs = mtgs.filter((m) => m.owner_id === vendedor);
  }

  const openOpps = oppList.filter((o) => o.status === "open");
  const openValue = openOpps.reduce((s, o) => s + Number(o.value_mrr || 0), 0);
  const won = oppList.filter((o) => o.status === "won");
  const lost = oppList.filter((o) => o.status === "lost");
  const wonValue = won.reduce((s, o) => s + Number(o.value_mrr || 0), 0);
  const closed = won.length + lost.length;
  const winRate = closed > 0 ? Math.round((won.length / closed) * 100) : null;

  // tempo médio de fechamento (dias entre created_at e updated_at dos ganhos)
  const cycleDays = won
    .map((o) => o.created_at && o.updated_at ? (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) / 86400000 : null)
    .filter((d): d is number => d !== null && d >= 0);
  const avgCycle = cycleDays.length ? Math.round(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length) : null;

  // ticket médio dos ganhos
  const avgTicket = won.length ? wonValue / won.length : null;

  // motivos de perda (loss_reason)
  const lossReasons: Record<string, number> = {};
  for (const o of lost) {
    const r = (o.loss_reason || "Não informado").trim() || "Não informado";
    lossReasons[r] = (lossReasons[r] || 0) + 1;
  }
  const lossTop = Object.entries(lossReasons).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // conversão por estágio: quantos ainda estão vs. já passaram (aprox. pelo funil aberto)
  const funnelConv = stageList
    .filter((s) => !s.is_won && !s.is_lost)
    .map((s, i, arr) => {
      const here = openOpps.filter((o) => o.stage_id === s.id).length;
      const next = i < arr.length - 1 ? openOpps.filter((o) => o.stage_id === arr[i + 1].id).length : 0;
      const conv = here > 0 ? Math.round((next / here) * 100) : null;
      return { name: s.name, here, conv };
    });

  const funnel = stageList
    .filter((s) => !s.is_won && !s.is_lost)
    .map((s) => {
      const inStage = openOpps.filter((o) => o.stage_id === s.id);
      return { name: s.name, count: inStage.length, value: inStage.reduce((a, o) => a + Number(o.value_mrr || 0), 0) };
    });
  const maxCount = Math.max(1, ...funnel.map((f) => f.count));

  const countType = (t: string) => evs.filter((e) => e.type === t).length;
  const emailsSent = countType("email_sent");
  const touchesDone = countType("task_done") + emailsSent;
  const replies = countType("replied");

  const realizadas = mtgs.filter((m) => m.status === "realizada").length;
  const noShows = mtgs.filter((m) => m.status === "no_show").length;
  const noShowBase = realizadas + noShows;
  const noShowRate = noShowBase > 0 ? Math.round((noShows / noShowBase) * 100) : null;

  const hotCount = openOpps.length; // placeholder simples quando filtrado
  const cards = [
    { label: "Pipeline aberto", value: brl(openValue), sub: `${openOpps.length} negócios` },
    { label: "Ganho (MRR)", value: brl(wonValue), sub: `${won.length} fechados` },
    { label: "Taxa de ganho", value: winRate === null ? "—" : `${winRate}%`, sub: `${won.length}/${closed} fechados` },
    { label: "Ticket médio", value: avgTicket === null ? "—" : brl(avgTicket), sub: "por negócio ganho" },
    { label: "Tempo de fechamento", value: avgCycle === null ? "—" : `${avgCycle} dias`, sub: "criação → ganho" },
    { label: "Respostas (período)", value: String(replies), sub: `${dias} dias` },
  ];

  const memberList = (members as any[]) || [];
  const selectedName = vendedor ? (memberList.find((m) => m.id === vendedor)?.full_name || memberList.find((m) => m.id === vendedor)?.email || "vendedor") : "toda a equipe";

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Métricas</h1>
      <p className="mt-1 text-sm text-subtle">A saúde do funil e a atividade da operação{isManager ? " — filtre por vendedor e período." : "."}</p>

      {/* Filtros */}
      <form className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2.5">
        {isManager && (
          <select name="vendedor" defaultValue={vendedor} className="input py-1 text-xs" style={{ width: 190 }}>
            <option value="">Toda a equipe</option>
            {memberList.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
            ))}
          </select>
        )}
        <select name="dias" defaultValue={String(dias)} className="input py-1 text-xs" style={{ width: 140 }}>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
        </select>
        <button className="btn-brand py-1 text-xs" type="submit">Aplicar</button>
        <span className="text-xs text-subtle">Visão: <b className="text-ink">{selectedName}</b></span>
      </form>

      <div className="mt-6">
        <GoalPanel
          period={period}
          mrrTarget={Number((goal as any)?.mrr_target) || 0}
          touchTarget={Number((goal as any)?.touch_target) || 0}
          wonMrr={((monthWon as any[]) || []).reduce((s, o) => s + Number(o.value_mrr || 0), 0)}
          touchesDone={touchesDone}
          targetUserId={isManager && vendedor ? vendedor : undefined}
          targetName={isManager && vendedor ? selectedName : undefined}
        />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <span className="label">{c.label}</span>
            <p className="mt-2 font-display text-2xl font-bold">{c.value}</p>
            <p className="mt-1 text-xs text-subtle">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="font-display text-lg font-bold">Funil (negócios abertos)</h2>
          <div className="mt-4 space-y-3">
            {funnel.map((f) => (
              <div key={f.name}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{f.name}</span>
                  <span className="text-subtle">{f.count} · {brl(f.value)}/mês</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${(f.count / maxCount) * 100}%` }} />
                </div>
              </div>
            ))}
            {!funnel.length && <p className="text-sm text-subtle">Sem estágios abertos.</p>}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-display text-lg font-bold">Atividade ({dias} dias)</h2>
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

      {/* Conversão por estágio + Motivos de perda */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="font-display text-lg font-bold">Conversão por estágio</h2>
          <p className="text-xs text-subtle">% que avança para o próximo estágio (negócios abertos).</p>
          <div className="mt-3 space-y-2">
            {funnelConv.map((f) => (
              <div key={f.name} className="flex items-center justify-between text-sm">
                <span>{f.name} <span className="text-subtle">({f.here})</span></span>
                <span className="font-semibold text-brand-dark">{f.conv === null ? "—" : `${f.conv}%`}</span>
              </div>
            ))}
            {!funnelConv.length && <p className="text-sm text-subtle">Sem estágios abertos.</p>}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-display text-lg font-bold">Motivos de perda</h2>
          <p className="text-xs text-subtle">{lost.length} negócio(s) perdido(s) no recorte.</p>
          <div className="mt-3 space-y-2">
            {lossTop.map(([reason, count]) => (
              <div key={reason} className="flex items-center justify-between text-sm">
                <span>{reason}</span>
                <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">{count}</span>
              </div>
            ))}
            {!lossTop.length && <p className="text-sm text-subtle">Nenhuma perda registrada.</p>}
          </div>
        </div>
      </div>

      {isManager && !vendedor && memberList.length > 1 && (
        <p className="mt-6 text-xs text-subtle">Dica: selecione um vendedor acima para ver o funil, a atividade e as reuniões individuais dele.</p>
      )}
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
