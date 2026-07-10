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
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

export async function saveSmtpAccount(input: {
  from_email: string;
  display_name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
}) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace atribuído." };
  if (!input.from_email.trim() || !input.smtp_host.trim() || !input.smtp_user.trim())
    return { error: "Preencha remetente, host e usuário." };

  const { error } = await supabase.from("email_accounts").insert({
    tenant_id,
    user_id,
    provider: "smtp",
    from_email: input.from_email.trim(),
    display_name: input.display_name.trim() || null,
    smtp_host: input.smtp_host.trim(),
    smtp_port: Number(input.smtp_port) || 587,
    smtp_secure: !!input.smtp_secure,
    smtp_user: input.smtp_user.trim(),
    smtp_pass: input.smtp_pass,
    is_active: true,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function toggleAccount(id: string, active: boolean) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("email_accounts").update({ is_active: active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function deleteAccount(id: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("email_accounts").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}
