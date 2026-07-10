"use server";

import { createClient } from "@/lib/supabase/server";

// Busca artigos publicados por termo (título, categoria, keywords, corpo).
export async function searchKb(query: string) {
  const supabase = createClient();
  let q = supabase
    .from("kb_articles")
    .select("id, title, category, body")
    .eq("published", true)
    .order("category", { ascending: true })
    .order("position", { ascending: true })
    .limit(50);

  const term = (query || "").trim();
  if (term) {
    // busca simples em vários campos
    const like = `%${term}%`;
    q = q.or(`title.ilike.${like},category.ilike.${like},keywords.ilike.${like},body.ilike.${like}`);
  }

  const { data, error } = await q;
  if (error) return { error: error.message };
  return { ok: true, articles: (data as any[]) || [] };
}
