"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, role: data?.role as string, user_id: user?.id };
}

export async function assignContact(contactId: string, userId: string | null) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("contacts").update({ assigned_to: userId }).eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/equipe");
  return { ok: true };
}

// Distribui os contatos SEM responsável entre os membros ativos (round-robin).
export async function distributeUnassigned() {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Só o owner distribui." };

  const { data: members } = await supabase
    .from("profiles")
    .select("id")
    .eq("tenant_id", tenant_id)
    .eq("is_active", true);
  const ids = ((members as any[]) || []).map((m) => m.id);
  if (!ids.length) return { error: "Sem membros ativos." };

  const { data: unassigned } = await supabase
    .from("contacts")
    .select("id")
    .is("assigned_to", null)
    .limit(1000);
  const list = (unassigned as any[]) || [];
  if (!list.length) return { ok: true, distributed: 0 };

  let i = 0;
  for (const c of list) {
    await supabase.from("contacts").update({ assigned_to: ids[i % ids.length] }).eq("id", c.id);
    i++;
  }
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/equipe");
  return { ok: true, distributed: list.length };
}

// Marca duplicados por e-mail (mantém o mais antigo, marca os demais como 'duplicate').
export async function dedupeByEmail() {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Só o owner deduplica." };

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, email, created_at")
    .not("email", "is", null)
    .order("created_at", { ascending: true })
    .limit(5000);

  const seen = new Set<string>();
  const dups: string[] = [];
  for (const c of (contacts as any[]) || []) {
    const key = (c.email || "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) dups.push(c.id);
    else seen.add(key);
  }
  if (dups.length) {
    await supabase.from("contacts").update({ status: "duplicate" }).in("id", dups);
  }
  revalidatePath("/dashboard/contatos");
  return { ok: true, marked: dups.length };
}
