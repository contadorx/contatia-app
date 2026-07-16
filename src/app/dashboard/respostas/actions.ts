"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

// Cadastra um contato a partir de uma conversa (número desconhecido) e vincula as mensagens.
export async function createContactFromThread(input: { phone: string; name?: string }) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const phone = (input.phone || "").trim();
  if (!phone) return { error: "Conversa sem telefone." };
  const name = (input.name || "").trim() || phone;

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({ tenant_id, assigned_to: user_id, name, phone, origin: "WhatsApp", status: "novo" })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // vincula as mensagens desse número ao novo contato
  await supabase.from("whatsapp_messages").update({ contact_id: (created as any).id }).eq("tenant_id", tenant_id).eq("phone", phone).is("contact_id", null);

  revalidatePath("/dashboard/respostas");
  return { ok: true, contactId: (created as any).id };
}

// Bloqueia o número: o webhook passa a ignorar, e o contato (se houver) vira opt-out (LGPD).
export async function blockThread(input: { phone: string; contactId?: string | null }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const phone = (input.phone || "").trim();
  if (!phone) return { error: "Conversa sem telefone." };

  await supabase.from("whatsapp_blocklist").upsert({ tenant_id, phone }, { onConflict: "tenant_id,phone", ignoreDuplicates: true });
  if (input.contactId) {
    await supabase.from("contacts").update({ opted_out: true }).eq("id", input.contactId);
  }
  revalidatePath("/dashboard/respostas");
  return { ok: true };
}

// Remove a conversa da caixa (apaga as mensagens desse número/contato).
export async function deleteThread(input: { phone: string; contactId?: string | null }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  let q = supabase.from("whatsapp_messages").delete().eq("tenant_id", tenant_id);
  if (input.contactId) q = q.eq("contact_id", input.contactId);
  else q = q.eq("phone", (input.phone || "").trim()).is("contact_id", null);
  const { error } = await q;
  if (error) return { error: error.message };
  revalidatePath("/dashboard/respostas");
  return { ok: true };
}

// Busca a mídia de uma mensagem sob demanda (não armazena nada).
export async function fetchMedia(messageId: string): Promise<{ dataUrl?: string; error?: string }> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { data: msg } = await supabase
    .from("whatsapp_messages")
    .select("id, raw, media_mime, account_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return { error: "Mensagem não encontrada." };
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance")
    .eq("id", (msg as any).account_id)
    .maybeSingle();
  if (!acc) return { error: "Instância não encontrada (a mídia vem do servidor do WhatsApp)." };

  const { getMediaBase64 } = await import("@/lib/whatsapp");
  const r = await getMediaBase64(acc as any, (msg as any).raw);
  if (r.error || !r.base64) return { error: r.error || "Mídia indisponível (pode ter expirado no WhatsApp)." };
  const mime = r.mimetype || (msg as any).media_mime || "application/octet-stream";
  return { dataUrl: `data:${mime};base64,${r.base64}` };
}

// Responde uma conversa pelo WhatsApp (envio automático — só no modo Evolution).
export async function replyWhatsApp(input: { contactId?: string | null; phone: string; text: string }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const text = (input.text || "").trim();
  if (!text) return { error: "Escreva uma mensagem." };
  if (!input.phone) return { error: "Conversa sem número de telefone." };

  // envio automático só existe no modo Evolution
  const { data: t } = await supabase.from("tenants").select("whatsapp_mode").eq("id", tenant_id).maybeSingle();
  if (((t as any)?.whatsapp_mode || "assistido") !== "evolution") {
    return { error: "No modo assistido a resposta é manual: use o botão “Abrir WhatsApp”. Ative o modo automático em Config → WhatsApp para responder daqui." };
  }

  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("id, evolution_url, api_key, instance")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!acc) return { error: "Nenhuma instância WhatsApp conectada." };

  const { sendText } = await import("@/lib/whatsapp");
  const res = await sendText(acc as any, input.phone, text);
  if (res.error) return { error: res.error };

  await supabase.from("whatsapp_messages").insert({
    tenant_id,
    account_id: (acc as any).id,
    contact_id: input.contactId || null,
    phone: input.phone,
    direction: "out",
    text,
  });

  // ao responder, marca as recebidas dessa conversa como lidas
  await marcarLidas(supabase, tenant_id, input.contactId || null, input.phone);

  revalidatePath("/dashboard/respostas");
  return { ok: true };
}

// Marca uma conversa como lida (WhatsApp ou e-mail).
export async function markThreadRead(input: { contactId?: string | null; phone?: string; email?: string; channel?: "whatsapp" | "email" }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (input.channel === "email") {
    let q = supabase.from("email_messages").update({ read_at: new Date().toISOString() }).eq("tenant_id", tenant_id).eq("direction", "in").is("read_at", null);
    if (input.contactId) q = q.eq("contact_id", input.contactId);
    else q = q.eq("email", (input.email || "").toLowerCase());
    await q;
  } else {
    await marcarLidas(supabase, tenant_id, input.contactId || null, input.phone || "");
  }
  revalidatePath("/dashboard/respostas");
  return { ok: true };
}

// Responde uma conversa por E-MAIL (reaproveita o envio avulso: rotação/assinatura/cap).
export async function replyEmail(input: { contactId: string; subject: string; body: string }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const subject = (input.subject || "").trim() || "Re:";
  const body = (input.body || "").trim();
  if (!body) return { error: "Escreva a resposta." };
  if (!input.contactId) return { error: "Vincule o contato para responder por e-mail." };

  const { sendQuickEmail } = await import("@/app/dashboard/contatos/quick-send-actions");
  const r = (await sendQuickEmail(input.contactId, subject, body)) as any;
  if (r?.error) return { error: r.error };

  const { data: c } = await supabase.from("contacts").select("email").eq("id", input.contactId).maybeSingle();
  const { looksHtml, stripTags } = await import("@/lib/richtext");
  const logText = looksHtml(body) ? stripTags(body) : body; // histórico legível, sem tags
  await supabase.from("email_messages").insert({ tenant_id, contact_id: input.contactId, email: (c as any)?.email || null, direction: "out", subject, text: logText });
  await supabase.from("email_messages").update({ read_at: new Date().toISOString() }).eq("tenant_id", tenant_id).eq("contact_id", input.contactId).eq("direction", "in").is("read_at", null);
  revalidatePath("/dashboard/respostas");
  return { ok: true };
}

async function marcarLidas(supabase: any, tenant_id: string, contactId: string | null, phone: string) {
  const now = new Date().toISOString();
  let q = supabase
    .from("whatsapp_messages")
    .update({ read_at: now })
    .eq("tenant_id", tenant_id)
    .eq("direction", "in")
    .is("read_at", null);
  if (contactId) q = q.eq("contact_id", contactId);
  else q = q.eq("phone", phone);
  await q;
}
