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

  const { data: rules } = await db
    .from("automations")
    .select("id, trigger_type, trigger_value, action_type, action_seq, action_stage")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("trigger_type", trigger);

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
    if (ok) ran++;
  }
  return { ran };
}

/** Aplica UMA regra a um contato (ação + log). Reutilizado pelo cron (gatilhos de tempo). */
export async function applyRule(
  db: DB,
  { tenantId, contactId, rule }: { tenantId: string; contactId: string; rule: any }
): Promise<boolean> {
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
    await db.from("automation_logs").insert({
      tenant_id: tenantId,
      automation_id: rule.id,
      contact_id: contactId,
      detail: `${rule.trigger_type} → ${rule.action_type}`,
    });
  }
  return ok;
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
      await enrollViaEngine(db, { tenantId, contactId, sequenceId: rule.action_seq });
      return true;
    }
    default:
      return false;
  }
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
    };
  });
  if (tasks.length) await db.from("tasks").insert(tasks);
}
