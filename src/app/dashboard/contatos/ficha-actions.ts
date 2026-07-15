"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { scoreEvent } from "@/lib/scoring";

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

// Registra um TOQUE MANUAL (ligação, WhatsApp por fora, etc.) — alimenta score e último toque.
export async function registrarToque(contactId: string, input: { canal: string; texto?: string }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!contactId) return { error: "Contato inválido." };

  const canal = (input.canal || "").trim() || "Contato";
  const texto = (input.texto || "").trim();
  const label = texto ? `${canal} — ${texto}` : canal;

  // type "task_done" (2 pts) = toque executado → soma score + atualiza last_activity_at
  await scoreEvent(supabase, {
    tenant_id,
    contact_id: contactId,
    type: "task_done",
    meta: { manual: true, canal, text: label },
  });

  revalidatePath(`/dashboard/contatos/${contactId}`);
  return { ok: true };
}

// Cria uma oportunidade a partir da ficha do contato (vinculada à empresa dele, se houver).
export async function createOpportunityForContact(contactId: string, input: { title?: string; value_mrr?: number }) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: c } = await supabase.from("contacts").select("id, name, company, account_id").eq("id", contactId).maybeSingle();
  if (!c) return { error: "Contato não encontrado." };
  const title = (input.title || "").trim() || (c as any).company || (c as any).name;

  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("is_won", false)
    .eq("is_lost", false)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!stage) return { error: "Crie ao menos um estágio no Pipeline antes." };

  const { error } = await supabase.from("opportunities").insert({
    tenant_id,
    title,
    account_id: (c as any).account_id || null,
    primary_contact_id: contactId,
    owner_id: user_id ?? null,
    stage_id: (stage as any).id,
    status: "open",
    value_mrr: Number(input.value_mrr) || 0,
  });
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/contatos/${contactId}`);
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}
