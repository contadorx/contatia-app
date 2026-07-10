"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("tenant_id, is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, user_id: user?.id, tenant_id: (me as any)?.tenant_id as string | null, is_superadmin: !!(me as any)?.is_superadmin };
}

// Cliente abre um chamado (do próprio workspace) já com a 1ª mensagem.
export async function openTicket(input: { subject: string; body: string; priority?: string }) {
  const { supabase, user_id, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.subject.trim() || !input.body.trim()) return { error: "Preencha assunto e mensagem." };

  const { data: ticket, error } = await supabase
    .from("support_tickets")
    .insert({ tenant_id, opened_by: user_id, subject: input.subject.trim(), priority: input.priority || "normal", status: "open" })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await supabase.from("support_messages").insert({ ticket_id: (ticket as any).id, author_id: user_id, from_staff: false, body: input.body.trim() });
  revalidatePath("/dashboard/suporte");
  return { ok: true };
}

// Envia mensagem num ticket. from_staff = true quando é o superadmin respondendo.
export async function sendTicketMessage(ticketId: string, body: string) {
  const { supabase, user_id, is_superadmin } = await ctx();
  if (!body.trim()) return { error: "Mensagem vazia." };
  const { error } = await supabase.from("support_messages").insert({
    ticket_id: ticketId,
    author_id: user_id,
    from_staff: is_superadmin,
    body: body.trim(),
  });
  if (error) return { error: error.message };
  // atualiza carimbo + status: cliente responde → volta pra "open"; staff responde → "pending"
  await supabase.from("support_tickets").update({ last_message_at: new Date().toISOString(), status: is_superadmin ? "pending" : "open" }).eq("id", ticketId);
  revalidatePath("/dashboard/suporte");
  revalidatePath("/dashboard/superadmin/suporte");
  return { ok: true };
}

export async function setTicketStatus(ticketId: string, status: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("support_tickets").update({ status }).eq("id", ticketId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/suporte");
  revalidatePath("/dashboard/superadmin/suporte");
  return { ok: true };
}
