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
