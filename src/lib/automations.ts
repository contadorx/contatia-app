import "server-only";
import { POINTS } from "@/lib/scoring";

type DB = any; // client supabase (normal ou admin) — usamos consultas não-tipadas

/**
 * Executa as automações de um tenant para um gatilho + contato.
 * Reutilizável tanto no fluxo autenticado quanto no endpoint público (admin).
 * `db` deve conseguir ler/escrever as tabelas do tenant (RLS ou service role).
 */
export async function runAutomations(
  db: DB,
  params: { tenantId: string; contactId: string; trigger: string }
) {
  const { tenantId, contactId, trigger } = params;

  // GATE DE SUPRESSÃO: contato suprimido (opted_out) não é tocado por NENHUMA
  // automação — é a regra de higiene mais importante (LGPD + domínio).
  const { data: cSup } = await db.from("contacts").select("opted_out").eq("id", contactId).maybeSingle();
  if ((cSup as any)?.opted_out) return { ran: 0, suppressed: true };

  const { data: rules } = await db
    .from("automations")
    .select("id, trigger_type, trigger_value, action_type, action_seq, action_stage, action_tag, product_id, source_seq, priority, stop_on_match, end_current, set_state")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("trigger_type", trigger)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  const list = (rules as any[]) || [];
  if (!list.length) return { ran: 0 };

  // para score_gte, confere o score atual do contato
  let score = 0;
  if (trigger === "score_gte") {
    const { data: c } = await db.from("contacts").select("score").eq("id", contactId).single();
    score = c?.score || 0;
  }

  let ran = 0;
  for (const r of list) {
    if (r.trigger_type === "score_gte") {
      const threshold = Number(r.trigger_value) || 0;
      if (score < threshold) continue;
    }
    const ok = await applyRule(db, { tenantId, contactId, rule: r });
    if (ok) {
      ran++;
      // "para no 1º match": regra ordenada por prioridade encerra a avaliação.
      if (r.stop_on_match) break;
    }
  }
  return { ran };
}

/** Aplica UMA regra a um contato (ação + log). Reutilizado pelo cron (gatilhos de tempo). */
export async function applyRule(
  db: DB,
  { tenantId, contactId, rule }: { tenantId: string; contactId: string; rule: any }
): Promise<boolean> {
  // gate de supressão também aqui (vale para o caminho de TEMPO/cron): contato
  // suprimido nunca é tocado por automação.
  const { data: cSup } = await db.from("contacts").select("opted_out").eq("id", contactId).maybeSingle();
  if ((cSup as any)?.opted_out) return false;

  // dedup 1x por contato: gatilhos de evento (link_clicked, doc_opened, replied…)
  // recorrem — sem essa checagem a regra re-disparava a cada clique/abertura,
  // re-somando score. O caminho de tempo (cron) já checava; agora vale para todos.
  const { data: jaDisparou } = await db
    .from("automation_logs")
    .select("id")
    .eq("automation_id", rule.id)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (jaDisparou) return false;

  const ok = await applyAction(db, { tenantId, contactId, rule });
  if (ok) {
    // grava o estado-destino, se a regra definir um (suppress já grava o seu próprio)
    if (rule.set_state && rule.action_type !== "suppress") await setContactState(db, contactId, rule.set_state);
    await db.from("automation_logs").insert({
      tenant_id: tenantId,
      automation_id: rule.id,
      contact_id: contactId,
      detail: `${rule.trigger_type} → ${rule.action_type}`,
    });
  }
  return ok;
}

// Encerra as cadências ATIVAS do contato (transição limpa): enrollments ativos →
// 'stopped' e toques pendentes → 'skipped'. Usado por enroll com end_current e por suppress.
async function endActiveCadences(db: DB, contactId: string) {
  await db.from("enrollments").update({ status: "stopped" }).eq("contact_id", contactId).eq("status", "active");
  await db.from("tasks").update({ status: "skipped" }).eq("contact_id", contactId).eq("status", "pending");
}

