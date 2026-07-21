"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enrollContact } from "@/app/dashboard/cadencias/actions";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null };
}

export async function bulkAssign(contactIds: string[], userId: string | null) {
  const { supabase } = await ctx();
  if (!contactIds.length) return { error: "Nenhum contato selecionado." };
  const { error } = await supabase.from("contacts").update({ assigned_to: userId }).in("id", contactIds);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/equipe");
  return { ok: true, count: contactIds.length };
}

export async function bulkEnroll(contactIds: string[], sequenceId: string) {
  const { tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!contactIds.length) return { error: "Nenhum contato selecionado." };
  if (!sequenceId) return { error: "Escolha a cadência." };

  const ids = contactIds.slice(0, 500); // trava de segurança
  let enrolled = 0;
  let semDado = 0;      // sem e-mail nem telefone para os passos da cadência
  let jaInscrito = 0;   // já estava ativo/pausado nesta cadência
  let outros = 0;       // suprimido, erro etc.
  for (const id of ids) {
    const res = (await enrollContact(id, sequenceId)) as { ok?: boolean; error?: string; missingData?: boolean; already?: boolean };
    if (res?.ok) enrolled++;
    else if (res?.missingData) semDado++;
    else if (res?.already) jaInscrito++;
    else outros++;
  }
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard");
  return { ok: true, enrolled, semDado, jaInscrito, outros };
}
