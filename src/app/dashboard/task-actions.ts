"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { scoreEvent } from "@/lib/scoring";
import { renderTemplate } from "@/lib/cadence";
import { buildEmailHtml } from "@/lib/richtext";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

export async function completeTask(id: string, contactId?: string) {
  const { supabase, tenant_id } = await ctx();
  const { error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  if (tenant_id && contactId) await scoreEvent(supabase, { tenant_id, contact_id: contactId, type: "task_done" });
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function skipTask(id: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("tasks").update({ status: "skipped" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function snoozeTask(id: string, days: number) {
  const { supabase } = await ctx();
  const d = new Date();
  d.setDate(d.getDate() + (days || 1));
  const { error } = await supabase
    .from("tasks")
    .update({ due_date: d.toISOString().slice(0, 10) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

// Marca que o contato RESPONDEU: pausa a(s) sequência(s), cancela toques futuros
// pendentes e pontua alto (fica quente). É o "respondeu → pausa" manual (WhatsApp/
// ligação/LinkedIn) enquanto a detecção automática de e-mail não entra.
export async function markReplied(contactId: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: enrs } = await supabase
    .from("enrollments")
    .select("id")
    .eq("contact_id", contactId)
    .eq("status", "active");
  const ids = ((enrs as any[]) || []).map((e) => e.id);
  if (ids.length) {
    await supabase.from("enrollments").update({ status: "replied" }).in("id", ids);
    await supabase.from("tasks").update({ status: "skipped" }).in("enrollment_id", ids).eq("status", "pending");
  }
  await scoreEvent(supabase, { tenant_id, contact_id: contactId, type: "replied" });
  try {
    const { runAutomations } = await import("@/lib/automations");
    await runAutomations(supabase, { tenantId: tenant_id, contactId, trigger: "replied" });
  } catch {
    /* automação não deve quebrar o fluxo */
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---- Envio de e-mail real (SMTP/Gmail) a partir de uma tarefa da fila ----
export async function sendEmailTask(taskId: string, override?: { subject?: string; body?: string }) {
  const { sendEmail } = await import("@/lib/mailer");
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  // se veio corpo/assunto editado, persiste na task antes de enviar
  if (override && (override.subject !== undefined || override.body !== undefined)) {
    const patch: Record<string, unknown> = {};
    if (override.subject !== undefined) patch.title = override.subject;
    if (override.body !== undefined) patch.generated_content = override.body;
    if (Object.keys(patch).length) await supabase.from("tasks").update(patch).eq("id", taskId);
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("id, channel, title, generated_content, contact_id, email_account_id, contacts(email, name, email_status)")
    .eq("id", taskId)
    .single();
  if (!task) return { error: "Tarefa não encontrada." };
  if (task.channel !== "email") return { error: "Tarefa não é de e-mail." };
  const to = (task as any).contacts?.email as string | undefined;
  if (!to) {
    // contato sem e-mail: pula a tarefa (não fica pendente para sempre) — cobre também
    // tarefas criadas antes do gate de inscrição.
    await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId);
    return { error: "Contato sem e-mail. Tarefa de e-mail pulada." };
  }

  // não envia para e-mail marcado como inválido/bounce (protege reputação)
  const estatus = (task as any).contacts?.email_status as string | undefined;
  if (estatus && ["invalid", "hard_bounce", "complaint"].includes(estatus)) {
    await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId);
    return { error: `E-mail marcado como "${estatus}". Envio bloqueado para proteger sua reputação.` };
  }

  // proteção de reputação: não envia para e-mail suprimido (bounce/spam/unsubscribe)
  const { data: supp } = await supabase
    .from("email_suppressions")
    .select("reason")
    .eq("tenant_id", tenant_id)
    .eq("email", to.toLowerCase())
    .maybeSingle();
  if (supp) {
    // marca a task como pulada para não insistir e proteger o domínio
    await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId);
    return { error: `E-mail na lista de supressão (${(supp as any).reason}). Envio bloqueado para proteger sua reputação.` };
  }

  // ROTAÇÃO DE CAIXAS: busca todas as caixas ativas e escolhe a com mais folga hoje
  // (cap efetivo do dia − enviados hoje). Distribui a carga e protege cada domínio.
  const { data: accts } = await supabase
    .from("email_accounts")
    .select("id, provider, from_email, display_name, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, oauth_refresh_token, daily_cap, created_at, warmup_stage, signature")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (!accts || !accts.length) return { error: "Nenhuma caixa de e-mail conectada. Configure em Config." };

  // meia-noite BRT (UTC-3, fixo): o servidor roda em UTC — sem isso o "dia" do cap
  // diário resetaria às 21h de Brasília e a caixa poderia enviar 2x o limite num dia real.
  const BRT_OFFSET_MS = 3 * 3600000;
  const nowBRT = new Date(Date.now() - BRT_OFFSET_MS);
  const startOfDay = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate()) + BRT_OFFSET_MS);
  const { effectiveDailyCap } = await import("@/lib/warmup");

  // contagem de enviados hoje por caixa
  const { data: sentToday } = await supabase
    .from("events")
    .select("email_account_id")
    .eq("type", "email_sent")
    .gte("created_at", startOfDay.toISOString());
  const sentByAcct: Record<string, number> = {};
  for (const e of (sentToday as any[]) || []) {
    const id = e.email_account_id;
    if (id) sentByAcct[id] = (sentByAcct[id] || 0) + 1;
  }

  // escolhe a caixa com maior folga
  let acct: any = null;
  let bestSlack = -1;
  let anyWarming = false;
  for (const a of accts as any[]) {
    const warmupOn = (a.warmup_stage ?? 0) !== -1;
    const { cap, warming } = effectiveDailyCap(a.created_at, a.daily_cap ?? 40, warmupOn);
    const used = sentByAcct[a.id] || 0;
    const slack = cap - used;
    if (warming) anyWarming = true;
    if (slack > bestSlack) { bestSlack = slack; acct = a; }
  }

  // CAIXA DESIGNADA (produto/cadência): se a tarefa foi carimbada com uma caixa e
  // ela está ativa e com folga hoje, envia POR ELA (mantém a marca certa). Se estiver
  // inativa ou sem folga, cai no rodízio acima (degradação segura — o e-mail sai).
  const desiredBoxId = (task as any).email_account_id as string | null;
  if (desiredBoxId) {
    const d = (accts as any[]).find((a) => a.id === desiredBoxId);
    if (d) {
      const warmupOn = (d.warmup_stage ?? 0) !== -1;
      const { cap } = effectiveDailyCap(d.created_at, d.daily_cap ?? 40, warmupOn);
      const dSlack = cap - (sentByAcct[d.id] || 0);
      if (dSlack > 0) { acct = d; bestSlack = dSlack; }
    }
  }

  if (!acct || bestSlack <= 0) {
    return { error: anyWarming
      ? "Limite de envio de hoje atingido em todas as caixas (algumas ainda em aquecimento). Tente amanhã ou conecte outra caixa."
      : "Limite diário atingido em todas as caixas (Envio Seguro). Tente amanhã ou conecte outra caixa." };
  }

  // reescreve links para rastreados (ativa o gatilho link_clicked)
  let bodyText = task.generated_content || "";
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL ? (process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`) : "";
    if (baseUrl) {
      const { wrapLinks } = await import("@/lib/linktrack");
      bodyText = await wrapLinks(supabase, { tenantId: tenant_id, contactId: (task as any).contact_id ?? null, body: bodyText, baseUrl });
    }
  } catch {
    /* rastreio de link não deve bloquear o envio */
  }

  // assinatura do negócio (renderiza {{primeiro_nome}}/{{empresa}} com os dados do contato)
  const { data: tnt } = await supabase.from("tenants").select("email_signature").maybeSingle();
  // assinatura DA CAIXA que enviou; se vazia, cai na assinatura geral do workspace
  const boxSig = (acct as any)?.signature as string | undefined;
  const signature = (boxSig && boxSig.trim()) ? boxSig : ((tnt as any)?.email_signature as string | undefined);
  const contact = (task as any).contacts || {};
  const sigRendered = signature?.trim() ? renderTemplate(signature, { name: contact.name, company: null, ...contact }) : "";
  // Monta o corpo final (corpo + assinatura), ciente de HTML: se o corpo OU a
  // assinatura tiverem formatação, vai como HTML; senão, texto puro (legado).
  const built = buildEmailHtml(bodyText, sigRendered);
  const html = built.html;
  bodyText = built.text;

  try {
    await sendEmail(acct as any, { to, subject: task.title || "", text: bodyText, html });
  } catch (e: any) {
    return { error: "Falha no envio: " + (e?.message || "erro desconhecido") };
  }

  await supabase.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", taskId);
  await scoreEvent(supabase, {
    tenant_id,
    contact_id: (task as any).contact_id,
    type: "email_sent",
    email_account_id: (acct as any).id,
    meta: { to },
  });
  revalidatePath("/dashboard");
  return { ok: true };
}

// Envia a tarefa de WhatsApp via Evolution API (caixa ativa do tenant), com cap diário.
export async function sendWhatsAppTask(taskId: string, overrideBody?: string) {
  const { sendText } = await import("@/lib/whatsapp");
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  // envio automático só no modo Evolution; no assistido o envio é manual pelo link
  const { data: tmode } = await supabase.from("tenants").select("whatsapp_mode").eq("id", tenant_id).maybeSingle();
  if (((tmode as any)?.whatsapp_mode || "assistido") !== "evolution") {
    return { error: "Modo assistido: abra o link do WhatsApp para enviar (botão “Abrir WhatsApp”)." };
  }

  if (overrideBody !== undefined) {
    await supabase.from("tasks").update({ generated_content: overrideBody }).eq("id", taskId);
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("id, channel, generated_content, contact_id, contacts(phone, name)")
    .eq("id", taskId)
    .single();
  if (!task) return { error: "Tarefa não encontrada." };
  if (task.channel !== "whatsapp") return { error: "Tarefa não é de WhatsApp." };
  const phone = (task as any).contacts?.phone as string | undefined;
  if (!phone) return { error: "Contato sem telefone." };

  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("id, evolution_url, api_key, instance, daily_cap")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!acc) return { error: "Nenhuma instância WhatsApp conectada. Configure em Config." };

  // meia-noite BRT (UTC-3, fixo): o servidor roda em UTC — sem isso o "dia" do cap
  // diário resetaria às 21h de Brasília e a caixa poderia enviar 2x o limite num dia real.
  const BRT_OFFSET_MS = 3 * 3600000;
  const nowBRT = new Date(Date.now() - BRT_OFFSET_MS);
  const startOfDay = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate()) + BRT_OFFSET_MS);
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("type", "whatsapp_sent")
    .gte("created_at", startOfDay.toISOString());
  if ((count ?? 0) >= ((acc as any).daily_cap ?? 40)) {
    return { error: "Limite diário de WhatsApp atingido (anti-ban). Tente amanhã." };
  }

  const res = await sendText(acc as any, phone, task.generated_content || "");
  if (res.error) return { error: res.error };

  await supabase.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", taskId);
  await scoreEvent(supabase, { tenant_id, contact_id: (task as any).contact_id, type: "task_done" });
  await supabase.from("events").insert({ tenant_id, type: "whatsapp_sent", contact_id: (task as any).contact_id, meta: {} });
  // guarda a mensagem enviada na conversa (para a caixa de Respostas mostrar os dois lados)
  await supabase.from("whatsapp_messages").insert({
    tenant_id,
    account_id: (acc as any).id,
    contact_id: (task as any).contact_id,
    phone,
    direction: "out",
    text: task.generated_content || "",
  });
  revalidatePath("/dashboard");
  return { ok: true };
}

// Envia TODAS as tarefas de e-mail pendentes de hoje, respeitando o cap diário.
export async function sendAllEmailTasks() {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const today = new Date().toISOString().slice(0, 10);
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("channel", "email")
    .eq("status", "pending")
    .lte("due_date", today)
    .limit(500);
  const ids = ((tasks as any[]) || []).map((t) => t.id);
  if (!ids.length) return { ok: true, sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    const res = (await sendEmailTask(id)) as { ok?: boolean; error?: string };
    if (res?.ok) sent++;
    else failed++;
  }
  revalidatePath("/dashboard");
  return { ok: true, sent, failed };
}

// Conclui várias tarefas de uma vez (fila sequencial por tipo — ex.: todos os LinkedIn).
export async function completeTasks(ids: string[]) {
  const { supabase, tenant_id } = await ctx();
  if (!ids.length) return { ok: true, done: 0 };
  const list = ids.slice(0, 300);
  // pega os contatos para pontuar
  const { data: tks } = await supabase.from("tasks").select("id, contact_id").in("id", list);
  const { error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .in("id", list)
    .eq("status", "pending");
  if (error) return { error: error.message };
  if (tenant_id) {
    for (const t of ((tks as any[]) || [])) {
      if (t.contact_id) await scoreEvent(supabase, { tenant_id, contact_id: t.contact_id, type: "task_done" });
    }
  }
  revalidatePath("/dashboard");
  return { ok: true, done: list.length };
}
