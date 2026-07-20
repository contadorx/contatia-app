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
