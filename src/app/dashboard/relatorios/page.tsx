import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isManager as isMgr } from "@/lib/permissions";
import { HOT_THRESHOLD } from "@/lib/scoring";
import { UltimoToque, diasSemToque } from "@/lib/lastTouch";
import ReportTabs from "@/components/ReportTabs";
import GoalPanel from "@/components/GoalPanel";
import SmartSelect from "@/components/SmartSelect";
import LogFilterBar from "@/components/LogFilterBar";
import { comoLista } from "@/lib/filtros";
import { ACAO_LABEL, ACOES_DESTRUTIVAS, labelAcao } from "@/lib/actionLog";

export const dynamic = "force-dynamic";

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-subtle">{sub}</p>}
    </div>
  );
}

function Secao({ id, titulo, desc, children }: { id: string; titulo: string; desc: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-4">
      <h2 className="font-display text-xl font-bold">{titulo}</h2>
      <p className="mb-3 mt-0.5 text-sm text-subtle">{desc}</p>
      {children}
    </section>
  );
}

export default async function Relatorios({
  searchParams,
}: {
  searchParams: {
    dias?: string;
    frio?: string;
    vendedor?: string | string[];
    logAcao?: string | string[];
    logUser?: string | string[];
  };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role, team_role").eq("id", user?.id ?? "").maybeSingle();
  const gestor = isMgr((me as any)?.role, (me as any)?.team_role);

  const dias = Number(searchParams.dias) || 30;
  const frio = Number(searchParams.frio) || 30;
  // vendedor segue SINGLE (meta/forecast/ticket são por pessoa); comoLista só protege
  // contra ?vendedor=a&vendedor=b vindo de um link antigo ou colado à mão.
  const vendedor = gestor ? (comoLista(searchParams.vendedor)[0] || "") : (user?.id ?? "");
  // aba Registro: filtros MULTI (várias ações, vários usuários)
  const logAcoes = comoLista(searchParams.logAcao);
  const logUsers = gestor ? comoLista(searchParams.logUser) : [];

  const sinceISO = new Date(Date.now() - dias * 86400000).toISOString();
  const frioISO = new Date(Date.now() - frio * 86400000).toISOString();

  // mês corrente — para a meta (GoalPanel) da Visão geral
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // ---- coleta ----
  const membersP = gestor
    ? supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name", { ascending: true })
    : Promise.resolve({ data: [] as any[] });

  let contactsQ = supabase.from("contacts").select("id, name, company, score, assigned_to, last_activity_at, account_id, email").limit(4000);
  if (vendedor) contactsQ = contactsQ.eq("assigned_to", vendedor);

  let oppsQ = supabase.from("opportunities").select("id, title, value_mrr, stage_id, status, owner_id, created_at, updated_at, account_id, loss_reason, product_id, probability, expected_close, products(name)").limit(4000);
  if (vendedor) oppsQ = oppsQ.eq("owner_id", vendedor);

  let mtgsQ = supabase.from("meetings").select("id, assigned_to, datetime, status, created_at").gte("created_at", sinceISO).limit(4000);
  if (vendedor) mtgsQ = mtgsQ.eq("assigned_to", vendedor);

  const [{ data: members }, { data: contacts }, { data: opps }, { data: stages }, { data: enrollments }, { data: sequences }, { data: meetings }, { data: events }, { data: accounts }, { data: goal }, { data: monthWon }] =
    await Promise.all([
      membersP,
      contactsQ,
      oppsQ,
      supabase.from("pipeline_stages").select("id, name, position, is_won, is_lost").order("position", { ascending: true }),
      supabase.from("enrollments").select("contact_id, status, sequence_id").limit(8000),
      supabase.from("sequences").select("id, name"),
      mtgsQ,
      supabase.from("events").select("type, contact_id, created_at").gte("created_at", sinceISO).in("type", ["task_done", "email_sent", "whatsapp_sent", "replied"]).limit(8000),
      supabase.from("accounts").select("id, name, municipio, uf").limit(4000),
      supabase.from("goals").select("mrr_target, touch_target").eq("user_id", vendedor || user?.id || "").eq("period", period).maybeSingle(),
      (vendedor
        ? supabase.from("opportunities").select("value_mrr").eq("status", "won").eq("owner_id", vendedor).gte("updated_at", monthStart)
        : supabase.from("opportunities").select("value_mrr").eq("status", "won").gte("updated_at", monthStart)),
    ]);

  const cts = (contacts as any[]) || [];
  const oppList = (opps as any[]) || [];
  const stageList = (stages as any[]) || [];
  const enrs = (enrollments as any[]) || [];
  const seqs = (sequences as any[]) || [];
  const mtgs = (meetings as any[]) || [];
  const evs = (events as any[]) || [];
  const accs = (accounts as any[]) || [];

  const memberName = (id: string | null) => {
    if (!id) return "—";
    const m = ((members as any[]) || []).find((x) => x.id === id);
    return m ? (m.full_name || m.email) : (id === user?.id ? "Você" : "—");
  };

  // conjuntos auxiliares
  const contatoOwner = new Map<string, string | null>();
  for (const c of cts) contatoOwner.set(c.id, c.assigned_to || null);
  const emCadenciaAtiva = new Set<string>();
  for (const e of enrs) if (e.status === "active" && e.contact_id) emCadenciaAtiva.add(e.contact_id);

  const stageById = new Map<string, any>();
  for (const s of stageList) stageById.set(s.id, s);

  // ================= 1) CARTEIRA PARADA =================
  const parados = cts
    .filter((c) => {
      const d = diasSemToque(c.last_activity_at);
      const frioo = d === null || d >= frio;
      return frioo && !emCadenciaAtiva.has(c.id); // frio E sem cadência ativa trabalhando
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const paradosPorVend: Record<string, number> = {};
  for (const c of parados) { const k = c.assigned_to || "sem"; paradosPorVend[k] = (paradosPorVend[k] || 0) + 1; }

  // ================= 2) PIPELINE AGING =================
  const abertas = oppList.filter((o) => o.status === "open" && !stageById.get(o.stage_id)?.is_won && !stageById.get(o.stage_id)?.is_lost);
  const aging = abertas
    .map((o) => ({ ...o, dias: diasSemToque(o.updated_at || o.created_at) ?? 0 }))
    .filter((o) => o.dias >= frio)
    .sort((a, b) => b.dias - a.dias);
  const agingValor = aging.reduce((s, o) => s + Number(o.value_mrr || 0), 0);

  // ================= 3) EMPRESAS SEM CONTATO/OPORTUNIDADE =================
  const contatosPorConta: Record<string, number> = {};
  for (const c of cts) if (c.account_id) contatosPorConta[c.account_id] = (contatosPorConta[c.account_id] || 0) + 1;
  const oppsPorConta: Record<string, number> = {};
  for (const o of oppList) if (o.account_id) oppsPorConta[o.account_id] = (oppsPorConta[o.account_id] || 0) + 1;
  const empresasVazias = accs
    .map((a) => ({ ...a, nContatos: contatosPorConta[a.id] || 0, nOpps: oppsPorConta[a.id] || 0 }))
    .filter((a) => a.nContatos === 0 || a.nOpps === 0)
    .sort((a, b) => a.nContatos - b.nContatos || a.nOpps - b.nOpps);

  // ================= 4) LEADS QUENTES SEM AÇÃO =================
  const quentesFrios = cts
    .filter((c) => (c.score ?? 0) >= HOT_THRESHOLD)
    .filter((c) => { const d = diasSemToque(c.last_activity_at); return d === null || d >= frio; })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // ================= 5) PRODUTIVIDADE POR VENDEDOR =================
  // toques/respostas por dono (via contato); reuniões por assigned_to; opps criadas/ganhas por owner
  const prod: Record<string, { toques: number; respostas: number; reunioes: number; criadas: number; ganhas: number }> = {};
  const bump = (id: string | null, k: keyof (typeof prod)[string]) => {
    const key = id || "sem";
    (prod[key] ||= { toques: 0, respostas: 0, reunioes: 0, criadas: 0, ganhas: 0 })[k]++;
  };
  for (const e of evs) {
    const owner = contatoOwner.get(e.contact_id) ?? null;
    if (e.type === "replied") bump(owner, "respostas");
    else bump(owner, "toques"); // task_done, email_sent, whatsapp_sent
  }
  for (const m of mtgs) bump(m.assigned_to || null, "reunioes");
  for (const o of oppList) {
    if (o.created_at && o.created_at >= sinceISO) bump(o.owner_id || null, "criadas");
    if (o.status === "won" && (o.updated_at || "") >= sinceISO) bump(o.owner_id || null, "ganhas");
  }
  const prodLinhas = Object.entries(prod)
    .map(([id, v]) => ({ id, nome: id === "sem" ? "Sem responsável" : memberName(id), ...v }))
    .sort((a, b) => (b.toques + b.respostas + b.reunioes) - (a.toques + a.respostas + a.reunioes));

  // ================= 6) COBERTURA DA BASE =================
  const totalContatos = cts.length;
  const comEmail = cts.filter((c) => c.email).length;
  const emCadencia = cts.filter((c) => emCadenciaAtiva.has(c.id)).length;
  const friosTotal = parados.length;
  const totalEmpresas = accs.length;
  const empresasComOpp = accs.filter((a) => (oppsPorConta[a.id] || 0) > 0).length;
  const empresasComContato = accs.filter((a) => (contatosPorConta[a.id] || 0) > 0).length;

  // ================= 7) DESEMPENHO DE CADÊNCIAS =================
  const cadStats = seqs.map((s) => {
    const doSeq = enrs.filter((e) => e.sequence_id === s.id);
    const total = doSeq.length;
    const ativos = doSeq.filter((e) => e.status === "active").length;
    const respondidos = doSeq.filter((e) => e.status === "replied").length;
    const concluidos = doSeq.filter((e) => e.status === "done").length;
    return { id: s.id, name: s.name, total, ativos, respondidos, concluidos, taxa: pct(respondidos, total) };
  }).sort((a, b) => b.total - a.total);

  // ---- Cliques em links (agregado no BANCO — pronto p/ volume; filtra por vendedor) ----
  const ownerParam = vendedor || null;
  const [{ data: totRows }, { data: topRows }] = await Promise.all([
    supabase.rpc("link_click_totais", { p_since: sinceISO, p_owner: ownerParam }),
    supabase.rpc("link_click_top", { p_owner: ownerParam, p_limit: 15 }),
  ]);
  const tot: any = (Array.isArray(totRows) ? totRows[0] : totRows) || {};
  const rastreados = Number(tot.rastreados || 0);
  const clicadosN = Number(tot.clicados || 0);
  const totalCliques = Number(tot.cliques || 0);
  const cliquesPeriodo = Number(tot.cliques_periodo || 0);
  const taxaClique = pct(clicadosN, rastreados);
  const topLinks = ((topRows as any[]) || []).map((r) => ({ url: r.url, n: Number(r.cliques || 0) }));
  // últimos cliques (limit 30 — barato em qualquer volume), filtrando por dono se houver
  let ultQ = ownerParam
    ? supabase.from("link_clicks").select("id, url, clicks, first_click_at, contacts!inner(name, assigned_to)").gt("clicks", 0).eq("contacts.assigned_to", ownerParam)
    : supabase.from("link_clicks").select("id, url, clicks, first_click_at, contacts(name)").gt("clicks", 0);
  const { data: ultRows } = await ultQ.order("first_click_at", { ascending: false, nullsFirst: false }).limit(30);
  const ultimosCliques = (ultRows as any[]) || [];

  // ===================== VISÃO GERAL (agregada — antiga Métricas) =====================
  // atividade do recorte, escopada ao vendedor quando houver (via contatos dele)
  const viewEvs = vendedor ? evs.filter((e) => e.contact_id && contatoOwner.has(e.contact_id)) : evs;
  const vgCount = (t: string) => viewEvs.filter((e) => e.type === t).length;
  const vgEmails = vgCount("email_sent");
  const vgTouches = vgCount("task_done") + vgEmails;
  const vgReplies = vgCount("replied");

  const vgOpen = oppList.filter((o) => o.status === "open");
  const vgOpenValue = vgOpen.reduce((s, o) => s + Number(o.value_mrr || 0), 0);
  const vgWon = oppList.filter((o) => o.status === "won");
  const vgLost = oppList.filter((o) => o.status === "lost");
  const vgWonValue = vgWon.reduce((s, o) => s + Number(o.value_mrr || 0), 0);
  const vgClosed = vgWon.length + vgLost.length;
  const vgWinRate = vgClosed > 0 ? Math.round((vgWon.length / vgClosed) * 100) : null;
  const vgCycleDays = vgWon
    .map((o) => (o.created_at && o.updated_at ? (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) / 86400000 : null))
    .filter((d): d is number => d !== null && d >= 0);
  const vgAvgCycle = vgCycleDays.length ? Math.round(vgCycleDays.reduce((a, b) => a + b, 0) / vgCycleDays.length) : null;
  const vgAvgTicket = vgWon.length ? vgWonValue / vgWon.length : null;

  const vgLossReasons: Record<string, number> = {};
  for (const o of vgLost) { const r = (o.loss_reason || "Não informado").trim() || "Não informado"; vgLossReasons[r] = (vgLossReasons[r] || 0) + 1; }
  const vgLossTop = Object.entries(vgLossReasons).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const vgRevByProduct: Record<string, number> = {};
  for (const o of vgWon) { const pname = (o as any).products?.name || "Sem produto"; vgRevByProduct[pname] = (vgRevByProduct[pname] || 0) + Number(o.value_mrr || 0); }
  const vgRevProductTop = Object.entries(vgRevByProduct).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const vgFunnel = stageList
    .filter((s) => !s.is_won && !s.is_lost)
    .map((s, i, arr) => {
      const inStage = vgOpen.filter((o) => o.stage_id === s.id);
      const here = inStage.length;
      const next = i < arr.length - 1 ? vgOpen.filter((o) => o.stage_id === arr[i + 1].id).length : null;
      const conv = next !== null && here > 0 ? Math.round((next / here) * 100) : null;
      return { name: s.name, count: here, value: inStage.reduce((a, o) => a + Number(o.value_mrr || 0), 0), conv };
    });
  const vgMaxCount = Math.max(1, ...vgFunnel.map((f) => f.count));

  const vgRealizadas = mtgs.filter((m) => m.status === "realizada").length;
  const vgNoShows = mtgs.filter((m) => m.status === "no_show").length;
  const vgNoShowBase = vgRealizadas + vgNoShows;
  const vgNoShowRate = vgNoShowBase > 0 ? Math.round((vgNoShows / vgNoShowBase) * 100) : null;

  const vgWonMrrMonth = ((monthWon as any[]) || []).reduce((s, o) => s + Number(o.value_mrr || 0), 0);
  const selectedName = vendedor ? memberName(vendedor) : "toda a equipe";

  // ================= FORECAST (previsão de receita recorrente) =================
  // Cada negócio ABERTO é ponderado pela sua probabilidade. Sem probabilidade
  // definida, usamos a IMPLÍCITA do estágio (quanto mais avançado, maior) — assim o
  // forecast já funciona antes de alguém preencher probabilidades.
  const openStages = stageList.filter((s) => !s.is_won && !s.is_lost);
  const stageRank = new Map<string, number>();
  openStages.forEach((s, i) => stageRank.set(s.id, i));
  const impliedProb = (stageId: string | null) => {
    const r = stageId ? stageRank.get(stageId) : undefined;
    if (r == null) return 0.3;
    return (r + 1) / (openStages.length + 1); // 0..1, cresce com o avanço no funil
  };
  const effProb = (o: any) => { const p = Number(o.probability) || 0; return p > 0 ? p / 100 : impliedProb(o.stage_id); };

  const fcWeightedOpen = vgOpen.reduce((s, o) => s + Number(o.value_mrr || 0) * effProb(o), 0);
  const fcMonthWeighted = vgOpen
    .filter((o) => String(o.expected_close || "").slice(0, 7) === period)
    .reduce((s, o) => s + Number(o.value_mrr || 0) * effProb(o), 0);
  const fcMonthTotal = vgWonMrrMonth + fcMonthWeighted;

  const fcByMonth: Record<string, number> = {};
  let fcSemData = 0;
  for (const o of vgOpen) {
    const w = Number(o.value_mrr || 0) * effProb(o);
    const m = String(o.expected_close || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) fcByMonth[m] = (fcByMonth[m] || 0) + w;
    else fcSemData += w;
  }
  const fcMonths = Object.entries(fcByMonth).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 6);
  const fcMax = Math.max(1, ...fcMonths.map((x) => x[1]));
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const mesLabel = (ym: string) => { const [y, m] = ym.split("-"); return `${MES[Number(m) - 1]}/${y.slice(2)}`; };
  const vgCards = [
    { label: "Negócios em aberto", value: brl(vgOpenValue), sub: `${vgOpen.length} negócios` },
    { label: "Receita fechada", value: brl(vgWonValue), sub: `${vgWon.length} fechados no recorte` },
    { label: "Taxa de ganho", value: vgWinRate === null ? "—" : `${vgWinRate}%`, sub: `${vgWon.length}/${vgClosed} fechados` },
  ];

  // filtro (form GET)
  const memberOpts = ((members as any[]) || []);

  // ================= REGISTRO DE AÇÕES (action_log) =================
  // Quem apagou/mexeu em lote, quando e o quê. Recorte de visibilidade: gestor vê o
  // workspace inteiro; quem não é gestor vê só as próprias ações (a RLS libera o
  // workspace, o recorte de papel é feito aqui — igual às outras seções).
  let logQ = supabase
    .from("action_log")
    .select("id, created_at, user_id, user_name, action, entity, qtd, detail, meta")
    .gte("created_at", sinceISO)
    .order("created_at", { ascending: false })
    .limit(300);
  if (!gestor) logQ = logQ.eq("user_id", user?.id ?? "");
  else if (logUsers.length) logQ = logQ.in("user_id", logUsers);
  else if (vendedor) logQ = logQ.eq("user_id", vendedor);
  if (logAcoes.length) logQ = logQ.in("action", logAcoes);
  const { data: logRows } = await logQ;
  const logs = (logRows as any[]) || [];

  const logDestrutivos = logs.filter((l) => ACOES_DESTRUTIVAS.includes(l.action));
  const logRegistrosApagados = logDestrutivos.reduce((s, l) => s + (Number(l.qtd) || 0), 0);
  // opções do filtro de ação: as conhecidas + qualquer ação nova que já apareça no log
  const acoesNoLog = Array.from(new Set(logs.map((l) => l.action as string)));
  const acaoOpts = Array.from(new Set([...Object.keys(ACAO_LABEL), ...acoesNoLog])).map((a) => ({
    value: a,
    label: labelAcao(a),
  }));
  // resumo "quem mais apagou" — o único número que um gestor olha primeiro
  const logPorPessoa = Object.entries(
    logDestrutivos.reduce((acc: Record<string, number>, l) => {
      const nome = l.user_name || memberName(l.user_id) || "—";
      acc[nome] = (acc[nome] || 0) + (Number(l.qtd) || 0);
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Resumo dos itens atingidos, quando o log guardou a foto (meta.itens).
  const resumoItens = (l: any): string => {
    const itens = Array.isArray(l?.meta?.itens) ? l.meta.itens : [];
    if (!itens.length) return "—";
    const nomes = itens
      .map((i: any) => i.titulo || i.nome || i.contato || i.empresa || null)
      .filter(Boolean)
      .slice(0, 3);
    const extra = Math.max(0, (Number(l.qtd) || itens.length) - nomes.length);
    if (!nomes.length) return `${itens.length} item(ns)`;
    return nomes.join(" · ") + (extra > 0 ? ` +${extra}` : "");
  };

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Resultados</h1>
      <p className="mt-1 text-sm text-subtle">Sua operação em números e em listas para agir: comece pela <b>Visão geral</b> e vá fundo nas listas quando algo pedir ação.</p>

      {/* filtros — SmartSelect com busca; o form segue GET puro (hidden inputs) */}
      <form className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-[170px]">
          <label className="label">Período (produtividade)</label>
          <div className="mt-1">
            <SmartSelect
              name="dias"
              defaultValue={String(dias)}
              className="py-1.5 text-sm"
              options={[
                { value: "7", label: "7 dias" },
                { value: "15", label: "15 dias" },
                { value: "30", label: "30 dias" },
                { value: "90", label: "90 dias" },
              ]}
            />
          </div>
        </div>
        <div className="w-[190px]">
          <label className="label">Considerar frio após</label>
          <div className="mt-1">
            <SmartSelect
              name="frio"
              defaultValue={String(frio)}
              className="py-1.5 text-sm"
              options={[
                { value: "7", label: "7 dias sem toque" },
                { value: "15", label: "15 dias sem toque" },
                { value: "30", label: "30 dias sem toque" },
                { value: "60", label: "60 dias sem toque" },
              ]}
            />
          </div>
        </div>
        {gestor && (
          <div className="w-[210px]">
            <label className="label">Vendedor</label>
            <div className="mt-1">
              {/* single de propósito: meta, forecast e ticket médio são por PESSOA.
                  Para cruzar vários vendedores, use a aba Registro (filtro multi). */}
              <SmartSelect
                name="vendedor"
                defaultValue={vendedor}
                clearable
                placeholder="Toda a equipe"
                className="py-1.5 text-sm"
                options={memberOpts.map((m) => ({ value: m.id, label: m.full_name || m.email }))}
              />
            </div>
          </div>
        )}
        {/* mantém os filtros da aba Registro ao reaplicar o filtro geral */}
        {logAcoes.map((a) => <input key={a} type="hidden" name="logAcao" value={a} />)}
        {logUsers.map((u) => <input key={u} type="hidden" name="logUser" value={u} />)}
        <button className="btn-brand px-4 py-1.5 text-sm" type="submit">Aplicar</button>
      </form>

      <ReportTabs
        tabs={[
          { id: "visao", label: "Visão geral", node: (
      <div className="mt-2">
        <GoalPanel
          period={period}
          mrrTarget={Number((goal as any)?.mrr_target) || 0}
          touchTarget={Number((goal as any)?.touch_target) || 0}
          wonMrr={vgWonMrrMonth}
          touchesDone={vgTouches}
          forecastMrr={fcMonthTotal}
          targetUserId={gestor && vendedor ? vendedor : undefined}
          targetName={gestor && vendedor ? selectedName : undefined}
        />
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {vgCards.map((c) => (
            <div key={c.label} className="card p-5">
              <span className="label">{c.label}</span>
              <p className="mt-2 font-display text-3xl font-bold">{c.value}</p>
              <p className="mt-1 text-xs text-subtle">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* FORECAST — previsão de receita recorrente */}
        <div className="mt-6 card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Previsão de receita (forecast)</h2>
            <span className="text-xs text-subtle">recorrente · R$/mês</span>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-subtle">Fechado no mês</p>
              <p className="mt-1 font-display text-2xl font-bold text-signal">{brl(vgWonMrrMonth)}</p>
            </div>
            <div>
              <p className="text-xs text-subtle">Previsão do mês (ponderada)</p>
              <p className="mt-1 font-display text-2xl font-bold text-brand-dark">{brl(fcMonthTotal)}</p>
              <p className="text-[11px] text-subtle">fechado + previstos p/ {mesLabel(period)}</p>
            </div>
            <div>
              <p className="text-xs text-subtle">Pipeline aberto ponderado</p>
              <p className="mt-1 font-display text-2xl font-bold">{brl(fcWeightedOpen)}</p>
              <p className="text-[11px] text-subtle">de {brl(vgOpenValue)} em aberto</p>
            </div>
          </div>

          {(fcMonths.length > 0 || fcSemData > 0) && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 text-sm font-medium">Por mês de fechamento previsto (ponderado)</p>
              <div className="space-y-2">
                {fcMonths.map(([m, v]) => (
                  <div key={m}>
                    <div className="flex items-center justify-between text-sm"><span className="font-medium">{mesLabel(m)}</span><span className="text-subtle">{brl(v)}/mês</span></div>
                    <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-brand" style={{ width: `${(v / fcMax) * 100}%` }} /></div>
                  </div>
                ))}
                {fcSemData > 0 && (
                  <p className="pt-1 text-xs text-subtle">+ <b>{brl(fcSemData)}/mês</b> em negócios <b>sem data prevista</b> — defina a data no cartão do negócio para caírem no mês certo.</p>
                )}
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-subtle">
            <b>Ponderada</b> = cada negócio aberto × sua <b>probabilidade</b>. Sem probabilidade definida, usamos a <b>implícita do estágio</b> (quanto mais avançado no funil, maior). Ajuste a probabilidade e a data prevista no cartão do negócio (Pipeline) para afinar a previsão.
          </p>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="card p-5">
            <h2 className="font-display text-lg font-bold">Funil de negócios em aberto</h2>
            <p className="text-xs text-subtle">Quantos negócios e quanto valor em cada etapa — e quantos % avançam para a próxima.</p>
            <div className="mt-4 space-y-3">
              {vgFunnel.map((f) => (
                <div key={f.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{f.name}</span>
                    <span className="text-subtle">{f.count} · {brl(f.value)}/mês{f.conv !== null && <span className="ml-2 font-semibold text-brand-dark">→ {f.conv}% avança</span>}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-brand" style={{ width: `${(f.count / vgMaxCount) * 100}%` }} /></div>
                </div>
              ))}
              {!vgFunnel.length && <p className="text-sm text-subtle">Sem estágios abertos.</p>}
            </div>
          </div>
          <div className="card p-5">
            <h2 className="font-display text-lg font-bold">Atividade ({dias} dias)</h2>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Metric label="Atividades feitas" value={vgTouches} />
              <Metric label="E-mails enviados" value={vgEmails} />
              <Metric label="Respostas recebidas" value={vgReplies} />
              <Metric label="Reuniões realizadas" value={vgRealizadas} />
            </div>
            <div className="mt-4 rounded-xl bg-muted p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Taxa de faltas nas reuniões</span>
                <span className={`font-bold ${vgNoShowRate !== null && vgNoShowRate > 30 ? "text-danger" : "text-ink"}`}>{vgNoShowRate === null ? "—" : `${vgNoShowRate}%`}</span>
              </div>
              <p className="mt-1 text-xs text-subtle">{vgNoShows} falta(s) em {vgNoShowBase} reuniões concluídas</p>
            </div>
          </div>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <div className="grid grid-cols-2 gap-4">
              <Metric label="Valor médio por negócio" value={vgAvgTicket === null ? "—" : brl(vgAvgTicket)} />
              <Metric label="Tempo médio de fechamento" value={vgAvgCycle === null ? "—" : `${vgAvgCycle} dias`} />
            </div>
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-sm font-semibold">Motivos de perda</p>
              <p className="text-xs text-subtle">{vgLost.length} negócio(s) perdido(s) no recorte.</p>
              <div className="mt-2 space-y-2">
                {vgLossTop.map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between text-sm"><span>{reason}</span><span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">{count}</span></div>
                ))}
                {!vgLossTop.length && <p className="text-sm text-subtle">Nenhuma perda registrada.</p>}
              </div>
            </div>
          </div>
          <div className="card p-5">
            <p className="text-sm font-semibold">Receita por produto</p>
            <p className="text-xs text-subtle">Receita recorrente fechada por produto/serviço.</p>
            <div className="mt-3 space-y-2">
              {vgRevProductTop.length ? vgRevProductTop.map(([name, val]) => (
                <div key={name} className="flex items-center justify-between text-sm"><span>{name}</span><span className="font-semibold text-signal">{brl(val)}</span></div>
              )) : <p className="text-sm text-subtle">Vincule produtos às oportunidades para ver a receita por produto.</p>}
            </div>
          </div>
        </div>
      </div>
          ) },
          { id: "carteira", label: "Carteira parada", node: (
      <Secao id="carteira" titulo="Carteira parada / a resgatar" desc={`Contatos sem toque há +${frio} dias e fora de cadência ativa — o dinheiro parado. Ordenado por score (os mais quentes primeiro).`}>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-700">{parados.length} parados</span>
          {gestor && Object.entries(paradosPorVend).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => (
            <span key={id} className="rounded-full bg-muted px-3 py-1 text-subtle">{id === "sem" ? "Sem responsável" : memberName(id)}: {n}</span>
          ))}
        </div>
        <Tabela
          vazio="Nenhum contato parado — carteira em dia. 👏"
          head={["Contato", "Empresa", "Último toque", "Score", "Responsável"]}
          rows={parados.slice(0, 100).map((c) => ({
            key: c.id,
            cells: [
              <Link href={`/dashboard/contatos/${c.id}`} className="font-medium text-brand-dark hover:underline">{c.name}</Link>,
              <span className="text-subtle">{c.company || "—"}</span>,
              <UltimoToque at={c.last_activity_at} />,
              <span className={`font-semibold ${(c.score ?? 0) >= HOT_THRESHOLD ? "text-warn" : "text-subtle"}`}>{c.score ?? 0}</span>,
              <span className="text-subtle">{memberName(c.assigned_to)}</span>,
            ],
          }))}
          nota={parados.length > 100 ? `Mostrando os 100 mais quentes de ${parados.length}.` : undefined}
        />
      </Secao>
          ) },
          { id: "aging", label: "Pipeline aging", node: (
      <Secao id="aging" titulo="Pipeline aging" desc={`Oportunidades abertas paradas há +${frio} dias (sem movimento no funil). Negócios apodrecendo.`}>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-700">{aging.length} paradas · {brl(agingValor)}/mês em risco</span>
        </div>
        <Tabela
          vazio="Nenhum negócio parado nesse corte. 👏"
          head={["Negócio", "Estágio", "Valor", "Parado há", ""]}
          rows={aging.slice(0, 100).map((o) => ({
            key: o.id,
            cells: [
              <Link href={`/dashboard/pipeline?opp=${o.id}`} className="font-medium text-brand-dark hover:underline">{o.title}</Link>,
              <span className="text-subtle">{stageById.get(o.stage_id)?.name || "—"}</span>,
              <span className="font-semibold text-brand-dark">{brl(o.value_mrr)}/mês</span>,
              <span className={`font-medium ${o.dias >= 30 ? "text-red-600" : "text-amber-600"}`}>{o.dias}d</span>,
              <Link href={`/dashboard/pipeline?opp=${o.id}`} className="text-xs text-subtle hover:text-brand-dark">abrir →</Link>,
            ],
          }))}
          nota={aging.length > 100 ? `Mostrando as 100 mais paradas de ${aging.length}.` : undefined}
        />
      </Secao>
          ) },
          { id: "empresas", label: "Empresas vazias", node: (
      <Secao id="empresas" titulo="Empresas sem contato ou sem oportunidade" desc="Contas cadastradas que ainda não viraram relacionamento nem negócio — potencial não explorado.">
        <Tabela
          vazio="Todas as empresas têm contato e oportunidade."
          head={["Empresa", "Local", "Contatos", "Oportunidades", ""]}
          rows={empresasVazias.slice(0, 100).map((a) => ({
            key: a.id,
            cells: [
              <Link href={`/dashboard/contas/${a.id}`} className="font-medium text-brand-dark hover:underline">{a.name}</Link>,
              <span className="text-subtle">{[a.municipio, a.uf].filter(Boolean).join("/") || "—"}</span>,
              <span className={a.nContatos === 0 ? "font-semibold text-red-600" : "text-subtle"}>{a.nContatos}</span>,
              <span className={a.nOpps === 0 ? "font-semibold text-red-600" : "text-subtle"}>{a.nOpps}</span>,
              <Link href={`/dashboard/contas/${a.id}`} className="text-xs text-subtle hover:text-brand-dark">abrir →</Link>,
            ],
          }))}
          nota={empresasVazias.length > 100 ? `Mostrando 100 de ${empresasVazias.length}.` : undefined}
        />
      </Secao>
          ) },
          { id: "quentes", label: "Quentes sem ação", node: (
      <Secao id="quentes" titulo="Leads quentes sem ação" desc={`Score alto (≥${HOT_THRESHOLD}) mas frios há +${frio} dias — prioridade máxima: interesse quente esfriando.`}>
        <Tabela
          vazio="Nenhum lead quente esquecido. 👏"
          head={["Contato", "Empresa", "Score", "Último toque", "Responsável"]}
          rows={quentesFrios.slice(0, 50).map((c) => ({
            key: c.id,
            cells: [
              <Link href={`/dashboard/contatos/${c.id}`} className="font-medium text-brand-dark hover:underline">{c.name}</Link>,
              <span className="text-subtle">{c.company || "—"}</span>,
              <span className="font-semibold text-warn">{c.score ?? 0}</span>,
              <UltimoToque at={c.last_activity_at} />,
              <span className="text-subtle">{memberName(c.assigned_to)}</span>,
            ],
          }))}
        />
      </Secao>
          ) },
          { id: "produtividade", label: "Produtividade", node: (
      <Secao id="produtividade" titulo="Produtividade por vendedor" desc={`Atividade nos últimos ${dias} dias: toques dados, respostas geradas, reuniões marcadas, oportunidades criadas e ganhas.`}>
        <Tabela
          vazio="Sem atividade no período."
          head={["Vendedor", "Toques", "Respostas", "Reuniões", "Opp. criadas", "Ganhas"]}
          rows={prodLinhas.map((p) => ({
            key: p.id,
            cells: [
              <span className="font-medium">{p.nome}</span>,
              <span>{p.toques}</span>,
              <span className="text-signal">{p.respostas}</span>,
              <span>{p.reunioes}</span>,
              <span>{p.criadas}</span>,
              <span className="font-semibold text-brand-dark">{p.ganhas}</span>,
            ],
          }))}
        />
      </Secao>
          ) },
          { id: "cobertura", label: "Cobertura", node: (
      <Secao id="cobertura" titulo="Cobertura da base" desc="A saúde da operação: quanto da base está sendo realmente trabalhada.">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Tile label="Contatos" value={String(totalContatos)} sub={`${comEmail} com e-mail (${pct(comEmail, totalContatos)}%)`} />
          <Tile label="Em cadência ativa" value={`${pct(emCadencia, totalContatos)}%`} sub={`${emCadencia} de ${totalContatos}`} />
          <Tile label="Carteira fria" value={`${pct(friosTotal, totalContatos)}%`} sub={`${friosTotal} sem toque +${frio}d e fora de cadência`} />
          <Tile label="Empresas" value={String(totalEmpresas)} sub={`${empresasComContato} com contato · ${empresasComOpp} com oportunidade`} />
          <Tile label="Empresas com oportunidade" value={`${pct(empresasComOpp, totalEmpresas)}%`} sub={`${totalEmpresas - empresasComOpp} sem nenhum negócio`} />
        </div>
      </Secao>
          ) },
          { id: "cadencias", label: "Cadências", node: (
      <Secao id="cadencias" titulo="Desempenho de cadências" desc="Como cada cadência está convertendo: inscritos, ativos, respostas e taxa de resposta.">
        <Tabela
          vazio="Nenhuma cadência com inscritos ainda."
          head={["Cadência", "Inscritos", "Ativos", "Respostas", "Concluídos", "Taxa resposta"]}
          rows={cadStats.map((s) => ({
            key: s.id,
            cells: [
              <span className="font-medium">{s.name}</span>,
              <span>{s.total}</span>,
              <span>{s.ativos}</span>,
              <span className="text-signal">{s.respondidos}</span>,
              <span className="text-subtle">{s.concluidos}</span>,
              <span className={`font-semibold ${s.taxa >= 15 ? "text-signal" : ""}`}>{s.taxa}%</span>,
            ],
          }))}
        />
      </Secao>
          ) },
          { id: "cliques", label: "Cliques em links", node: (
      <Secao id="cliques" titulo="Cliques em links" desc={`Comportamento de clique nos e-mails: quanto engaja, quais links puxam mais e quem clicou. ${gestor ? (vendedor ? "Filtrado pelo vendedor selecionado." : "Toda a equipe (filtre por vendedor acima).") : "Seus contatos."}`}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Tile label="Links rastreados" value={String(rastreados)} />
          <Tile label="Links clicados" value={String(clicadosN)} sub={`${taxaClique}% dos rastreados`} />
          <Tile label="Cliques totais" value={String(totalCliques)} />
          <Tile label={`Cliques (${dias}d)`} value={String(cliquesPeriodo)} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="label mb-1">Links mais clicados</p>
            <Tabela
              vazio="Nenhum clique ainda."
              head={["Link", "Cliques"]}
              rows={topLinks.map((l, i) => ({
                key: String(i),
                cells: [
                  <a href={l.url} target="_blank" rel="noreferrer" className="block max-w-[360px] truncate text-brand-dark hover:underline" title={l.url}>{l.url}</a>,
                  <span className="font-semibold">{l.n}</span>,
                ],
              }))}
            />
          </div>
          <div>
            <p className="label mb-1">Últimos cliques</p>
            <Tabela
              vazio="Nenhum clique ainda."
              head={["Contato", "Link", "Quando"]}
              rows={ultimosCliques.map((l) => ({
                key: l.id,
                cells: [
                  <span className="font-medium">{l.contacts?.name || "—"}</span>,
                  <a href={l.url} target="_blank" rel="noreferrer" className="block max-w-[220px] truncate text-brand-dark hover:underline" title={l.url}>{l.url}</a>,
                  <span className="text-subtle">{l.first_click_at ? new Date(l.first_click_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}</span>,
                ],
              }))}
            />
          </div>
        </div>
      </Secao>
          ) },
          { id: "registro", label: "Registro", node: (
      <Secao
        id="registro"
        titulo="Registro de ações"
        desc={`Trilha de auditoria do que a equipe fez de destrutivo ou em lote — exclusões de tarefas, contatos e empresas, tags e atribuições em massa. Últimos ${dias} dias. ${gestor ? "Como gestor, você vê o workspace inteiro." : "Você vê apenas as suas próprias ações."}`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Ações registradas" value={String(logs.length)} sub={`nos últimos ${dias} dias`} />
          <Tile label="Exclusões" value={String(logDestrutivos.length)} sub="ações que apagaram algo" />
          <Tile label="Registros apagados" value={String(logRegistrosApagados)} sub="soma das linhas excluídas" />
        </div>

        {/* filtros MULTI da aba — navegação suave, para não perder a aba */}
        <LogFilterBar
          gestor={gestor}
          acoes={logAcoes}
          usuarios={logUsers}
          acaoOpts={acaoOpts}
          membroOpts={memberOpts.map((m) => ({ value: m.id, label: m.full_name || m.email }))}
        />
        {gestor && vendedor && !logUsers.length && (
          <p className="mt-2 text-xs text-warn">
            Mostrando só as ações de <b>{memberName(vendedor)}</b>, por causa do filtro <b>Vendedor</b> no topo da
            página. Para ver o workspace inteiro, limpe aquele filtro (ou escolha as pessoas em “Quem fez”).
          </p>
        )}

        {logPorPessoa.length > 0 && (
          <div className="mt-4">
            <p className="label mb-1">Quem apagou mais (registros)</p>
            <div className="card flex flex-wrap gap-4 p-4">
              {logPorPessoa.map(([nome, n]) => (
                <Metric key={nome} label={nome} value={n} />
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <Tabela
            vazio="Nada registrado neste período. O registro passa a gravar a partir desta versão."
            nota={`Mostra até 300 ações. O log guarda a foto do que foi apagado (nome, título, contato) — por isso a linha sobrevive à exclusão do registro. Ninguém edita nem apaga o log.`}
            head={["Quando", "Quem", "Ação", "Qtd", "O que", "Detalhe"]}
            rows={logs.map((l) => ({
              key: String(l.id),
              cells: [
                <span className="whitespace-nowrap text-subtle">
                  {new Date(l.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </span>,
                <span className="font-medium">{l.user_name || memberName(l.user_id)}</span>,
                <span className={ACOES_DESTRUTIVAS.includes(l.action) ? "font-semibold text-danger" : "font-medium"}>
                  {labelAcao(l.action)}
                </span>,
                <span className="font-semibold">{Number(l.qtd) || 0}</span>,
                <span className="block max-w-[280px] truncate text-subtle" title={resumoItens(l)}>{resumoItens(l)}</span>,
                <span className="block max-w-[320px] text-subtle">{l.detail || "—"}</span>,
              ],
            }))}
          />
        </div>
      </Secao>
          ) },
        ]}
      />

      <p className="mt-8 text-xs text-subtle">Os relatórios respeitam sua visibilidade: {gestor ? "gestor vê toda a equipe (filtre por vendedor acima)." : "você vê apenas a sua carteira."} Listas grandes mostram os itens mais críticos primeiro.</p>
    </div>
  );
}

// Tabela genérica dos relatórios
function Tabela({
  head, rows, vazio, nota,
}: {
  head: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
  vazio: string;
  nota?: string;
}) {
  if (!rows.length) return <div className="card p-6 text-center text-sm text-subtle">{vazio}</div>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-subtle">
          <tr>{head.map((h, i) => <th key={i} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line last:border-0 hover:bg-muted">
              {r.cells.map((c, i) => <td key={i} className="px-4 py-2.5">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {nota && <p className="px-4 py-2 text-xs text-subtle">{nota}</p>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="font-display text-2xl font-bold">{value}</p>
      <p className="text-xs text-subtle">{label}</p>
    </div>
  );
}
