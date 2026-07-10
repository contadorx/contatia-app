"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

// Sobe um PDF para o Storage (bucket 'proposals') e cria o documento.
export async function uploadDocument(form: FormData) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const name = String(form.get("name") || "").trim();
  const type = String(form.get("type") || "proposta");
  const file = form.get("file") as File | null;
  if (!name) return { error: "Dê um nome ao documento." };
  if (!file || typeof file === "string") return { error: "Selecione um arquivo PDF." };
  if (file.type !== "application/pdf") return { error: "Só aceitamos PDF por enquanto." };
  if (file.size > 15 * 1024 * 1024) return { error: "Arquivo muito grande (máx. 15 MB)." };

  const path = `${tenant_id}/${randomUUID()}.pdf`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage.from("proposals").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upErr) return { error: "Falha no upload: " + upErr.message + " (o bucket 'proposals' foi criado no Supabase?)" };

  const { error } = await supabase.from("documents").insert({
    tenant_id,
    name,
    type,
    storage_path: path,
    created_by: user_id,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/propostas");
  return { ok: true };
}

export async function createDocument(input: { name: string; type: string; url: string }) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.name.trim()) return { error: "Dê um nome ao documento." };
  if (!/^https?:\/\//i.test(input.url.trim())) return { error: "Informe um link válido (https://...)." };

  const { error } = await supabase.from("documents").insert({
    tenant_id,
    name: input.name.trim(),
    type: input.type || "proposta",
    url: input.url.trim(),
    created_by: user_id,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/propostas");
  return { ok: true };
}

// Gera um link rastreado único para um contato. Devolve o token; o client monta a URL.
export async function createShare(documentId: string, contactId: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!contactId) return { error: "Escolha o contato." };
  const token = randomUUID().replace(/-/g, "");
  const { error } = await supabase.from("document_shares").insert({
    tenant_id,
    document_id: documentId,
    contact_id: contactId,
    token,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/propostas");
  return { ok: true, token };
}
