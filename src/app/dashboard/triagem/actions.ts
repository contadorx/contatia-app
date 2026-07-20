"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data as any)?.tenant_id as string | null, user_id: user?.id };
}

async function loadItem(supabase: any, tenant_id: string, id: string) {
  const { data } = await supabase.from("reply_triage").select("id, contact_id, status").eq("id", id).eq("tenant_id", tenant_id).maybeSingle();
  return data as any;
}

async function finish(supabase: any, id: string, user_id: string | undefined, status: "done" | "dismissed", resolution: string) {
  await supabase.from("reply_triage").update({ status, resolution, resolved_at: new Date().toISOString(), resolved_by: user_id || null }).eq("id", id);
  revalidatePath("/dashboard/triagem");
}

// Encerra as cadências ativas do contato (transição limpa).
async function endActive(supabase: any, tenant_id: string, contactId: string) {
  await supabase.from("enrollments").update({ status: "stopped" }).eq("tenant_id", tenant_id).eq("contact_id", contactId).eq("status", "active");
  await supabase.from("tasks").update({ status: "skipped" }).eq("tenant_id", tenant_id).eq("contact_id", contactId).eq("status", "pending");
}

// SUPRIMIR (parar definitivo): encerra tudo, marca opt-out e estado suprimido.
export async function triageSuppress(id: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const item = await loadItem(supabase, tenant_id, id);
  if (!item) return { error: "Item não encontrado." };
  await endActive(supabase, tenant_id, item.contact_id);
  await supabase.from("contacts").update({ opted_out: true, auto_state: "suprimido", auto_state_at: new Date().toISOString() }).eq("id", item.contact_id);
  await finish(supabase, id, user_id, "done", "Suprimido");
  return { ok: true };
}

// INSCREVER numa cadência (transição limpa opcional + estado). Cobre "Aprofundar (A)".
export async function triageEnroll(id: string, sequenceId: string, opts?: { endCurrent?: boolean; setState?: string }) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!sequenceId) return { error: "Escolha a cadência." };
  const item = await loadItem(supabase, tenant_id, id);
  if (!item) return { error: "Item não encontrado." };
  if (opts?.endCurrent !== false) await endActive(supabase, tenant_id, item.contact_id);
  const { enrollContact } = await import("@/app/dashboard/cadencias/actions");
  const r = (await enrollContact(item.contact_id, sequenceId)) as any;
  if (r?.error) return { error: r.error };
  if (opts?.setState) await supabase.from("contacts").update({ auto_state: opts.setState, auto_state_at: new Date().toISOString() }).eq("id", item.contact_id);
  await finish(supabase, id, user_id, "done", "Inscrito em cadência");
  return { ok: true };
}

// ANOTAR RETOMADA (adiamento): guarda a data, marca estado em_C, encerra a atual e
// inscreve na cadência escolhida (a retomada agendada na data é da Fase 2).
export async function triageRetomada(id: string, sequenceId: string, dateISO: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!dateISO) return { error: "Escolha a data de retomada." };
  if (!sequenceId) return { error: "Escolha a cadência de adiamento." };
  const item = await loadItem(supabase, tenant_id, id);
  if (!item) return { error: "Item não encontrado." };
  await supabase.from("contacts").update({ retomar_em: dateISO, auto_state: "em_C", auto_state_at: new Date().toISOString() }).eq("id", item.contact_id);
  await endActive(supabase, tenant_id, item.contact_id);
  const { enrollContact } = await import("@/app/dashboard/cadencias/actions");
  const r = (await enrollContact(item.contact_id, sequenceId)) as any;
  if (r?.error) return { error: r.error };
  await finish(supabase, id, user_id, "done", `Retomada em ${dateISO}`);
  return { ok: true };
}

// IGNORAR: tira da fila sem ação.
export async function triageDismiss(id: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const item = await loadItem(supabase, tenant_id, id);
  if (!item) return { error: "Item não encontrado." };
  await finish(supabase, id, user_id, "dismissed", "Ignorado");
  return { ok: true };
}
