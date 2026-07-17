"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { assistantReply, buildSystem, kbToContext, extractContact, type ChatMsg } from "@/lib/aichat";
import { notifyEscalation } from "@/lib/aiNotify";

const MAX_USER_MSGS = 40;

// Config da IA de suporte para inicializar o widget (saudação editável + on/off).
export async function supportGreeting(): Promise<{ enabled: boolean; greeting: string }> {
  const admin = createAdminClient();
  if (!admin) return { enabled: false, greeting: "" };
  const { data } = await admin.from("ai_assistants").select("enabled, greeting").eq("kind", "support").maybeSingle();
  return { enabled: !!(data as any)?.enabled, greeting: (data as any)?.greeting || "Como posso ajudar?" };
}

// Chat de SUPORTE (cliente logado). A IA responde com base na KB; quando não
// resolve, escala: cria um support_ticket com a transcrição (aparece no admin
// de suporte que já existe) + avisa por e-mail.
export async function supportChat(input: {
  conversationId?: string;
  message: string;
}): Promise<{ conversationId?: string; reply?: string; escalated?: boolean; error?: string }> {
  const message = (input.message || "").toString().trim();
  if (!message) return { error: "Escreva sua mensagem." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login para usar o suporte." };
  const { data: me } = await supabase
    .from("profiles")
    .select("tenant_id, full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  const tenant_id = ((me as any)?.tenant_id as string) || null;

  const admin = createAdminClient();
  if (!admin) return { error: "Suporte indisponível no momento." };

  const { data: asst } = await admin.from("ai_assistants").select("*").eq("kind", "support").maybeSingle();
  if (!asst || !(asst as any).enabled)
    return { error: "O atendimento por IA está desativado. Abra um chamado pelo botão abaixo." };

  // carrega ou cria a conversa
  let convId = input.conversationId;
  let history: ChatMsg[] = [];
  if (convId) {
    const { data: msgs } = await admin
      .from("ai_messages")
      .select("role, content")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    history = ((msgs as any[]) || [])
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
  } else {
    const { data: c } = await admin
      .from("ai_conversations")
      .insert({
        kind: "support",
        tenant_id,
        source: "app",
        visitor_name: (me as any)?.full_name || null,
        visitor_email: (me as any)?.email || null,
      })
      .select("id")
      .single();
    convId = (c as any)?.id;
  }
  if (!convId) return { error: "Não foi possível iniciar a conversa." };

  if (history.filter((m) => m.role === "user").length >= MAX_USER_MSGS) {
    return {
      conversationId: convId,
      reply: "Vou te passar para o time pra seguir com calma — sua conversa ficou registrada e retornamos pelo seu e-mail.",
      escalated: true,
    };
  }

  const msgs: ChatMsg[] = [...history, { role: "user", content: message }];

  const { data: arts } = await admin
    .from("kb_articles")
    .select("title, category, body")
    .eq("published", true)
    .limit(40);
  const system = buildSystem((asst as any).brain, kbToContext((arts as any[]) || []));

  const r = await assistantReply({ system, messages: msgs, model: (asst as any).model || undefined });
  if (r.error) return { conversationId: convId, error: r.error };
  const reply = r.text || "Desculpe, pode reformular a pergunta?";

  await admin.from("ai_messages").insert([
    { conversation_id: convId, role: "user", content: message },
    { conversation_id: convId, role: "assistant", content: reply },
  ]);
  await admin
    .from("ai_conversations")
    .update({ last_at: new Date().toISOString(), msg_count: msgs.length + 1 })
    .eq("id", convId);

  if (r.escalate) {
    const contact = extractContact(msgs);
    const transcript = [...msgs, { role: "assistant" as const, content: reply }]
      .map((m) => `${m.role === "user" ? "Cliente" : "IA"}: ${m.content}`)
      .join("\n");

    let ticketId: string | undefined;
    if (tenant_id) {
      const { data: t } = await admin
        .from("support_tickets")
        .insert({ tenant_id, opened_by: user.id, subject: "Atendimento via IA (encaminhado)", priority: "normal", status: "open" })
        .select("id")
        .single();
      ticketId = (t as any)?.id;
      if (ticketId)
        await admin.from("support_messages").insert({ ticket_id: ticketId, author_id: user.id, from_staff: false, body: transcript });
    }
    await admin
      .from("ai_conversations")
      .update({
        status: "escalated",
        ticket_id: ticketId || null,
        visitor_email: contact.email || (me as any)?.email || null,
        visitor_phone: contact.phone || null,
      })
      .eq("id", convId);

    await notifyEscalation({
      kind: "support",
      notifyEmail: (asst as any).notify_email,
      visitorName: (me as any)?.full_name,
      visitorEmail: contact.email || (me as any)?.email,
      visitorPhone: contact.phone,
      transcript,
      source: "app",
    });
    return { conversationId: convId, reply, escalated: true };
  }

  return { conversationId: convId, reply, escalated: false };
}
