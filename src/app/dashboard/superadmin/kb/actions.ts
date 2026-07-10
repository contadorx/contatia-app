"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function guard() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, ok: !!(data as any)?.is_superadmin };
}

export async function saveArticle(input: { id?: string; title: string; category: string; body: string; keywords?: string; position?: number; published?: boolean }) {
  const { supabase, ok } = await guard();
  if (!ok) return { error: "Apenas administradores da plataforma." };
  if (!input.title.trim()) return { error: "Dê um título." };
  const patch = {
    title: input.title.trim(),
    category: input.category.trim() || "Geral",
    body: input.body || "",
    keywords: input.keywords || "",
    position: Number(input.position) || 0,
    published: input.published ?? true,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await supabase.from("kb_articles").update(patch).eq("id", input.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("kb_articles").insert(patch);
    if (error) return { error: error.message };
  }
  revalidatePath("/dashboard/superadmin/kb");
  return { ok: true };
}

export async function deleteArticle(id: string) {
  const { supabase, ok } = await guard();
  if (!ok) return { error: "Apenas administradores da plataforma." };
  const { error } = await supabase.from("kb_articles").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/kb");
  return { ok: true };
}
