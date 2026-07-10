"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data as any)?.tenant_id as string | null, user_id: user?.id };
}

// Aprova a sugestão: cria o contato (se ainda não existir) e marca como adicionada.
export async function approveSuggestion(id: string, name?: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { data: s } = await supabase.from("contact_suggestions").select("email, name").eq("id", id).maybeSingle();
  if (!s) return { error: "Sugestão não encontrada." };
  const email = (s as any).email as string;

  // já existe contato com esse e-mail?
  const { data: exists } = await supabase.from("contacts").select("id").eq("tenant_id", tenant_id).eq("email", email).limit(1).maybeSingle();
  if (!exists) {
    const finalName = (name || (s as any).name || email.split("@")[0]).trim();
    const { error } = await supabase.from("contacts").insert({
      tenant_id,
      assigned_to: user_id,
      name: finalName,
      email,
      origin: "Respondeu (e-mail)",
      status: "new",
      email_status: "ok",
    });
    if (error) return { error: error.message };
  }
  await supabase.from("contact_suggestions").update({ status: "added" }).eq("id", id);
  revalidatePath("/dashboard/contatos/sugestoes");
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}

export async function dismissSuggestion(id: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("contact_suggestions").update({ status: "dismissed" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contatos/sugestoes");
  return { ok: true };
}
