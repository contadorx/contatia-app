"use server";

import { canCreate, mensagemLimite } from "@/lib/plan";

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
  // limite de caixas de e-mail do plano
  const lim = await canCreate("caixas");
  if (!lim.permitido) {
    return { error: mensagemLimite("caixas", lim.usado, lim.limite, lim.sugerido) };
  }

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

// Salva a ficha do negócio (owner). Campos vazios viram null.
export async function saveBusinessProfile(input: {
  legal_name: string;
  cnpj: string;
  segment: string;
  contact_email: string;
  phone: string;
  website: string;
  logo_url: string;
  brand_color: string;
}) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const clean = (v: string) => (v?.trim() ? v.trim() : null);
  const { error } = await supabase
    .from("tenants")
    .update({
      legal_name: clean(input.legal_name),
      cnpj: clean(input.cnpj),
      segment: clean(input.segment),
      contact_email: clean(input.contact_email),
      phone: clean(input.phone),
      website: clean(input.website),
      logo_url: clean(input.logo_url),
      brand_color: clean(input.brand_color),
    })
    .eq("id", tenant_id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

// Salva a assinatura de e-mail do negócio (owner).
export async function saveSignature(signature: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase.from("tenants").update({ email_signature: signature.trim() || null }).eq("id", tenant_id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function saveBookingSettings(input: {
  enabled: boolean; duration: number; days: string; startHour: number; endHour: number; title: string;
}) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (Number(input.startHour) >= Number(input.endHour)) return { error: "A hora de início deve ser antes da hora de fim." };
  const { error } = await supabase.from("tenants").update({
    booking_enabled: !!input.enabled,
    booking_duration_min: Number(input.duration) || 30,
    booking_days: input.days || "1,2,3,4,5",
    booking_start_hour: Number(input.startHour) || 9,
    booking_end_hour: Number(input.endHour) || 18,
    booking_title: input.title?.trim() || null,
  }).eq("id", tenant_id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

// Define a retenção de arquivos (meses) do workspace. Owner.
// Retenção agora é POLÍTICA DO PLANO (definida em platform_plans e herdada por trigger).
// O cliente não edita mais — mantida como no-op para não quebrar imports antigos.
export async function saveRetention(_months: number) {
  return { error: "A retenção de arquivos é definida pelo plano e não pode ser alterada aqui." };
}
