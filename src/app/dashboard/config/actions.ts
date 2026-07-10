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
  detect_replies?: boolean;
  imap_host?: string;
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
    detect_replies: !!input.detect_replies,
    imap_host: input.imap_host?.trim() || null,
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

// Testa a conexão SMTP com os dados do formulário (sem salvar). Devolve o erro
// exato do servidor — pra acertar host/porta/SSL ANTES de disparar a cadência.
export async function testSmtp(input: {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
}) {
  if (!input.smtp_host?.trim() || !input.smtp_user?.trim()) {
    return { error: "Preencha host e usuário para testar." };
  }
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: input.smtp_host.trim(),
    port: Number(input.smtp_port) || 587,
    secure: !!input.smtp_secure,
    auth: { user: input.smtp_user.trim(), pass: input.smtp_pass || "" },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });
  try {
    await transport.verify();
    return { ok: true };
  } catch (e: any) {
    return { error: e?.message || "Falha na conexão." };
  }
}

// Salva a config de IA do workspace (modelo + chave). A chave só é atualizada se enviada.
export async function saveAiSettings(input: { model: string; apiKey: string }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const patch: Record<string, unknown> = { ai_model: input.model.trim() || null };
  if (input.apiKey.trim()) patch.ai_api_key = input.apiKey.trim();
  const { error } = await supabase.from("tenants").update(patch).eq("id", tenant_id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}
