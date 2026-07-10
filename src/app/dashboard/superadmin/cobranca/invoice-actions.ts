"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function guard() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, ok: !!(me as any)?.is_superadmin };
}

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

// Cria a fatura. Se ASAAS_API_KEY existir e não vier link manual, gera a cobrança no
// Asaas automaticamente (cria/reusa cliente → cria cobrança → guarda link + pay_id).
export async function createInvoice(input: {
  tenant_id: string; amount: number; description?: string; due_date?: string; payment_link?: string; asaas_payment_id?: string;
}) {
  const { supabase, ok } = await guard();
  if (!ok) return { error: "Apenas o dono da plataforma." };
  if (!input.tenant_id) return { error: "Escolha o workspace." };
  if (!input.amount || Number(input.amount) <= 0) return { error: "Informe o valor." };

  let link = input.payment_link?.trim() || null;
  let payId = input.asaas_payment_id?.trim() || null;

  // gera no Asaas se não veio link manual e a API está configurada
  if (!link && process.env.ASAAS_API_KEY) {
    const { data: t } = await supabase.from("tenants").select("name, legal_name, cnpj, contact_email, asaas_customer_id").eq("id", input.tenant_id).maybeSingle();
    const { ensureAsaasCustomer, createAsaasCharge } = await import("@/lib/asaas");
    const cust = await ensureAsaasCustomer({
      name: (t as any)?.legal_name || (t as any)?.name || "Cliente Contatia",
      email: (t as any)?.contact_email,
      cpfCnpj: (t as any)?.cnpj,
      existingId: (t as any)?.asaas_customer_id,
    });
    if (cust.error) return { error: cust.error };
    if (cust.id && cust.id !== (t as any)?.asaas_customer_id) {
      await supabase.from("tenants").update({ asaas_customer_id: cust.id }).eq("id", input.tenant_id);
    }
    const due = input.due_date || new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const charge = await createAsaasCharge({ customerId: cust.id!, value: Number(input.amount), dueDate: due, description: input.description });
    if (charge.error) return { error: charge.error };
    link = charge.link || null;
    payId = charge.id || null;
  }

  const { error } = await supabase.from("platform_invoices").insert({
    tenant_id: input.tenant_id,
    amount: Number(input.amount) || 0,
    description: input.description?.trim() || null,
    due_date: input.due_date || null,
    payment_link: link,
    asaas_payment_id: payId,
    status: "pending",
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/cobranca");
  return { ok: true, generated: !input.payment_link && !!link };
}

// Envia (ou reenvia) a fatura por e-mail via API do Brevo (suporte@contatia.com.br).
export async function sendInvoiceEmail(invoiceId: string, kind: "fatura" | "lembrete" = "fatura") {
  const { supabase, ok } = await guard();
  if (!ok) return { error: "Apenas o dono da plataforma." };

  const { data: inv } = await supabase
    .from("platform_invoices")
    .select("id, amount, description, due_date, payment_link, status, tenant_id, tenants(name, legal_name, contact_email)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { error: "Fatura não encontrada." };
  const to = (inv as any).tenants?.contact_email as string | undefined;
  if (!to) return { error: "O workspace não tem e-mail de contato (Config→Negócio do cliente)." };
  if (!(inv as any).payment_link) return { error: "Sem link de pagamento. Gere no Asaas ou cole um link." };

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

  const { sendBrevoEmail } = await import("@/lib/brevo");
  const res = await sendBrevoEmail({ to, toName: nome, subject, text });
  if (res.error) return { error: res.error };

  await supabase.from("platform_invoices").update({ sent_at: new Date().toISOString() }).eq("id", invoiceId);
  revalidatePath("/dashboard/superadmin/cobranca");
  return { ok: true };
}

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
