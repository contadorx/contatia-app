"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function tenantId() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: data?.tenant_id as string | null, user_id: user?.id };
}

export async function addContact(formData: FormData) {
  const { supabase, tenant_id, user_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace atribuído." };

  const payload = {
    tenant_id,
    assigned_to: user_id,
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim() || null,
    phone: String(formData.get("phone") || "").trim() || null,
    company: String(formData.get("company") || "").trim() || null,
    origin: String(formData.get("origin") || "").trim() || null,
  };
  if (!payload.name) return { error: "Nome é obrigatório." };

  const { error } = await supabase.from("contacts").insert(payload);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}

type Row = { name: string; email?: string; phone?: string; company?: string; origin?: string };

export async function importContacts(rows: Row[]) {
  const { supabase, tenant_id, user_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace atribuído." };

  const clean = rows
    .filter((r) => r.name && r.name.trim())
    .map((r) => ({
      tenant_id,
      assigned_to: user_id,
      name: r.name.trim(),
      email: r.email?.trim() || null,
      phone: r.phone?.trim() || null,
      company: r.company?.trim() || null,
      origin: r.origin?.trim() || "Import CSV",
    }));

  if (!clean.length) return { error: "Nenhuma linha válida (coluna 'name' é obrigatória)." };

  // insere em lotes de 500
  for (let i = 0; i < clean.length; i += 500) {
    const { error } = await supabase.from("contacts").insert(clean.slice(i, i + 500));
    if (error) return { error: error.message };
  }
  revalidatePath("/dashboard/contatos");
  return { ok: true, count: clean.length };
}

// Edita os dados de um contato (corrigir/completar informações).
export async function updateContact(id: string, patch: {
  name?: string; email?: string; phone?: string; company?: string; role_title?: string; cnpj?: string; status?: string;
}) {
  const { supabase } = await tenantId();
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = (typeof v === "string" ? v.trim() : v) || null;
  }
  if (clean.name === null) return { error: "O nome não pode ficar vazio." };
  const { error } = await supabase.from("contacts").update(clean).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contatos/${id}`);
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}
