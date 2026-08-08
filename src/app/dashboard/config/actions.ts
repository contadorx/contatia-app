"use server";

import { msgErro } from "@/lib/erros";
import { canCreate, mensagemLimite } from "@/lib/plan";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Detecta o provedor de e-mail pelo domínio (para autopreencher a caixa SMTP/IMAP).
export async function detectProvider(email: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Recarregue a página." };
  const domain = (email || "").split("@")[1]?.toLowerCase().trim();
  if (!domain || !domain.includes(".")) return { error: "Digite o e-mail completo." };
  const { providerFromDomain } = await import("@/lib/mailproviders");
  const provider = await providerFromDomain(domain);
  return { ok: true, provider };
}

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
    // Nasce PRIVADA. A coluna tem default `true` para que as caixas que já existiam
    // (todas com user_id nulo, do workspace) continuem valendo para todo mundo — mas
    // uma caixa PESSOAL que nasce compartilhada seria o oposto do que a pessoa espera
    // ao cadastrar o próprio e-mail. Quem quiser emprestar liga o compartilhamento.
    is_shared: false,
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
  if (error) return { error: msgErro(error) };
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
  if (error) return { error: msgErro(error) };
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
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function deleteAccount(id: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("email_accounts").delete().eq("id", id);
  if (error) return { error: msgErro(error) };
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
  if (error) return { error: msgErro(error) };
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
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

// Salva a assinatura de e-mail do negócio (owner).
export async function saveSignature(signature: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase.from("tenants").update({ email_signature: signature.trim() || null }).eq("id", tenant_id);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

// Define o LIMITE DIÁRIO alvo de uma caixa (o aquecimento sobe gradual até ele) e
// liga/desliga o aquecimento. Clampa entre 10 e 500 por segurança.
export async function saveDailyCap(accountId: string, cap: number, warmup: boolean, hourlyCap?: number | null) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const c = Math.max(10, Math.min(500, Math.round(Number(cap) || 40)));
  // 0 e vazio significam a MESMA coisa aqui — "sem teto por hora" — e viram null. Um 0
  // gravado seria lido como "nunca envie", que é o oposto do que a pessoa quis dizer.
  const h = Number(hourlyCap) > 0 ? Math.min(5000, Math.round(Number(hourlyCap))) : null;

  const patch: Record<string, unknown> = { daily_cap: c, warmup_stage: warmup ? 0 : -1, hourly_cap: h };
  let { error } = await supabase
    .from("email_accounts")
    .update(patch)
    .eq("id", accountId)
    .eq("tenant_id", tenant_id);

  // 0114 ainda não aplicada: o PostgREST recusa o update INTEIRO por causa da coluna
  // desconhecida — e o limite diário, que sempre funcionou, deixaria de salvar junto.
  if (error && ((error as any).code === "PGRST204" || (error as any).code === "42703")) {
    delete patch.hourly_cap;
    const r2 = await supabase.from("email_accounts").update(patch).eq("id", accountId).eq("tenant_id", tenant_id);
    if (r2.error) return { error: msgErro(r2.error) };
    revalidatePath("/dashboard/config");
    return { ok: true, semColunaHora: true };
  }
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

// ============================================================
// LIMITE POR HORA DO WORKSPACE + HORÁRIO COMERCIAL DA FILA (0114)
//
// Dois freios que o limite diário não cobria:
//   · hourly_cap: quem hospeda em cPanel (HostGator e afins) é limitado POR HORA, e
//     estourar não devolve erro — o servidor recusa conexão pela hora inteira;
//   · horário comercial: prospecção que chega às 3h de domingo é lida como robô.
//
// O teto por hora aqui é do WORKSPACE (soma das caixas), porque várias caixas podem
// morar no mesmo cPanel e dividir o mesmo limite do servidor — nenhuma delas sozinha
// enxerga isso.
// ============================================================
export async function saveLimiteEnvio(input: {
  hourlyCap?: number | null;
  horarioOn?: boolean;
  horaInicio?: number;
  horaFim?: number;
  dias?: number[];
  filaAutomatica?: boolean;
}) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const h = Number(input.hourlyCap) > 0 ? Math.min(20000, Math.round(Number(input.hourlyCap))) : null;
  let ini = Math.max(0, Math.min(23, Math.round(Number(input.horaInicio ?? 8))));
  let fim = Math.max(1, Math.min(24, Math.round(Number(input.horaFim ?? 18))));
  // O banco tem um check para isto (fim > início). Corrigir aqui também evita mandar a
  // pessoa de volta ao formulário para consertar algo que dá para consertar sozinho.
  if (fim <= ini) fim = Math.min(24, ini + 1);
  const dias = Array.from(new Set((input.dias || [1, 2, 3, 4, 5]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort();
  if (!dias.length) return { error: "Escolha pelo menos um dia da semana para a fila enviar." };

  const patch: Record<string, unknown> = {
    hourly_cap: h,
    envio_horario_on: !!input.horarioOn,
    envio_hora_inicio: ini,
    envio_hora_fim: fim,
    envio_dias: dias.join(","),
    fila_automatica: !!input.filaAutomatica,
  };

  const { error } = await supabase.from("tenants").update(patch).eq("id", tenant_id);

  // Coluna desconhecida: as duas migrations chegam separadas, e a 0115 (fila automática)
  // é a mais provável de faltar. Em vez de recusar tudo, salva o que dá e diz o que NÃO
  // foi salvo — senão a pessoa mexe no horário, vê "erro", e não sabe que o horário
  // teria entrado.
  if (error && ((error as any).code === "PGRST204" || (error as any).code === "42703")) {
    delete patch.fila_automatica;
    const r2 = await supabase.from("tenants").update(patch).eq("id", tenant_id);
    if (r2.error) {
      return { error: "A migration 0114 ainda não foi aplicada no banco — o limite por hora e o horário comercial só passam a existir depois dela." };
    }
    revalidatePath("/dashboard/config");
    revalidatePath("/dashboard");
    return { ok: true, semFilaAutomatica: true };
  }
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/config");
  revalidatePath("/dashboard");
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
  if (error) return { error: msgErro(error) };
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
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

// Define a retenção de arquivos (meses) do workspace. Owner.
// Retenção agora é POLÍTICA DO PLANO (definida em platform_plans e herdada por trigger).
// O cliente não edita mais — mantida como no-op para não quebrar imports antigos.
export async function saveRetention(_months: number) {
  return { error: "A retenção de arquivos é definida pelo plano e não pode ser alterada aqui." };
}


// ============================================================
// COMPARTILHAR (ou não) uma caixa de e-mail
//
// Compartilhada = outras pessoas do workspace podem enviar por ela quando não têm a
// sua. Isso EXPÕE a linha inteira da caixa a elas (a RLS da 0104 libera a leitura da
// linha compartilhada) — inclusive a senha SMTP. Por isso a confirmação na tela é
// explícita e o padrão é não compartilhar.
// ============================================================
export async function definirCompartilhamentoCaixa(id: string, compartilhada: boolean) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase
    .from("email_accounts")
    .update({ is_shared: !!compartilhada })
    .eq("id", id)
    .eq("tenant_id", tenant_id);
  // A própria RLS já barra mexer na caixa dos outros — não precisamos checar papel aqui.
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/config");
  return { ok: true };
}
