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

export async function listTags() {
  const { supabase } = await ctx();
  const { data } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true });
  return { tags: (data as any[]) || [] };
}

export async function createTag(name: string, color?: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!name.trim()) return { error: "Nome da tag vazio." };
  const { data, error } = await supabase
    .from("tags")
    .insert({ tenant_id, name: name.trim(), color: color || "#4A3AFF" })
    .select("id, name, color")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "Já existe uma tag com esse nome." };
    return { error: error.message };
  }
  revalidatePath("/dashboard/contatos");
  return { ok: true, tag: data };
}

async function fireTagAutomation(supabase: any, tenant_id: string, contactId: string, tagId: string) {
  try {
    // gatilho tag_added filtrado pela tag específica (trigger_value = tag_id) ou "qualquer tag" (null)
    const { data: rules } = await supabase
      .from("automations")
      .select("id, trigger_type, trigger_value, action_type, action_seq, action_stage")
      .eq("tenant_id", tenant_id)
      .eq("is_active", true)
      .eq("trigger_type", "tag_added");
    const matching = ((rules as any[]) || []).filter((r) => !r.trigger_value || r.trigger_value === tagId);
    if (!matching.length) return;
    const { applyRule } = await import("@/lib/automations");
    for (const rule of matching) await applyRule(supabase, { tenantId: tenant_id, contactId, rule });
  } catch {
    /* automação não bloqueia a aplicação da tag */
  }
}

export async function addTagToContact(contactId: string, tagId: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase.from("contact_tags").insert({ tenant_id, contact_id: contactId, tag_id: tagId });
  if (error && error.code !== "23505") return { error: error.message };
  if (!error) await fireTagAutomation(supabase, tenant_id, contactId, tagId);
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}

export async function removeTagFromContact(contactId: string, tagId: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", tagId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}

// Aplica uma tag a vários contatos (lote) — dispara automação em cada um.
// Aplica UMA OU VÁRIAS tags a vários contatos de uma vez. Aceita string (compat) ou array.
export async function bulkTag(contactIds: string[], tags: string | string[]) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const tagIds = (Array.isArray(tags) ? tags : [tags]).filter(Boolean);
  if (!contactIds.length || !tagIds.length) return { error: "Selecione contatos e ao menos uma tag." };

  const rows = contactIds.flatMap((id) => tagIds.map((tagId) => ({ tenant_id, contact_id: id, tag_id: tagId })));
  await supabase.from("contact_tags").upsert(rows, { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
  // dispara a automação de "recebeu tag" para cada par (contato, tag)
  for (const id of contactIds.slice(0, 500)) {
    for (const tagId of tagIds) await fireTagAutomation(supabase, tenant_id, id, tagId);
  }
  revalidatePath("/dashboard/contatos");
  return { ok: true, count: contactIds.length, tags: tagIds.length };
}

// ---- Tags de EMPRESA (account_tags) ----
export async function addTagToAccount(accountId: string, tagId: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase.from("account_tags").upsert(
    { tenant_id, account_id: accountId, tag_id: tagId },
    { onConflict: "account_id,tag_id", ignoreDuplicates: true }
  );
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contas/${accountId}`);
  revalidatePath("/dashboard/contas");
  return { ok: true };
}

export async function removeTagFromAccount(accountId: string, tagId: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("account_tags").delete().eq("account_id", accountId).eq("tag_id", tagId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contas/${accountId}`);
  revalidatePath("/dashboard/contas");
  return { ok: true };
}
