"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null };
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

// Marca uma conversa como lida.
export async function markThreadRead(input: { contactId?: string | null; phone: string }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  await marcarLidas(supabase, tenant_id, input.contactId || null, input.phone);
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
