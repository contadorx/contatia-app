import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isManager as isMgr } from "@/lib/permissions";
import { HOT_THRESHOLD } from "@/lib/scoring";
import { UltimoToque, diasSemToque } from "@/lib/lastTouch";

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

export default async function Relatorios({ searchParams }: { searchParams: { dias?: string; frio?: string; vendedor?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role, team_role").eq("id", user?.id ?? "").maybeSingle();
  const gestor = isMgr((me as any)?.role, (me as any)?.team_role);

  const dias = Number(searchParams.dias) || 30;
  const frio = Number(searchParams.frio) || 30;
  const vendedor = gestor ? (searchParams.vendedor || "") : (user?.id ?? "");

  const sinceISO = new Date(Date.now() - dias * 86400000).toISOString();
  const frioISO = new Date(Date.now() - frio * 86400000).toISOString();

  // ---- coleta ----
  const membersP = gestor
    ? supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name", { ascending: true })
    : Promise.resolve({ data: [] as any[] });

  let contactsQ = supabase.from("contacts").select("id, name, company, score, assigned_to, last_activity_at, account_id, email").limit(4000);
  if (vendedor) contactsQ = contactsQ.eq("assigned_to", vendedor);

  let oppsQ = supabase.from("opportunities").select("id, title, value_mrr, stage_id, status, owner_id, created_at, updated_at, account_id").limit(4000);
  if (vendedor) oppsQ = oppsQ.eq("owner_id", vendedor);

  let mtgsQ = supabase.from("meetings").select("id, assigned_to, datetime, status, created_at").gte("created_at", sinceISO).limit(4000);
  if (vendedor) mtgsQ = mtgsQ.eq("assigned_to", vendedor);

  const [{ data: members }, { data: contacts }, { data: opps }, { data: stages }, { data: enrollments }, { data: sequences }, { data: meetings }, { data: events }, { data: accounts }] =
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

  // filtro (form GET)
  const memberOpts = ((members as any[]) || []);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Relatórios</h1>
      <p className="mt-1 text-sm text-subtle">Listas de gestão para agir: o que está parado, o que resgatar e como a equipe está produzindo. Diferente de Métricas (visão agregada), aqui você clica e trata.</p>

      {/* filtros */}
      <form className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Período (produtividade)</label>
          <select name="dias" defaultValue={String(dias)} className="input mt-1 py-1.5 text-sm">
            <option value="7">7 dias</option>
            <option value="15">15 dias</option>
            <option value="30">30 dias</option>
            <option value="90">90 dias</option>
          </select>
        </div>
        <div>
          <label className="label">Considerar frio após</label>
          <select name="frio" defaultValue={String(frio)} className="input mt-1 py-1.5 text-sm">
            <option value="7">7 dias sem toque</option>
            <option value="15">15 dias sem toque</option>
            <option value="30">30 dias sem toque</option>
            <option value="60">60 dias sem toque</option>
          </select>
        </div>
        {gestor && (
          <div>
            <label className="label">Vendedor</label>
            <select name="vendedor" defaultValue={vendedor} className="input mt-1 py-1.5 text-sm">
              <option value="">Toda a equipe</option>
              {memberOpts.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
              ))}
            </select>
          </div>
        )}
        <button className="btn-brand px-4 py-1.5 text-sm" type="submit">Aplicar</button>
      </form>

      {/* atalhos */}
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {[
          ["carteira", "Carteira parada"], ["aging", "Pipeline aging"], ["empresas", "Empresas vazias"],
          ["quentes", "Quentes sem ação"], ["produtividade", "Produtividade"], ["cobertura", "Cobertura"], ["cadencias", "Cadências"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full bg-muted px-3 py-1 text-subtle hover:text-ink">{label}</a>
        ))}
      </div>

      {/* ================= 1 ================= */}
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

      {/* ================= 2 ================= */}
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

      {/* ================= 3 ================= */}
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

      {/* ================= 4 ================= */}
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

      {/* ================= 5 ================= */}
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

      {/* ================= 6 ================= */}
      <Secao id="cobertura" titulo="Cobertura da base" desc="A saúde da operação: quanto da base está sendo realmente trabalhada.">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Tile label="Contatos" value={String(totalContatos)} sub={`${comEmail} com e-mail (${pct(comEmail, totalContatos)}%)`} />
          <Tile label="Em cadência ativa" value={`${pct(emCadencia, totalContatos)}%`} sub={`${emCadencia} de ${totalContatos}`} />
          <Tile label="Carteira fria" value={`${pct(friosTotal, totalContatos)}%`} sub={`${friosTotal} sem toque +${frio}d e fora de cadência`} />
          <Tile label="Empresas" value={String(totalEmpresas)} sub={`${empresasComContato} com contato · ${empresasComOpp} com oportunidade`} />
          <Tile label="Empresas com oportunidade" value={`${pct(empresasComOpp, totalEmpresas)}%`} sub={`${totalEmpresas - empresasComOpp} sem nenhum negócio`} />
        </div>
      </Secao>

      {/* ================= 7 ================= */}
      <Secao id="cadencias" titulo="Desempenho de cadências" desc="Como cada sequência está convertendo: inscritos, ativos, respostas e taxa de resposta.">
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
