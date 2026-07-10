"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addNote(contactId: string, text: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const tenant_id = profile?.tenant_id as string | undefined;
  if (!tenant_id) return { error: "Sem workspace." };
  if (!text.trim()) return { error: "Escreva algo." };

  const { error } = await supabase.from("events").insert({
    tenant_id,
    contact_id: contactId,
    type: "note",
    meta: { text: text.trim() },
  });
  if (error) return { error: error.message };
  await supabase.from("contacts").update({ last_activity_at: new Date().toISOString() }).eq("id", contactId);
  revalidatePath(`/dashboard/contatos/${contactId}`);
  return { ok: true };
}
