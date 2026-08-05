import "server-only";

// ============================================================
// MONTAR A JORNADA A PARTIR DO QUE JÁ EXISTE
//
// Nada de tabela nova: as peças estão espalhadas e a única coisa que faltava era
// juntá-las pela chave certa.
//
//   tasks         → o passo em si (canal, assunto, posição, agendado/feito/pulado)
//   events        → email_sent / replied, por contato
//   email_opens   → aberturas por passo (colunas de origem entram na 0108)
//   link_clicks   → cliques por passo, com a URL
//
// A CHAVE É (enrollment_id, step_position). É o que amarra "o e-mail do passo 2" à
// "abertura do passo 2" — sem ela, com três passos enviados, só dá para dizer que
// houve duas aberturas, e não QUAL mensagem funcionou. Saber qual é a diferença entre
// ajustar a cadência e continuar no escuro.
//
// TOLERANTE À 0108 NÃO ESTAR APLICADA: as consultas de abertura/clique vão em
// try/catch próprio e, se falharem, a jornada aparece sem esses números em vez de
// derrubar a ficha inteira. Já aconteceu de uma coluna nova levar uma tela junto.
// ============================================================

import type { JornadaCadencia, PassoJornada } from "@/components/JornadaContato";

export async function montarJornada(supabase: any, contactId: string): Promise<JornadaCadencia[]> {
  const { data: enrs } = await supabase
    .from("enrollments")
    .select("id, status, created_at, sequence_id, sequences(name)")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });

  const lista = (enrs as any[]) || [];
  if (!lista.length) return [];

  const enrollmentIds = lista.map((e) => e.id);

  const { data: tarefas } = await supabase
    .from("tasks")
    .select("id, enrollment_id, channel, title, status, due_date, completed_at, step_position")
    .in("enrollment_id", enrollmentIds)
    .order("step_position", { ascending: true });

  // eventos do contato: enviado e respondido. `meta` traz o assunto quando existe.
  const { data: eventos } = await supabase
    .from("events")
    .select("type, created_at, meta")
    .eq("contact_id", contactId)
    .in("type", ["email_sent", "replied"])
    .order("created_at", { ascending: true });

  // --- aberturas e cliques: opcionais, e cada um por sua conta ---
  let aberturas: any[] = [];
  let cliques: any[] = [];
  try {
    const { data } = await supabase
      .from("email_opens")
      .select("enrollment_id, step_position, opens, first_open_at")
      .in("enrollment_id", enrollmentIds);
    aberturas = (data as any[]) || [];
  } catch { /* 0108 não aplicada: segue sem aberturas */ }
  try {
    const { data } = await supabase
      .from("link_clicks")
      .select("enrollment_id, step_position, url, clicks, first_click_at")
      .in("enrollment_id", enrollmentIds);
    cliques = (data as any[]) || [];
  } catch { /* idem */ }

  const chave = (e: any, p: any) => `${e}|${p ?? 0}`;

  const abrePorPasso = new Map<string, { opens: number; first: string | null }>();
  for (const a of aberturas) {
    const k = chave(a.enrollment_id, a.step_position);
    const atual = abrePorPasso.get(k) || { opens: 0, first: null };
    atual.opens += Number(a.opens) || 0;
    if (a.first_open_at && (!atual.first || a.first_open_at < atual.first)) atual.first = a.first_open_at;
    abrePorPasso.set(k, atual);
  }

  const clicaPorPasso = new Map<string, { clicks: number; first: string | null; url: string | null }>();
  for (const c of cliques) {
    if (!Number(c.clicks)) continue;   // link gerado e nunca clicado não é clique
    const k = chave(c.enrollment_id, c.step_position);
    const atual = clicaPorPasso.get(k) || { clicks: 0, first: null, url: null };
    atual.clicks += Number(c.clicks) || 0;
    if (c.first_click_at && (!atual.first || c.first_click_at < atual.first)) {
      atual.first = c.first_click_at;
      atual.url = c.url || atual.url;
    }
    if (!atual.url) atual.url = c.url || null;
    clicaPorPasso.set(k, atual);
  }

  // "enviado em": o evento de envio mais próximo. Sem enrollment no evento, a
  // aproximação honesta é casar pela ORDEM dos envios com a ordem dos passos feitos.
  const enviosEmail = ((eventos as any[]) || []).filter((e) => e.type === "email_sent").map((e) => e.created_at);
  const respondeuEm = ((eventos as any[]) || []).find((e) => e.type === "replied")?.created_at || null;

  const porEnrollment = new Map<string, any[]>();
  for (const t of (tarefas as any[]) || []) {
    if (!porEnrollment.has(t.enrollment_id)) porEnrollment.set(t.enrollment_id, []);
    porEnrollment.get(t.enrollment_id)!.push(t);
  }

  let iEnvio = 0;
  return lista.map((e) => {
    const tarefasDaCadencia = (porEnrollment.get(e.id) || []).sort(
      (a, b) => (a.step_position ?? 99) - (b.step_position ?? 99)
    );
    const passos: PassoJornada[] = tarefasDaCadencia.map((t) => {
      const k = chave(e.id, t.step_position);
      const ab = abrePorPasso.get(k);
      const cl = clicaPorPasso.get(k);
      const feito = t.status === "done";
      const ehEmail = t.channel === "email";
      // consome um envio da fila só quando o passo de e-mail foi realmente concluído
      const enviadoEm = feito && ehEmail ? enviosEmail[iEnvio++] || t.completed_at || null : feito ? t.completed_at : null;
      return {
        posicao: t.step_position ?? null,
        canal: t.channel,
        titulo: t.title || null,
        status: t.status,
        quando: t.status === "pending" ? t.due_date : t.completed_at,
        enviadoEm,
        aberturas: ab?.opens || 0,
        primeiraAbertura: ab?.first || null,
        cliques: cl?.clicks || 0,
        primeiroClique: cl?.first || null,
        urlClicada: cl?.url || null,
      };
    });

    return {
      enrollmentId: e.id as string,
      cadencia: (e.sequences?.name as string) || "Cadência",
      status: (e.status as string) || "active",
      desde: (e.created_at as string) || null,
      respondeuEm: e.status === "replied" ? respondeuEm : null,
      passos,
    };
  });
}
