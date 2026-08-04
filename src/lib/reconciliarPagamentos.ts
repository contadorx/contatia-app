import "server-only";

// ============================================================
// A REDE DE SEGURANÇA DA COBRANÇA
//
// O incidente: uma fatura foi paga no Asaas e o app não marcou. Foi preciso marcar na
// mão. A causa possível é uma só de várias — webhook não entregue, evento com nome
// que o app não tratava, fatura sem `asaas_payment_id`, escrita recusada pelo banco —
// e nenhuma delas deixava rastro, porque o webhook respondia "ok" em todos os casos.
//
// Consertei cada uma. Mas o desenho continuava frágil pelo mesmo motivo de sempre:
// TODO o fluxo dependia de uma notificação chegar. Notificação é otimização, não
// fonte da verdade. Este job pergunta.
//
// Uma vez por dia, para cada fatura em aberto com cobrança conhecida no Asaas: "esta
// aqui foi paga?". Se foi, fecha — reativando a conta pelo mesmo caminho do webhook.
// Custa uma chamada HTTP por fatura aberta, o que é irrisório para a quantidade de
// faturas que existe, e transforma "o pagamento se perdeu" em "o pagamento entra com
// até um dia de atraso" — que é uma falha que ninguém precisa descobrir sozinho.
// ============================================================

export async function reconciliarPagamentos(
  admin: any
): Promise<{ conferidas: number; fechadas: number; erros: string[] }> {
  const erros: string[] = [];
  let conferidas = 0;
  let fechadas = 0;

  if (!process.env.ASAAS_API_KEY) return { conferidas, fechadas, erros };

  const { data: abertas, error } = await admin
    .from("platform_invoices")
    .select("id, tenant_id, amount, due_date, asaas_payment_id, asaas_subscription_id, status")
    .in("status", ["pending", "overdue"])
    .not("asaas_payment_id", "is", null)
    // ordem explícita: `limit` sem `order by` no Postgres repete e PULA linhas — uma
    // fatura pode nunca ser sorteada.
    .order("due_date", { ascending: true })
    .limit(300);
  if (error) return { conferidas, fechadas, erros: [`reconciliacao: ${(error as any).message}`] };

  const { consultarPagamento, pagamentoQuitado } = await import("@/lib/asaas");
  const { marcarFaturaPaga } = await import("@/lib/pagamento");

  for (const inv of (abertas as any[]) || []) {
    conferidas++;
    const { pgto, error: e } = await consultarPagamento(inv.asaas_payment_id);
    if (e || !pgto) {
      // Uma cobrança apagada no Asaas não é erro de sistema, é informação: a fatura
      // local está cobrando algo que não existe mais.
      erros.push(`fatura ${inv.id}: ${e || "sem resposta"}`);
      continue;
    }
    if (!pagamentoQuitado(pgto.status)) continue;

    const r = await marcarFaturaPaga(admin, {
      invoiceId: inv.id,
      tenantId: inv.tenant_id,
      dueDate: pgto.dueDate || inv.due_date,
      valor: pgto.value || Number(inv.amount) || 0,
      // só a mensalidade renova o período; cobrança avulsa não
      daAssinatura: !!(pgto.subscription || inv.asaas_subscription_id),
      pagoEm: pgto.paymentDate ? `${pgto.paymentDate}T12:00:00Z` : undefined,
    });
    if (!r.ok) { erros.push(`fatura ${inv.id}: ${r.erro}`); continue; }
    fechadas++;
    // Fica registrado que quem fechou foi a reconciliação, e não o webhook: se este
    // número for alto de forma constante, o webhook está quebrado e é isso que
    // precisa de conserto.
    erros.push(`fatura ${inv.id} estava PAGA no Asaas e aberta aqui — fechada pela reconciliacao`);
  }

  return { conferidas, fechadas, erros };
}