// Grava o estado da máquina no contato (rótulo + carimbo), se a regra pedir.
async function setContactState(db: DB, contactId: string, state?: string | null) {
  const s = (state || "").trim();
  if (!s) return;
  await db.from("contacts").update({ auto_state: s, auto_state_at: new Date().toISOString() }).eq("id", contactId);
}

async function applyAction(
  db: DB,
  { tenantId, contactId, rule }: { tenantId: string; contactId: string; rule: any }
): Promise<boolean> {
  switch (rule.action_type) {
    case "pause_all": {
      await db.from("enrollments").update({ status: "paused" }).eq("contact_id", contactId).eq("status", "active");
      await db.from("tasks").update({ status: "skipped" }).eq("contact_id", contactId).eq("status", "pending");
      return true;
    }
    // SUPRESSÃO PERMANENTE: encerra tudo, marca opted_out (bloqueio duro em todas as
    // portas de inscrição) e rotula o estado. Nunca reentra.
    case "suppress": {
      await endActiveCadences(db, contactId);
      await db.from("contacts").update({ opted_out: true, auto_state: "suprimido", auto_state_at: new Date().toISOString() }).eq("id", contactId);
      if (rule.action_tag) {
        await db.from("contact_tags").upsert(
          { tenant_id: tenantId, contact_id: contactId, tag_id: rule.action_tag },
          { onConflict: "contact_id,tag_id", ignoreDuplicates: true }
        );
      }
      return true;
    }
    case "mark_hot": {
      // empurra o score acima do limiar quente
      const { data: c } = await db.from("contacts").select("score").eq("id", contactId).single();
      const bump = Math.max(0, 25 - (c?.score || 0)) + (POINTS["link_clicked"] || 10);
      await db.from("contacts").update({ score: (c?.score || 0) + bump }).eq("id", contactId);
      return true;
    }
    case "move_stage": {
      if (!rule.action_stage) return false;
      // move a oportunidade aberta do contato (se houver)
      await db.from("opportunities").update({ stage_id: rule.action_stage }).eq("contact_id", contactId).eq("status", "open");
      return true;
    }
    case "add_tag": {
      if (!rule.action_tag) return false;
      await db.from("contact_tags").upsert(
        { tenant_id: tenantId, contact_id: contactId, tag_id: rule.action_tag },
        { onConflict: "contact_id,tag_id", ignoreDuplicates: true }
      );
      return true;
    }
    case "enroll": {
      if (!rule.action_seq) return false;
      // evita duplicar: só inscreve se não houver enrollment ativo nessa sequência
      const { data: existing } = await db
        .from("enrollments")
        .select("id")
        .eq("contact_id", contactId)
        .eq("sequence_id", rule.action_seq)
        .eq("status", "active")
        .maybeSingle();
      if (existing) return false;
      // TRANSIÇÃO LIMPA: se a regra pede, encerra a cadência atual antes de inscrever
      // (a regra de ouro: nunca duas cadências ao mesmo tempo).
      if (rule.end_current) await endActiveCadences(db, contactId);
      await enrollViaEngine(db, { tenantId, contactId, sequenceId: rule.action_seq });
      return true;
    }
    default:
      return false;
  }
}

// ============================================================
// AUTOMAÇÕES POR TEMPO (rodam 1x/dia no cron). Cobrem os gatilhos que dependem
// de "há X dias": no_activity_days, cadence_completed, opportunity_lost/won.
// Todas respeitam o escopo por PRODUTO (rule.product_id) quando definido, para
// que "sem atividade" signifique "sem atividade NAQUELE produto".
// ============================================================
const TIME_TRIGGERS = ["no_activity_days", "cadence_completed", "opportunity_lost", "opportunity_won"];

