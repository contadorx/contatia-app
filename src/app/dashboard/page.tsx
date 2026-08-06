import { createClient } from "@/lib/supabase/server";
import TaskQueue from "@/components/TaskQueue";
import EngajouAgora from "@/components/EngajouAgora";
import EnviosHoje from "@/components/EnviosHoje";
import { enviosDeHoje } from "@/lib/enviosHoje";
import { isManager } from "@/lib/permissions";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { HOT_THRESHOLD } from "@/lib/scoring";
import { effectiveDailyCap } from "@/lib/warmup";
import { Termo } from "@/components/Termo";
import { diaISO, diaISOmais } from "@/lib/datas";

export const dynamic = "force-dynamic";

export default async function Today() {
  const supabase = createClient();
  // em UTC, das 21h à meia-noite "hoje" já era amanhã: a fila mostrava tarefa do dia
  // seguinte como se fosse de hoje. diaISO responde pelo calendário brasileiro.
  const today = diaISO();
  const in3 = diaISOmais(3);

  const { data: tenantRow } = await supabase.from("tenants").select("id, whatsapp_mode").maybeSingle();
  const waMode = ((tenantRow as any)?.whatsapp_mode as string) || "assistido";

  // quem está olhando — decide se o painel de envios mostra só os seus ou os da equipe
  const { data: { user } } = await supabase.auth.getUser();
  const { data: eu } = await supabase
    .from("profiles").select("tenant_id, role, team_role").eq("id", user?.id ?? "").maybeSingle();
  const souGestor = isManager((eu as any)?.role, (eu as any)?.team_role);
  const envios = await enviosDeHoje(supabase, {
    tenantId: ((eu as any)?.tenant_id as string) || "",
    meuId: user?.id,
    gestor: souGestor,
  });

  // no modo automático, avisa se o número desconectou (envios falhariam em silêncio)
  let waDisconnected = false;
  if (waMode === "evolution") {
    const { data: waAcc } = await supabase
      .from("whatsapp_accounts")
      .select("status")
      .eq("is_active", true)
      .not("status", "is", null)
      .neq("status", "open")
      .limit(1);
    waDisconnected = ((waAcc as any[]) || []).length > 0;
  }

  // ATENÇÃO ao "estimated": contar 78 mil contatos EXATO a cada abertura da home era,
  // sozinho, 44% de todo o tempo do banco (523 chamadas, média de 620 ms, pico de
  // 4,3 s — medido no Query Performance do Supabase). O número aqui é um cartão de
  // resumo: a estimativa do próprio planejador serve, custa ~0 ms, e o PostgREST
  // devolve o valor exato automaticamente enquanto a tabela é pequena.
  //
  // A segunda contagem (score >= HOT_THRESHOLD) foi REMOVIDA: era consultada e nunca
  // usada em lugar nenhum da página — uma varredura completa de 78 mil linhas por
  // carregamento, à toa.
  const [{ data: rawTasks }, contactsCount, { data: boxes }, { data: equipe }] = await Promise.all([
    supabase
      .from("tasks")
      // O embed de contatos traz `*`: `instagram`/`linkedin` nascem na 0110 e, pedidas
      // pelo nome, derrubariam a FILA INTEIRA enquanto a migration não estivesse
      // aplicada — a tela mais importante do app ficaria vazia sem dizer por quê.
      .select("id, channel, title, generated_content, due_date, contact_id, enrollment_id, assigned_to, contacts(*)")
      .eq("status", "pending")
      .lte("due_date", in3),
    supabase.from("contacts").select("id", { count: "estimated", head: true }),
    supabase.from("email_accounts").select("daily_cap, warmup_stage, created_at").eq("is_active", true),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true),
  ]);

  // Envio Seguro: soma o que as caixas conseguem enviar HOJE (com aquecimento) — evita a
  // surpresa "inscrevi 100 e saíram 10". Reusa a curva de warmup do envio.
  const activeBoxes = (boxes as any[]) || [];
  let sendCapToday = 0;
  let anyWarming = false;
  // O DETALHE POR CAIXA MORA EM CONFIGURAÇÕES → CANAIS, e não aqui.
  //
  // Ele nasceu nesta tela para responder "por que meu limite não subiu?". Respondeu,
  // e virou ruído: sete linhas de manutenção de infraestrutura no topo da tela que
  // existe para dizer o que fazer HOJE. A pergunta é legítima e rara; o lugar dela é
  // onde as caixas são configuradas — que é onde a resposta também vira ação.
  for (const a of activeBoxes) {
    const warmupOn = (a.warmup_stage ?? 0) !== -1;
    const r = effectiveDailyCap(a.created_at, a.daily_cap ?? 40, warmupOn);
    sendCapToday += r.cap;
    if (r.warming) anyWarming = true;
  }

  const allTasks = (rawTasks as any[]) || [];

  // ordena por score do contato (quente primeiro), depois por vencimento
  const sorted = allTasks.sort((a, b) => {
    const sa = a.contacts?.score ?? 0;
    const sb = b.contacts?.score ?? 0;
    if (sb !== sa) return sb - sa;
    return (a.due_date || "").localeCompare(b.due_date || "");
  });

  const contactIds = Array.from(new Set(sorted.map((t) => t.contact_id).filter(Boolean)));
  const enrollmentIds = Array.from(new Set(sorted.map((t) => t.enrollment_id).filter(Boolean)));

  // cadência por enrollment + tags por contato + última atividade
  const cadenceByEnrollment: Record<string, string> = {};
  const tagsByContact: Record<string, { id: string; name: string; color: string }[]> = {};
  const lastActivity: Record<string, { type: string; created_at: string; text?: string }> = {};

  const [{ data: enrs }, { data: cts }, { data: evs }] = await Promise.all([
    enrollmentIds.length
      ? supabase.from("enrollments").select("id, sequences(name)").in("id", enrollmentIds as string[])
      : Promise.resolve({ data: [] as any[] }),
    contactIds.length
      ? supabase.from("contact_tags").select("contact_id, tags(id, name, color)").in("contact_id", contactIds as string[])
      : Promise.resolve({ data: [] as any[] }),
    contactIds.length
      ? supabase.from("events").select("contact_id, type, created_at, meta").in("contact_id", contactIds as string[]).order("created_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  for (const e of (enrs as any[]) || []) cadenceByEnrollment[e.id] = e.sequences?.name || "";
  for (const ct of (cts as any[]) || []) {
    if (ct.tags) (tagsByContact[ct.contact_id] ||= []).push(ct.tags);
  }
  for (const e of (evs as any[]) || []) {
    if (!lastActivity[e.contact_id]) lastActivity[e.contact_id] = { type: e.type, created_at: e.created_at, text: e.meta?.text };
  }

  // "quente agora": engajamento forte (respondeu / abriu proposta / abriu e-mail / clicou)
  // nas últimas 48h
  const HOT_NOW_TYPES = new Set(["replied", "doc_opened", "email_opened", "link_clicked"]);
  const now48 = Date.now() - 48 * 3600000;
  const hotNowByContact: Record<string, { type: string; created_at: string }> = {};
  for (const e of (evs as any[]) || []) {
    if (!e.contact_id || hotNowByContact[e.contact_id]) continue;
    if (HOT_NOW_TYPES.has(e.type) && new Date(e.created_at).getTime() >= now48) {
      hotNowByContact[e.contact_id] = { type: e.type, created_at: e.created_at };
    }
  }

  // ============================================================
  // QUEM ENGAJOU NAS ÚLTIMAS 48H — COM NOME
  //
  // Duas correções na mesma consulta.
  //
  // A primeira (antiga): o "Engajou agora" era derivado das TAREFAS PENDENTES — a
  // página buscava as tarefas, tirava os contact_id delas e só então olhava os eventos.
  // Quem respondeu mas terminou (ou nunca teve) cadência não tem tarefa, e ficava
  // INVISÍVEL. Por isso os eventos passaram a ser consultados por conta própria.
  //
  // A segunda (esta): o cartão "Engajou agora" contava quem engajou E TEM tarefa,
  // enquanto o bloco listava quem engajou e NÃO tem. Os dois conjuntos são disjuntos —
  // ou seja, ninguém que o cartão contava aparecia nomeado em lugar nenhum. Um número
  // sem resposta para "quem foi?". Agora a lista é UMA só, cobre os dois casos, e o
  // cartão mostra o tamanho dela — número e lista sempre batem.
  //
  // O teto de eventos é alto (1000) e a lista é cortada em 60 pessoas; quando corta, a
  // tela avisa em vez de fingir que é tudo.
  // ============================================================
  const desde48 = new Date(now48).toISOString();
  const { data: evsLivres } = await supabase
    .from("events")
    // `meta` traz o CONTEÚDO do sinal: a URL do clique, o assunto da resposta e — a
    // partir da 0108 + do enriquecimento no pixel/redirect — o assunto do e-mail e a
    // cadência de onde ele saiu. Sem isso a tela diz "abriu o e-mail" e ponto, o que
    // não é suficiente nem para responder nem para saber que cadência funciona.
    .select("contact_id, type, created_at, meta")
    .in("type", ["replied", "doc_opened", "email_opened", "link_clicked"])
    .gte("created_at", desde48)
    .order("created_at", { ascending: false })
    .limit(1000);

  const comTarefa = new Set(contactIds as string[]);
  const engajou48: Record<string, { type: string; created_at: string; meta: any }> = {};
  for (const e of (evsLivres as any[]) || []) {
    if (!e.contact_id || engajou48[e.contact_id]) continue;
    engajou48[e.contact_id] = { type: e.type, created_at: e.created_at, meta: e.meta || {} };
  }
  const TETO_ENGAJOU = 60;
  const todosIds = Object.keys(engajou48);
  const idsEngajou = todosIds.slice(0, TETO_ENGAJOU);
  const engajouTruncado = todosIds.length > TETO_ENGAJOU;
  const [{ data: ctsEngajou }, { data: enrEngajou }] = await Promise.all([
    idsEngajou.length
      ? supabase.from("contacts").select("id, name, company, score").in("id", idsEngajou)
      : Promise.resolve({ data: [] as any[] }),
    // Cadência de reserva: os eventos gravados ANTES deste build não têm a cadência
    // dentro do `meta`. Em vez de mostrar um espaço em branco para o histórico, a
    // matrícula mais recente do contato responde "de qual cadência isso veio" —
    // marcada como aproximação na tela, porque é o que ela é.
    idsEngajou.length
      ? supabase
          .from("enrollments")
          // `started_at`, não `created_at` — ver o comentário na ficha do contato.
          // Aqui o estrago era mudo: a cadência "provável" do bloco Engajou nunca
          // aparecia, e ninguém liga um espaço em branco a uma consulta recusada.
          .select("contact_id, started_at, sequences(name)")
          .in("contact_id", idsEngajou)
          .order("started_at", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const cadenciaDeReserva: Record<string, string> = {};
  for (const e of (enrEngajou as any[]) || []) {
    const nome = (e as any)?.sequences?.name;
    if (e.contact_id && nome && !cadenciaDeReserva[e.contact_id]) cadenciaDeReserva[e.contact_id] = nome;
  }

  // o assunto da RESPOSTA já era guardado como texto corrido ('Assunto: "..."') —
  // aqui ele volta a ser só o assunto, para caber na linha
  const soOAssunto = (t?: string | null) => {
    const m = /Assunto:\s*"([^"]+)"/.exec(String(t || ""));
    return m ? m[1] : (String(t || "").trim() || null);
  };

  const engajaram = ((ctsEngajou as any[]) || [])
    .map((c) => {
      const ev = engajou48[c.id];
      const meta = ev.meta || {};
      return {
      id: c.id as string,
      name: (c.name as string) || "(sem nome)",
      company: (c.company as string) || null,
      score: (c.score as number) ?? 0,
      tipo: ev.type as string,
      quando: ev.created_at as string,
      assunto: (meta.assunto as string) || (ev.type === "replied" ? soOAssunto(meta.text) : null),
      url: (meta.url as string) || null,
      cadencia: (meta.cadencia as string) || cadenciaDeReserva[c.id] || null,
      cadenciaExata: !!meta.cadencia,
      passo: typeof meta.passo === "number" ? (meta.passo as number) : null,
      // quem já tem tarefa está encaminhado; quem não tem é decisão pendente. A lista
      // mostra os dois, mas nessa ordem.
      temTarefa: comTarefa.has(c.id),
      };
    })
    .sort((a, b) => {
      if (a.temTarefa !== b.temTarefa) return a.temTarefa ? 1 : -1;
      return (b.quando || "").localeCompare(a.quando || "");
    });

  // ============================================================
  // DE QUEM É A TAREFA
  //
  // `tasks.assigned_to` é carimbado na inscrição: vem do responsável do CONTATO e, se
  // o contato não tem dono, cai em quem inscreveu. Numa base importada sem responsável
  // isso põe a fila inteira na conta de uma pessoa só — e sem o nome na tela não dá
  // nem para perceber. Aqui o id vira nome, e a fila passa a poder ser filtrada.
  // ============================================================
  const nomePorPerfil = new Map<string, string>();
  for (const p of ((equipe as any[]) || [])) {
    nomePorPerfil.set(p.id as string, (p.full_name as string) || (p.email as string) || "sem nome");
  }

  // anexa cadência + tags a cada task; separa "hoje/atrasados" de "próximos"
  const tasks = sorted.map((t) => ({
    ...t,
    cadence: t.enrollment_id ? cadenceByEnrollment[t.enrollment_id] || null : null,
    tags: t.contact_id ? tagsByContact[t.contact_id] || [] : [],
    is_future: (t.due_date || "") > today,
    hot_now: t.contact_id ? hotNowByContact[t.contact_id] || null : null,
    owner_id: (t.assigned_to as string) || "",
    owner_name: t.assigned_to ? nomePorPerfil.get(t.assigned_to as string) || "outro usuário" : "sem responsável",
  }));

  // re-ordena: quem engajou agora (hot_now) vem no topo absoluto, mantendo o resto por score
  tasks.sort((a, b) => {
    const ha = a.hot_now ? 1 : 0;
    const hb = b.hot_now ? 1 : 0;
    if (hb !== ha) return hb - ha;
    return 0; // estável: preserva a ordem anterior (score/vencimento)
  });

  // tags disponíveis para o filtro
  const { data: allTags } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true });
  // cadências ativas: o bloco "engajou e está sem próximo passo" precisa oferecer
  // a matrícula ali mesmo — mandar a pessoa até a ficha para isso seria um passo a mais
  // justamente no momento em que a pressa importa.
  const { data: seqsHome } = engajaram.length
    ? await supabase.from("sequences").select("id, name").eq("is_active", true).order("created_at", { ascending: false })
    : { data: [] as any[] };
  const seqsAtivas = ((seqsHome as any[]) || []).map((s) => ({ id: s.id as string, name: s.name as string }));
  const todayCount = tasks.filter((t) => !t.is_future).length;

  const cards: { label: string; value: number; live?: boolean; fire?: boolean; ancora?: string }[] = [
    { label: "Toques de hoje", value: todayCount, live: true },
    // era `hotNowCount` (só quem tem tarefa). Agora é o tamanho da lista logo abaixo —
    // clicar no cartão leva até ela.
    { label: "Engajou agora", value: engajaram.length, fire: true, ancora: "engajou" },
    { label: "Contatos", value: contactsCount.count ?? 0 },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">O que precisa de você hoje</h1>
      <p className="mt-1 text-sm text-subtle">
        Sua fila de{" "}
        <Termo def="Cadência = a sua sequência de follow-ups (e-mail, WhatsApp, ligação, LinkedIn) que roda no automático.">cadência</Termo>
        {" "}— quem está mais{" "}
        <Termo def="Score = quão engajado o contato está (abriu, clicou, respondeu). Quente a partir de 25 pontos.">quente</Termo>
        {" "}vem primeiro.
      </p>

      {waDisconnected && (
        <a href="/dashboard/config" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <span className="font-medium text-warn">⚠ Seu WhatsApp desconectou. Os envios automáticos estão pausados até reconectar.</span>
          <span className="font-semibold text-warn">Reconectar →</span>
        </a>
      )}

      {activeBoxes.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm">
          <span className="font-semibold text-ink">Envio Seguro:</span>{" "}
          <span className="text-subtle">hoje suas caixas enviam até <b className="text-ink">{sendCapToday} e-mails</b> no total
            {anyWarming ? " — em aquecimento, o limite sobe sozinho a cada dia. O que passar disso entra na fila e sai amanhã." : ". O que passar disso entra na fila e sai no dia seguinte."}
          </span>
          <a href="/dashboard/config" className="ml-1 whitespace-nowrap text-xs font-medium text-brand-dark hover:underline">
            ver o limite de cada caixa →
          </a>
        </div>
      )}

      <div className="mt-6">
        <OnboardingChecklist />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => {
          const miolo = (
            <>
              <div className="flex items-center gap-2">
                {c.live && <span className="h-2 w-2 rounded-full bg-signal" />}
                {c.fire && <span className="text-xs">🔥</span>}
                <span className="label">{c.label}</span>
              </div>
              <p className={`mt-2 font-display text-3xl font-bold ${c.fire ? "text-warn" : ""}`}>{c.value}</p>
              {/* um número que não leva a lugar nenhum não responde "quem foi?" */}
              {c.ancora && c.value > 0 && <p className="mt-1 text-xs font-medium text-brand-dark">ver quem →</p>}
            </>
          );
          return c.ancora && c.value > 0 ? (
            <a key={c.label} href={`#${c.ancora}`} className="card p-5 transition hover:border-warn/50">
              {miolo}
            </a>
          ) : (
            <div key={c.label} className="card p-5">{miolo}</div>
          );
        })}
      </div>

      {/* Quanto EU já mandei hoje e a que horas — a pergunta que faltava responder.
          Fica logo acima da fila porque é o que evita mandar duas vezes sem querer. */}
      <div className="mt-8">
        <EnviosHoje dados={envios} gestor={souGestor} />
      </div>

      <EngajouAgora linhas={engajaram} sequences={seqsAtivas} truncado={engajouTruncado} />

      <h2 className="mb-3 mt-8 font-display text-lg font-bold">Fila de hoje</h2>
      <TaskQueue tasks={tasks} hotThreshold={HOT_THRESHOLD} lastActivity={lastActivity} allTags={(allTags as any[]) || []} waMode={waMode} />
    </div>
  );
}
