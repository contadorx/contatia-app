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

  // valida a conexão na hora de salvar → grava verde/vermelho na ficha da caixa.
  const check = await verifySmtpConnection({
    smtp_host: input.smtp_host,
    smtp_port: input.smtp_port,
    smtp_secure: input.smtp_secure,
    smtp_user: input.smtp_user,
    smtp_pass: input.smtp_pass,
  });

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
    verified: check.ok,
    verified_at: check.ok ? new Date().toISOString() : null,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true, verified: check.ok };
}

// Edita uma caixa SMTP já criada (CFG-06: antes não dava para reabrir e ajustar,
// ex.: ativar o IMAP depois). Senha em branco = mantém a atual. Revalida a conexão.
export async function updateEmailAccount(id: string, input: {
  from_email?: string;
  display_name?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_pass?: string; // vazio = mantém
  detect_replies?: boolean;
  imap_host?: string;
}) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: cur } = await supabase
    .from("email_accounts")
    .select("smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, verified, verified_at")
    .eq("id", id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();
  if (!cur) return { error: "Caixa não encontrada." };

  const merged = {
    smtp_host: (input.smtp_host ?? (cur as any).smtp_host) || "",
    smtp_port: Number(input.smtp_port ?? (cur as any).smtp_port) || 587,
    smtp_secure: input.smtp_secure ?? (cur as any).smtp_secure ?? false,
    smtp_user: (input.smtp_user ?? (cur as any).smtp_user) || "",
    smtp_pass: input.smtp_pass?.trim() ? input.smtp_pass : ((cur as any).smtp_pass || ""),
  };

  // B6: só re-testa (e arrisca rebaixar o selo) se algo da CONEXÃO mudou. Se o usuário
  // só ativou o IMAP ou trocou o nome, mantém o status de validação atual — um soluço de
  // SMTP não derruba uma caixa que já estava verde.
  const connChanged =
    merged.smtp_host !== ((cur as any).smtp_host || "") ||
    merged.smtp_port !== (Number((cur as any).smtp_port) || 587) ||
    !!merged.smtp_secure !== !!(cur as any).smtp_secure ||
    merged.smtp_user !== ((cur as any).smtp_user || "") ||
    !!input.smtp_pass?.trim();

  let verified = !!(cur as any).verified;
  let verified_at = (cur as any).verified_at || null;
  if (connChanged) {
    const check = await verifySmtpConnection(merged);
    verified = check.ok;
    verified_at = check.ok ? new Date().toISOString() : null;
  }

  // B5: campos parciais — só grava o que veio no input (não sobrescreve com default).
  const patch: Record<string, unknown> = { verified, verified_at };
  if (connChanged) {
    patch.smtp_host = merged.smtp_host.trim();
    patch.smtp_port = merged.smtp_port;
    patch.smtp_secure = !!merged.smtp_secure;
    patch.smtp_user = merged.smtp_user.trim();
  }
  if (input.detect_replies !== undefined) patch.detect_replies = !!input.detect_replies;
  if (input.imap_host !== undefined) patch.imap_host = input.imap_host?.trim() || null;
  if (input.from_email !== undefined) patch.from_email = input.from_email.trim();
  if (input.display_name !== undefined) patch.display_name = input.display_name.trim() || null;
  if (input.smtp_pass?.trim()) patch.smtp_pass = input.smtp_pass;

  const { error } = await supabase.from("email_accounts").update(patch).eq("id", id).eq("tenant_id", tenant_id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true, verified };
}

// Verifica a conexão SMTP (usado no teste, no salvar e no editar). Reaproveitado.
async function verifySmtpConnection(input: {
  smtp_host: string; smtp_port: number; smtp_secure: boolean; smtp_user: string; smtp_pass: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.smtp_host?.trim() || !input.smtp_user?.trim()) return { ok: false, error: "Sem host/usuário." };
  try {
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: input.smtp_host.trim(),
      port: Number(input.smtp_port) || 587,
      secure: !!input.smtp_secure,
      auth: { user: input.smtp_user.trim(), pass: input.smtp_pass || "" },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });
    await transport.verify();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha na conexão." };
  }
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
  const check = await verifySmtpConnection(input);
  return check.ok ? { ok: true } : { error: check.error || "Falha na conexão." };
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

// Define o LIMITE DIÁRIO alvo de uma caixa (o aquecimento sobe gradual até ele) e
// liga/desliga o aquecimento. Clampa entre 10 e 500 por segurança.
export async function saveDailyCap(accountId: string, cap: number, warmup: boolean) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const c = Math.max(10, Math.min(500, Math.round(Number(cap) || 40)));
  const { error } = await supabase
    .from("email_accounts")
    .update({ daily_cap: c, warmup_stage: warmup ? 0 : -1 })
    .eq("id", accountId)
    .eq("tenant_id", tenant_id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

// Salva a assinatura de UMA caixa. Vazia = usa a assinatura geral no envio.
export async function saveBoxSignature(accountId: string, signature: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase
    .from("email_accounts")
    .update({ signature: signature.trim() || null })
    .eq("id", accountId)
    .eq("tenant_id", tenant_id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function saveBookingSettings(input: {
  enabled: boolean; duration: number; days: string; startHour: number; endHour: number; title: string;
}) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  // M12: coerção segura a NaN que ACEITA 0 (meia-noite). `Number(x) || 9` transformava
  // startHour=0 em 9 → depois start>=end e a agenda pública ficava sem horários.
  const numOr = (v: unknown, def: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? n : def;
  };
  const startHour = Math.min(23, Math.max(0, numOr(input.startHour, 9)));
  const endHour = Math.min(24, Math.max(1, numOr(input.endHour, 18)));
  if (startHour >= endHour) return { error: "A hora de início deve ser antes da hora de fim." };

  // B10: com o link ativo, precisa de ao menos um dia — antes um "" virava seg–sex sem avisar.
  const days = (input.days || "").split(",").map((d) => d.trim()).filter(Boolean);
  if (input.enabled && !days.length) return { error: "Escolha ao menos um dia disponível." };

  const { error } = await supabase.from("tenants").update({
    booking_enabled: !!input.enabled,
    booking_duration_min: numOr(input.duration, 30) || 30,
    booking_days: days.join(",") || "1,2,3,4,5",
    booking_start_hour: startHour,
    booking_end_hour: endHour,
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