export async function runTimeAutomations(admin: DB): Promise<{ ran: number }> {
  let ran = 0;
  const { data: rules } = await admin
    .from("automations")
    .select("id, tenant_id, trigger_type, trigger_value, action_type, action_seq, action_stage, action_tag, product_id, source_seq, end_current, set_state")
    .eq("is_active", true)
    .in("trigger_type", TIME_TRIGGERS);

  for (const rule of (rules as any[]) || []) {
    const days = Number(rule.trigger_value) || 0;
    if (rule.trigger_type !== "cadence_completed" && !days) continue; // dias obrigatórios (cadence_completed aceita 0 = na hora)
    const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();

    let contactIds: string[] = [];
    try {
      if (rule.trigger_type === "no_activity_days") contactIds = await candidatosSemAtividade(admin, rule, cutoff);
      else if (rule.trigger_type === "cadence_completed") contactIds = await candidatosCadenciaTerminada(admin, rule, cutoff);
      else if (rule.trigger_type === "opportunity_lost") contactIds = await candidatosOportunidade(admin, rule, cutoff, "lost");
      else if (rule.trigger_type === "opportunity_won") contactIds = await candidatosOportunidade(admin, rule, cutoff, "won");
    } catch {
      contactIds = [];
    }

    for (const cid of contactIds) {
      // dedupe: uma vez por (regra, contato)
      const { data: fired } = await admin.from("automation_logs").select("id").eq("automation_id", rule.id).eq("contact_id", cid).maybeSingle();
      if (fired) continue;
      const ok = await applyRule(admin, { tenantId: rule.tenant_id, contactId: cid, rule });
      if (ok) ran++;
    }
  }
  return { ran };
}

// contatos ligados a um produto (via cadência OU oportunidade) — para escopo por produto
async function contatosDoProduto(admin: DB, tenantId: string, productId: string): Promise<Set<string>> {
  const [{ data: enr }, { data: opps }] = await Promise.all([
    admin.from("enrollments").select("contact_id, sequences!inner(product_id)").eq("tenant_id", tenantId).eq("sequences.product_id", productId),
    admin.from("opportunities").select("primary_contact_id").eq("tenant_id", tenantId).eq("product_id", productId).not("primary_contact_id", "is", null),
  ]);
  const set = new Set<string>();
  for (const e of (enr as any[]) || []) if (e?.contact_id) set.add(e.contact_id);
  for (const o of (opps as any[]) || []) if (o?.primary_contact_id) set.add(o.primary_contact_id);
  return set;
}

// contatos com uma cadência ATIVA no produto (para NÃO recuperar quem já está sendo trabalhado)
async function contatosAtivosNoProduto(admin: DB, tenantId: string, productId: string | null): Promise<Set<string>> {
  let q = admin.from("enrollments").select("contact_id, sequences!inner(product_id)").eq("tenant_id", tenantId).eq("status", "active");
  if (productId) q = q.eq("sequences.product_id", productId);
  const { data } = await q;
  const set = new Set<string>();
  for (const e of (data as any[]) || []) if (e?.contact_id) set.add(e.contact_id);
  return set;
}

