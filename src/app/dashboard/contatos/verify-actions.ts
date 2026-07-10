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

// Sugere e-mails do decisor a partir do nome do contato + domínio (da empresa/e-mail).
export async function suggestDecisorEmails(contactId: string) {
  const { supabase } = await ctx();
  const { data: c } = await supabase.from("contacts").select("id, name, email, company, accounts(domain, website)").eq("id", contactId).maybeSingle();
  if (!c) return { error: "Contato não encontrado." };
  const C = c as any;

  // tenta achar o domínio: do e-mail atual, do domain/website da empresa
  let domain = "";
  if (C.email && C.email.includes("@")) domain = C.email.split("@")[1];
  else if (C.accounts?.domain) domain = C.accounts.domain;
  else if (C.accounts?.website) domain = C.accounts.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (!domain) return { error: "Sem domínio conhecido para gerar palpites (preencha o site da empresa)." };

  const { guessDecisorEmails, verifyEmail } = await import("@/lib/emailverify");
  const candidates = guessDecisorEmails(C.name || "", domain);
  // valida o domínio uma vez (MX) — os candidatos compartilham o mesmo domínio
  const domainCheck = await verifyEmail(`teste@${domain}`);
  return { ok: true, candidates, domainValid: domainCheck.hasMx };
}
