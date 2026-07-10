"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function guard() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin, tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, ok: !!(me as any)?.is_superadmin, adminTenant: (me as any)?.tenant_id as string | null };
}

export async function createInvoice(input: { tenant_id: string; amount: number; description?: string; due_date?: string; payment_link?: string; asaas_payment_id?: string }) {
  const { supabase, ok } = await guard();
  if (!ok) return { error: "Apenas o dono da plataforma." };
  if (!input.tenant_id) return { error: "Escolha o workspace." };
  const { error } = await supabase.from("platform_invoices").insert({
    tenant_id: input.tenant_id,
    amount: Number(input.amount) || 0,
    description: input.description?.trim() || null,
    due_date: input.due_date || null,
    payment_link: input.payment_link?.trim() || null,
    asaas_payment_id: input.asaas_payment_id?.trim() || null,
    status: "pending",
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/cobranca");
  return { ok: true };
}

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

// Envia (ou reenvia) a fatura por e-mail usando a caixa SMTP do workspace do superadmin.
export async function sendInvoiceEmail(invoiceId: string, kind: "fatura" | "lembrete" = "fatura") {
  const { supabase, ok, adminTenant } = await guard();
  if (!ok) return { error: "Apenas o dono da plataforma." };

  const { data: inv } = await supabase
    .from("platform_invoices")
    .select("id, amount, description, due_date, payment_link, status, tenant_id, tenants(name, legal_name, contact_email)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { error: "Fatura não encontrada." };
  const to = (inv as any).tenants?.contact_email as string | undefined;
  if (!to) return { error: "O workspace não tem e-mail de contato (Config→Negócio do cliente)." };
  if (!(inv as any).payment_link) return { error: "Cole o link de pagamento do Asaas antes de enviar." };

  // caixa de envio TRANSACIONAL: preferir a que envia como suporte@contatia.com.br
  // (Brevo, domínio verificado — igual ao Quotaria). Fallback: caixa ativa do workspace.
  const { data: accts } = await supabase
    .from("email_accounts")
    .select("id, provider, from_email, display_name, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, oauth_refresh_token, daily_cap")
    .eq("tenant_id", adminTenant ?? "")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  const list = (accts as any[]) || [];
  const acct =
    list.find((a) => (a.from_email || "").toLowerCase().startsWith("suporte@")) ||
    list.find((a) => (a.smtp_host || "").includes("brevo")) ||
    list[0];
  if (!acct) return { error: "Conecte a caixa transacional (Brevo, suporte@contatia.com.br) em Config→E-mail." };

  const nome = (inv as any).tenants?.name || (inv as any).tenants?.legal_name || "cliente";
  const venc = (inv as any).due_date ? new Date((inv as any).due_date).toLocaleDateString("pt-BR") : "—";
  const valor = brl(Number((inv as any).amount));
  const link = (inv as any).payment_link;
  const desc = (inv as any).description || "Assinatura Contatia";

  const subject = kind === "lembrete" ? `Lembrete: fatura Contatia em aberto (${valor})` : `Sua fatura Contatia — ${valor}`;
  const abertura = kind === "lembrete"
    ? `Olá, ${nome}. Notamos que a fatura abaixo ainda está em aberto.`
    : `Olá, ${nome}. Segue sua fatura da Contatia.`;
  const text = `${abertura}

Descrição: ${desc}
Valor: ${valor}
Vencimento: ${venc}

Pague com segurança neste link:
${link}

Assim que o pagamento for confirmado, sua assinatura é atualizada automaticamente. Qualquer dúvida, é só responder este e-mail.`;

  try {
    const { sendEmail } = await import("@/lib/mailer");
    await sendEmail(acct as any, { to, subject, text });
  } catch (e: any) {
    return { error: "Falha no envio: " + (e?.message || "erro") };
  }

  await supabase.from("platform_invoices").update({ sent_at: new Date().toISOString() }).eq("id", invoiceId);
  revalidatePath("/dashboard/superadmin/cobranca");
  return { ok: true };
}

// Marca manualmente pago/cancelado (fallback quando não vier pelo webhook).
export async function setInvoiceStatus(invoiceId: string, status: string) {
  const { supabase, ok } = await guard();
  if (!ok) return { error: "Apenas o dono da plataforma." };
  const patch: any = { status };
  if (status === "paid") patch.paid_at = new Date().toISOString();
  const { error } = await supabase.from("platform_invoices").update(patch).eq("id", invoiceId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/cobranca");
  return { ok: true };
}