// GATILHO no_activity_days (com escopo por produto opcional)
async function candidatosSemAtividade(admin: DB, rule: any, cutoff: string): Promise<string[]> {
  // Sem produto: comportamento global antigo (last_activity_at do contato).
  if (!rule.product_id) {
    const { data } = await admin.from("contacts").select("id").eq("tenant_id", rule.tenant_id).lt("last_activity_at", cutoff).limit(500);
    return ((data as any[]) || []).map((c) => c.id);
  }
  // Com produto: "sem atividade NAQUELE produto há X dias" e sem cadência ativa nele.
  const doProduto = await contatosDoProduto(admin, rule.tenant_id, rule.product_id);
  if (!doProduto.size) return [];
  const ids = Array.from(doProduto);
  const ativos = await contatosAtivosNoProduto(admin, rule.tenant_id, rule.product_id);

  // última atividade no produto = mais recente entre: tarefa concluída de cadência do
  // produto, e atualização de oportunidade do produto.
  const ultima = new Map<string, string>(); // contact_id -> ISO
  const bump = (cid: string, ts?: string | null) => {
    if (!cid || !ts) return;
    const cur = ultima.get(cid);
    if (!cur || ts > cur) ultima.set(cid, ts);
  };

  // tarefas concluídas em enrollments de cadências do produto
  const { data: enr } = await admin
    .from("enrollments")
    .select("id, contact_id, started_at, sequences!inner(product_id)")
    .eq("tenant_id", rule.tenant_id)
    .eq("sequences.product_id", rule.product_id)
    .in("contact_id", ids);
  const enrByContact = new Map<string, string[]>();
  for (const e of (enr as any[]) || []) {
    bump(e.contact_id, e.started_at);
    const arr = enrByContact.get(e.contact_id) || [];
    arr.push(e.id);
    enrByContact.set(e.contact_id, arr);
  }
  const enrIds = ((enr as any[]) || []).map((e) => e.id);
  for (let i = 0; i < enrIds.length; i += 300) {
    const { data: tks } = await admin
      .from("tasks")
      .select("enrollment_id, completed_at")
      .in("enrollment_id", enrIds.slice(i, i + 300))
      .not("completed_at", "is", null);
    // mapa enrollment→contato
    const enrToContact = new Map<string, string>();
    for (const [cid, arr] of enrByContact) for (const eid of arr) enrToContact.set(eid, cid);
    for (const t of (tks as any[]) || []) bump(enrToContact.get(t.enrollment_id) || "", t.completed_at);
  }

  // oportunidades do produto
  const { data: opps } = await admin
    .from("opportunities")
    .select("primary_contact_id, updated_at")
    .eq("tenant_id", rule.tenant_id)
    .eq("product_id", rule.product_id)
    .in("primary_contact_id", ids);
  for (const o of (opps as any[]) || []) bump(o.primary_contact_id, o.updated_at);

  const out: string[] = [];
  for (const cid of ids) {
    if (ativos.has(cid)) continue; // já sendo trabalhado no produto
    const ts = ultima.get(cid);
    if (!ts || ts < cutoff) out.push(cid); // sem atividade no produto há >= X dias
  }
  return out;
}

// GATILHO cadence_completed: terminou a cadência (sem toques pendentes) e ficou X dias parado.
async function candidatosCadenciaTerminada(admin: DB, rule: any, cutoff: string): Promise<string[]> {
  // enrollments candidatos: da cadência de origem (source_seq) OU de qualquer cadência
  // do produto (product_id) OU quaisquer. Não pegamos os 'active' (ainda rodando).
  let q = admin
    .from("enrollments")
    .select("id, contact_id, started_at, status, sequences!inner(product_id)")
    .eq("tenant_id", rule.tenant_id)
    .neq("status", "active");
  if (rule.source_seq) q = q.eq("sequence_id", rule.source_seq);
  else if (rule.product_id) q = q.eq("sequences.product_id", rule.product_id);
  const { data: enr } = await q.limit(2000);
  const list = (enr as any[]) || [];
  if (!list.length) return [];

  const enrIds = list.map((e) => e.id);
  // tarefas dos enrollments: para saber se sobra alguma pendente e a última concluída
  const pend = new Map<string, boolean>();
  const ultimaTask = new Map<string, string>();
  for (let i = 0; i < enrIds.length; i += 300) {
    const { data: tks } = await admin
      .from("tasks")
      .select("enrollment_id, status, completed_at, due_date")
      .in("enrollment_id", enrIds.slice(i, i + 300));
    for (const t of (tks as any[]) || []) {
      if (t.status === "pending") pend.set(t.enrollment_id, true);
      const ts = t.completed_at || (t.due_date ? `${t.due_date}T00:00:00.000Z` : null);
      if (ts) {
        const cur = ultimaTask.get(t.enrollment_id);
        if (!cur || ts > cur) ultimaTask.set(t.enrollment_id, ts);
      }
    }
  }

  // contatos que já estão ativos no escopo → não recuperar
  const ativos = await contatosAtivosNoProduto(admin, rule.tenant_id, rule.product_id || null);

  // quem RESPONDEU no escopo (cadência de origem / produto) fica FORA da recuperação:
  // respondeu = engajou, não é um lead "esfriado". Vale para qualquer enrollment do
  // escopo cujo status seja 'replied'.
  const repliers = new Set<string>();
  for (const e of list) if (e.status === "replied") repliers.add(e.contact_id);

  const out = new Set<string>();
  for (const e of list) {
    if (pend.get(e.id)) continue;               // ainda tem toque pendente → não terminou
    if (ativos.has(e.contact_id)) continue;      // já sendo trabalhado
    if (repliers.has(e.contact_id)) continue;    // respondeu → engajou, não recupera
    const fim = ultimaTask.get(e.id) || e.started_at; // "fim" = última ação (ou início se sem tarefas)
    if (fim && fim < cutoff) out.add(e.contact_id);
  }
  return Array.from(out);
}

