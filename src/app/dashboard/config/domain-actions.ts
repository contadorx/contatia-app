"use server";

import { createClient } from "@/lib/supabase/server";

// Descobre o domínio a checar: do EMAIL_FROM, senão do domínio da caixa ativa, senão manual.
export async function checkMyDomain(manualDomain?: string) {
  const supabase = createClient();

  let domain = (manualDomain || "").trim();
  if (!domain) {
    // tenta pela caixa de e-mail ativa do workspace
    const { data: acct } = await supabase
      .from("email_accounts")
      .select("from_email")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const fromEmail = (acct as any)?.from_email as string | undefined;
    if (fromEmail && fromEmail.includes("@")) domain = fromEmail.split("@")[1];
  }
  if (!domain) return { error: "Sem domínio para checar. Conecte uma caixa ou informe o domínio." };

  const { checkDomainHealth } = await import("@/lib/domainhealth");
  const result = await checkDomainHealth(domain);
  return { ok: true, result };
}

// Troca as variáveis {{...}} por dados de exemplo, para o score refletir um envio real.
function preencherExemplo(s: string): string {
  return (s || "")
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, "João")
    .replace(/\{\{\s*empresa\s*\}\}/gi, "Empresa Exemplo")
    .replace(/\{\{\s*cargo\s*\}\}/gi, "Diretor")
    .replace(/\{\{\s*cidade\s*\}\}/gi, "São Paulo")
    .replace(/\{\{\s*cnae\s*\}\}/gi, "serviços")
    .replace(/\{\{\s*interesses\s*\}\}/gi, "gestão")
    .replace(/\{\{\s*contexto\s*\}\}/gi, "")
    .replace(/\{\{[^}]*\}\}/g, ""); // qualquer outra variável

}

// Visão de servidor (engajamento): o que os SEUS envios reais geraram nos últimos
// 30 dias — enviados, cliques, respostas e tamanho da lista de supressão. Sem API
// externa e sem inventar taxa de bounce/spam que o SMTP puro não fornece. Engajamento
// é o melhor sinal disponível, sem feedback loop, de que você está caindo na entrada.
export async function deliveryHealth() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Recarregue a página." };

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cnt = (type: string) =>
    supabase.from("events").select("id", { count: "exact", head: true }).eq("type", type).gte("created_at", since);

  const [sentRes, clickRes, replyRes, supRes, bounceRes] = await Promise.all([
    cnt("email_sent"),
    cnt("link_clicked"),
    cnt("replied"),
    supabase.from("email_suppressions").select("id", { count: "exact", head: true }),
    // bounces permanentes capturados nos últimos 30d (via webhook Brevo OU IMAP)
    supabase.from("email_suppressions").select("id", { count: "exact", head: true }).eq("reason", "hard_bounce").gte("created_at", since),
  ]);

  const sent = sentRes.count || 0;
  const clicks = clickRes.count || 0;
  const replies = replyRes.count || 0;
  const suppressed = supRes.count || 0;
  const bounces = bounceRes.count || 0;
  const rate = (n: number) => (sent > 0 ? (n / sent) * 100 : 0);

  return {
    ok: true,
    result: {
      sent,
      clicks,
      clickRate: rate(clicks),
      replies,
      replyRate: rate(replies),
      bounces,
      bounceRate: rate(bounces),
      suppressed,
    },
  };
}

// Roda o conteúdo (assunto + corpo) pelo SpamAssassin (API gratuita do Postmark).
export async function checkSpamContent(subject: string, body: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Recarregue a página." };

  const sub = preencherExemplo(subject || "");
  const html = preencherExemplo(body || "");
  const semTexto = !sub.trim() && !html.replace(/<[^>]+>/g, "").trim();
  if (semTexto) return { error: "Escreva o assunto e o corpo antes de testar." };

  try {
    const { checkSpamScore } = await import("@/lib/spamcheck");
    const result = await checkSpamScore(sub, html);
    return { ok: true, result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Não foi possível verificar agora. Tente de novo." };
  }
}
