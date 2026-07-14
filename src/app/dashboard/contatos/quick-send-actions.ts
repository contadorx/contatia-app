"use server";

// Envio AVULSO (fora de cadência): mandar um e-mail ou WhatsApp pontual para um
// contato — ex.: enviar uma proposta no meio da cadência sem criar um passo. Reaproveita
// a rotação de caixas / cap diário / supressão / assinatura do envio da fila, registra o
// toque na timeline, e NÃO mexe na cadência ativa do contato.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { scoreEvent } from "@/lib/scoring";
import { renderTemplate, waLink } from "@/lib/cadence";

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

export async function sendQuickEmail(contactId: string, subject: string, body: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!subject.trim() || !body.trim()) return { error: "Preencha assunto e mensagem." };

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, email, email_status")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return { error: "Contato não encontrado." };
  const to = (contact as any).email as string | undefined;
  if (!to) return { error: "Contato sem e-mail." };

  // proteções de reputação (iguais ao envio da fila)
  const estatus = (contact as any).email_status as string | undefined;
  if (estatus && ["invalid", "hard_bounce", "complaint"].includes(estatus)) {
    return { error: `E-mail marcado como "${estatus}". Envio bloqueado para proteger sua reputação.` };
  }
  const { data: supp } = await supabase.from("email_suppressions").select("reason").eq("tenant_id", tenant_id).eq("email", to.toLowerCase()).maybeSingle();
  if (supp) return { error: `E-mail na lista de supressão (${(supp as any).reason}). Envio bloqueado.` };

  // rotação de caixas + cap diário (mesma lógica da fila)
  const { data: accts } = await supabase
    .from("email_accounts")
    .select("id, provider, from_email, display_name, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, oauth_refresh_token, daily_cap, created_at, warmup_stage")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (!accts || !accts.length) return { error: "Nenhuma caixa de e-mail conectada. Configure em Config." };

  const BRT_OFFSET_MS = 3 * 3600000;
  const nowBRT = new Date(Date.now() - BRT_OFFSET_MS);
  const startOfDay = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate()) + BRT_OFFSET_MS);
  const { effectiveDailyCap } = await import("@/lib/warmup");
  const { data: sentToday } = await supabase.from("events").select("email_account_id").eq("type", "email_sent").gte("created_at", startOfDay.toISOString());
  const sentByAcct: Record<string, number> = {};
  for (const e of (sentToday as any[]) || []) { const id = e.email_account_id; if (id) sentByAcct[id] = (sentByAcct[id] || 0) + 1; }

  let acct: any = null; let bestSlack = -1; let anyWarming = false;
  for (const a of accts as any[]) {
    const warmupOn = (a.warmup_stage ?? 0) !== -1;
    const { cap, warming } = effectiveDailyCap(a.created_at, a.daily_cap ?? 40, warmupOn);
    const slack = cap - (sentByAcct[a.id] || 0);
    if (warming) anyWarming = true;
    if (slack > bestSlack) { bestSlack = slack; acct = a; }
  }
  if (!acct || bestSlack <= 0) {
    return { error: anyWarming
      ? "Limite de envio de hoje atingido em todas as caixas (algumas em aquecimento). Tente amanhã ou conecte outra caixa."
      : "Limite diário atingido em todas as caixas (Envio Seguro). Tente amanhã." };
  }

  // links rastreados
  let bodyText = body;
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    if (baseUrl) {
      const { wrapLinks } = await import("@/lib/linktrack");
      bodyText = await wrapLinks(supabase, { tenantId: tenant_id, contactId, body: bodyText, baseUrl });
    }
  } catch { /* rastreio não bloqueia o envio */ }

  // assinatura do negócio
  const { data: tnt } = await supabase.from("tenants").select("email_signature").maybeSingle();
  const signature = (tnt as any)?.email_signature as string | undefined;
  const sigRendered = signature?.trim() ? renderTemplate(signature, { name: (contact as any).name, company: null, ...(contact as any) }) : "";
  const sigIsHtml = /<[a-z][\s\S]*>/i.test(sigRendered);
  let html: string | undefined;
  if (sigRendered) {
    if (sigIsHtml) {
      const bodyHtml = bodyText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#16172A;line-height:1.5">${bodyHtml}<br><br>${sigRendered}</div>`;
      bodyText = `${bodyText}\n\n${sigRendered.replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n").trim()}`;
    } else {
      bodyText = `${bodyText}\n\n${sigRendered}`;
    }
  }

  const { sendEmail } = await import("@/lib/mailer");
  try {
    await sendEmail(acct as any, { to, subject: subject.trim(), text: bodyText, html });
  } catch (e: any) {
    return { error: "Falha no envio: " + (e?.message || "erro desconhecido") };
  }

  await scoreEvent(supabase, { tenant_id, contact_id: contactId, type: "email_sent", email_account_id: (acct as any).id, meta: { to, avulso: true } });
  revalidatePath(`/dashboard/contatos/${contactId}`);
  return { ok: true, from: (acct as any).from_email };
}

export async function sendQuickWhatsApp(contactId: string, body: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!body.trim()) return { error: "Escreva a mensagem." };

  const { data: contact } = await supabase.from("contacts").select("id, name, phone").eq("id", contactId).maybeSingle();
  if (!contact) return { error: "Contato não encontrado." };
  const phone = (contact as any).phone as string | undefined;
  if (!phone) return { error: "Contato sem telefone." };

  const { data: tmode } = await supabase.from("tenants").select("whatsapp_mode").eq("id", tenant_id).maybeSingle();
  const mode = (tmode as any)?.whatsapp_mode || "assistido";

  // modo ASSISTIDO: devolve o link do WhatsApp (o usuário abre e envia)
  if (mode !== "evolution") {
    return { ok: true, link: waLink(phone, body), assisted: true };
  }

  // modo EVOLUTION: envia direto pela instância, respeitando o cap diário
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("id, evolution_url, api_key, instance, daily_cap")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!acc) return { error: "Nenhuma instância WhatsApp conectada. Configure em Config." };

  const BRT_OFFSET_MS = 3 * 3600000;
  const nowBRT = new Date(Date.now() - BRT_OFFSET_MS);
  const startOfDay = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate()) + BRT_OFFSET_MS);
  const { count } = await supabase.from("events").select("id", { count: "exact", head: true }).eq("type", "whatsapp_sent").gte("created_at", startOfDay.toISOString());
  if ((count ?? 0) >= ((acc as any).daily_cap ?? 40)) return { error: "Limite diário de WhatsApp atingido (anti-ban). Tente amanhã." };

  const { sendText } = await import("@/lib/whatsapp");
  const res = await sendText(acc as any, phone, body);
  if (res.error) return { error: res.error };

  await supabase.from("events").insert({ tenant_id, type: "whatsapp_sent", contact_id: contactId, meta: { avulso: true } });
  await supabase.from("whatsapp_messages").insert({ tenant_id, account_id: (acc as any).id, contact_id: contactId, phone, direction: "out", text: body });
  revalidatePath(`/dashboard/contatos/${contactId}`);
  return { ok: true };
}
