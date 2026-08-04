import "server-only";
import { diaISO } from "@/lib/datas";

// ============================================================
// "PAGOU" ACONTECE EM MAIS DE UM LUGAR — E TEM DE SIGNIFICAR A MESMA COISA
//
// Havia dois caminhos para uma fatura virar paga, e eles faziam coisas diferentes:
//
//   · o webhook do Asaas marcava a fatura E reativava a assinatura;
//   · o botão "marcar paga" do superadmin marcava SÓ a fatura.
//
// Como o webhook falhou e o pagamento foi marcado na mão, o cliente ficou com a
// fatura paga e a conta ainda suspensa — e sem nenhuma fatura em aberto, a tela de
// conta pausada não tinha nem o que oferecer para pagar. Pagou e continuou trancado.
//
// Agora os dois caminhos chamam esta função. Se um dia surgir um terceiro, ele chama
// daqui também.
// ============================================================

/** Soma meses sem estourar o mês. 31/01 + 1 mês = 28/02, e não 03/03. */
export function somarMeses(base: Date, meses: number): Date {
  const d = new Date(base.getTime());
  const diaOriginal = d.getUTCDate();
  d.setUTCDate(1);                          // evita o estouro antes de trocar o mês
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimoDoMes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(diaOriginal, ultimoDoMes));
  return d;
}

export type ResultadoPagamento = { ok: boolean; erro?: string; reativou?: boolean };

/**
 * Marca a fatura como paga e devolve o acesso ao cliente.
 *
 * `daAssinatura` distingue a mensalidade de uma cobrança avulsa (taxa de implantação,
 * por exemplo). Só a mensalidade renova o período e redefine o MRR — sem isso, uma
 * taxa avulsa paga por um assinante empurrava a renovação para a data ERRADA e ainda
 * gravava o valor da taxa como mensalidade.
 */
export async function marcarFaturaPaga(
  admin: any,
  input: {
    invoiceId: string;
    tenantId?: string | null;
    dueDate?: string | null;   // vencimento pago, formato AAAA-MM-DD
    valor?: number | null;
    daAssinatura?: boolean;
    pagoEm?: string | null;
  }
): Promise<ResultadoPagamento> {
  const pagoEm = input.pagoEm || new Date().toISOString();

  // A ESCRITA É CONFERIDA. O cliente Supabase não lança exceção: sem olhar o `error`,
  // uma recusa do banco viraria "deu tudo certo" e o pagamento se perderia em
  // silêncio — foi assim que este incidente ficou invisível.
  const { error } = await admin
    .from("platform_invoices")
    .update({ status: "paid", paid_at: pagoEm })
    .eq("id", input.invoiceId);
  if (error) return { ok: false, erro: (error as any).message || "falha ao gravar a fatura" };

  let tenantId = input.tenantId || null;
  if (!tenantId) {
    const { data } = await admin.from("platform_invoices").select("tenant_id").eq("id", input.invoiceId).maybeSingle();
    tenantId = (data as any)?.tenant_id || null;
  }
  if (!tenantId) return { ok: true, reativou: false };

  // Pagamento tardio de conta JÁ CANCELADA não ressuscita a assinatura: sem vínculo
  // ativo com o Asaas, não há o que renovar.
  const { data: t } = await admin
    .from("tenants")
    .select("asaas_subscription_id, current_period_end")
    .eq("id", tenantId)
    .maybeSingle();
  if (!(t as any)?.asaas_subscription_id) return { ok: true, reativou: false };

  const patch: any = { subscription_status: "active", suspended_at: null, archived_at: null };
  if (input.daAssinatura !== false) {
    const base = input.dueDate ? new Date(`${String(input.dueDate).slice(0, 10)}T12:00:00Z`) : new Date();
    patch.current_period_end = diaISO(somarMeses(base, 1));
    if (input.valor) patch.mrr = input.valor;
  }
  const { error: e2 } = await admin.from("tenants").update(patch).eq("id", tenantId);
  if (e2) return { ok: true, erro: (e2 as any).message || "fatura paga, mas a assinatura não reativou", reativou: false };

  // Zera a régua de cobrança DESTA fatura: pagou, então um atraso futuro pode
  // disparar de novo. Antes isto apagava `business_message_sends`, que é a marca da
  // régua de RETENÇÃO — tabela errada: a cobrança deduplica em invoice_notice_sends.
  await admin.from("invoice_notice_sends").delete().eq("invoice_id", input.invoiceId);

  return { ok: true, reativou: true };
}