// GATILHO opportunity_lost / opportunity_won: oportunidade [do produto] nesse status há X dias.
async function candidatosOportunidade(admin: DB, rule: any, cutoff: string, status: "lost" | "won"): Promise<string[]> {
  let q = admin
    .from("opportunities")
    .select("primary_contact_id, updated_at")
    .eq("tenant_id", rule.tenant_id)
    .eq("status", status)
    .lt("updated_at", cutoff)
    .not("primary_contact_id", "is", null);
  if (rule.product_id) q = q.eq("product_id", rule.product_id);
  const { data } = await q.limit(500);
  const set = new Set<string>();
  for (const o of (data as any[]) || []) if (o?.primary_contact_id) set.add(o.primary_contact_id);
  return Array.from(set);
}

// Inscreve o contato e gera as tarefas — versão neutra de client (não usa auth).
async function enrollViaEngine(
  db: DB,
  { tenantId, contactId, sequenceId }: { tenantId: string; contactId: string; sequenceId: string }
) {
  const { data: enr } = await db
    .from("enrollments")
    .insert({ tenant_id: tenantId, contact_id: contactId, sequence_id: sequenceId, status: "active" })
    .select("id")
    .single();
  if (!enr) return;

  const { data: steps } = await db
    .from("sequence_steps")
    .select("channel, delay_days, subject, body_template, position")
    .eq("sequence_id", sequenceId)
    .order("position", { ascending: true });

  const { data: contact } = await db.from("contacts").select("name, company, assigned_to").eq("id", contactId).single();
  const firstName = (contact?.name || "").split(" ")[0] || "";
  const company = contact?.company || "";

  // resolve a caixa (override da cadência → rodízio no pool do produto → legada)
  const { resolveEmailBox } = await import("@/lib/caixas");
  const resolvedBox = await resolveEmailBox(db, tenantId, sequenceId);

  const today = new Date();
  const tasks = ((steps as any[]) || []).map((s) => {
    const due = new Date(today);
    due.setDate(due.getDate() + (Number(s.delay_days) || 0));
    const body = (s.body_template || "")
      .replace(/\{\{\s*primeiro_nome\s*\}\}/g, firstName)
      .replace(/\{\{\s*empresa\s*\}\}/g, company);
    return {
      tenant_id: tenantId,
      contact_id: contactId,
      enrollment_id: enr.id,
      assigned_to: contact?.assigned_to || null,
      channel: s.channel,
      title: s.subject || null,
      generated_content: body,
      due_date: due.toISOString().slice(0, 10),
      status: "pending",
      email_account_id: s.channel === "email" ? resolvedBox : null,
    };
  });
  if (tasks.length) await db.from("tasks").insert(tasks);
}
