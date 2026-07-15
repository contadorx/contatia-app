"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data as any)?.tenant_id as string | null };
}

// Verifica o e-mail do contato (sintaxe + descartável + MX) e persiste em custom.email_check.
export async function verifyContactEmail(contactId: string) {
  const { supabase } = await ctx();
  const { data: c } = await supabase.from("contacts").select("id, email, custom").eq("id", contactId).maybeSingle();
  if (!c) return { error: "Contato não encontrado." };
  const email = (c as any).email as string | undefined;
  if (!email) return { error: "Contato sem e-mail." };

  const { verifyEmail } = await import("@/lib/emailverify");
  const result = await verifyEmail(email);

  const custom = { ...((c as any).custom || {}), email_check: { ...result, checked_at: new Date().toISOString() } };
  const { error } = await supabase.from("contacts").update({ custom }).eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contatos/${contactId}`);
  return { ok: true, result };
}

// Sugere e-mails do decisor a partir do nome + domínio, JÁ VERIFICANDO cada caixa.
// Fonte principal: worker no VPS (discoverEmail) — gera os padrões e testa cada um por SMTP,
// confirmando qual caixa existe. Fallback (worker desligado): padrões + MX do domínio.
export async function suggestDecisorEmails(contactId: string) {
  const { supabase } = await ctx();
  const { data: c } = await supabase.from("contacts").select("id, name, email, company, company_domain, accounts(domain, website)").eq("id", contactId).maybeSingle();
  if (!c) return { error: "Contato não encontrado." };
  const C = c as any;

  const { dominioDe, workerConfigurado, discoverEmail } = await import("@/lib/emailFinder");
  const domain =
    dominioDe(C.email) || dominioDe(C.company_domain) || dominioDe(C.accounts?.domain) || dominioDe(C.accounts?.website) || dominioDe(C.company);
  if (!domain) return { error: "Sem domínio conhecido para gerar palpites (preencha o site/domínio da empresa)." };

  // 1) worker: gera E verifica cada palpite por SMTP
  if (workerConfigurado()) {
    const r = await discoverEmail(C.name || "", domain);
    if (r.status !== "error") {
      return {
        ok: true,
        verificado: true,
        domain,
        email: r.email,           // caixa confirmada (ou null)
        status: r.status,         // valid | not_found | uncertain | blocked
        tentativas: r.tentativas || [],
      };
    }
    // worker deu erro → cai no fallback abaixo
  }

  // 2) fallback: padrões locais + MX do domínio (sem confirmar caixa)
  const { guessDecisorEmails, verifyEmail } = await import("@/lib/emailverify");
  const candidates = guessDecisorEmails(C.name || "", domain);
  const domainCheck = await verifyEmail(`teste@${domain}`);
  return { ok: true, verificado: false, domain, candidates, domainValid: domainCheck.hasMx };
}

// Aplica um e-mail encontrado ao contato (e roda a verificação para o selo).
export async function aplicarEmailContato(contactId: string, email: string) {
  const { supabase } = await ctx();
  const addr = (email || "").trim().toLowerCase();
  if (!addr.includes("@")) return { error: "E-mail inválido." };

  const { verifyEmail } = await import("@/lib/emailverify");
  const result = await verifyEmail(addr);

  const { data: c } = await supabase.from("contacts").select("custom").eq("id", contactId).maybeSingle();
  const custom = { ...(((c as any)?.custom) || {}), email_check: { ...result, checked_at: new Date().toISOString() } };
  const { error } = await supabase.from("contacts").update({ email: addr, custom }).eq("id", contactId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/contatos/${contactId}`);
  return { ok: true, result };
}
