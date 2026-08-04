import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { marcarFaturaPaga, somarMeses } from "@/lib/pagamento";
import { diaISO } from "@/lib/datas";

export const dynamic = "force-dynamic";

// ============================================================
// O WEBHOOK QUE DIZIA "OK" PARA TUDO
//
// Uma fatura foi paga no Asaas e ficou "Pendente" aqui. O dono marcou na mão. Ao
// investigar, o problema não era um bug: era o webhook não ter NENHUMA maneira de
// falhar visivelmente. Ele respondia 200 em cinco situações diferentes:
//
//   1. não achou fatura pelo `asaas_payment_id` (fatura criada com link colado no
//      painel do superadmin nasce SEM esse id — invisível para sempre);
//   2. achou a fatura mas o evento não era um dos três tratados;
//   3. a escrita no banco foi recusada — ninguém conferia o `error`;
//   4. o evento era de estorno/chargeback, e nada acontecia;
//   5. não achou o tenant.
//
// Em todas, o Asaas registra "entregue" e nunca reenvia. O pagamento evapora sem
// deixar uma linha de log em lugar nenhum. Por isso o conserto tem três partes, e a
// terceira é a que importa mais:
//
//   · CASAR MELHOR: sem `asaas_payment_id`, procura pelo cliente/assinatura e pela
//     fatura aberta compatível; se não houver nenhuma, CRIA a fatura já paga a partir
//     do próprio payload. Dinheiro que entrou vira registro, sempre.
//   · CONFERIR AS ESCRITAS e responder 500 quando falharem — 500 faz o Asaas reenviar,
//     que é exatamente o que se quer quando o banco recusou.
//   · REGISTRAR TUDO, inclusive o que foi ignorado, em `email_log` (kind=webhook).
//     Da próxima vez a pergunta "o evento chegou?" se responde numa tela, e não numa
//     dedução.
//
// E, independente disto tudo, existe agora a reconciliação diária que pergunta ao
// Asaas quais faturas abertas já foram pagas (lib/reconciliarPagamentos). Webhook é
// notificação; a verdade está lá.
// ============================================================

const PAGOU = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH"];
const DESFEZ = [
  "PAYMENT_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
  "PAYMENT_RECEIVED_IN_CASH_UNDONE",
  "PAYMENT_REFUND_IN_PROGRESS",
];

async function registrar(admin: any, dados: { evento: string; pagamento?: string; resultado: string; erro?: string }) {
  try {
    await admin.from("email_log").insert({
      tenant_id: null,
      to_email: null,
      subject: `Asaas ${dados.evento}${dados.pagamento ? ` · ${dados.pagamento}` : ""}`,
      kind: "webhook",
      status: dados.erro ? "error" : "sent",
      error: dados.erro || dados.resultado,
    });
  } catch { /* o log nunca pode derrubar o webhook */ }
}

export async function POST(req: Request) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "billing não configurado" }, { status: 500 });

  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  const url = new URL(req.url);
  const token = req.headers.get("asaas-access-token") || url.searchParams.get("token");
  if (!expected) {
    // fail-closed: sem o token configurado, não processa nada (evita PAYMENT_CONFIRMED forjado)
    return NextResponse.json({ error: "ASAAS_WEBHOOK_TOKEN não configurado" }, { status: 503 });
  }
  if (token !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  const event = body?.event as string | undefined;
  const payment = body?.payment || {};
  const subId = payment?.subscription as string | undefined;
  const custId = payment?.customer as string | undefined;
  const payId = payment?.id as string | undefined;
  const dueDate = payment?.dueDate as string | undefined;
  const value = Number(payment?.value) || 0;
  const invoiceUrl = (payment?.invoiceUrl || payment?.bankSlipUrl) as string | undefined;
  const description = payment?.description as string | undefined;
  const paymentDate = (payment?.paymentDate || payment?.clientPaymentDate) as string | undefined;

  if (!event) return NextResponse.json({ ok: true, ignored: "sem evento" });

  const ehPagamento = PAGOU.includes(event);
  const ehDesfeito = DESFEZ.includes(event);

  // ---- acha o tenant uma vez só: serve para casar fatura e para atualizar assinatura
  let tenantId: string | null = null;
  if (subId || custId) {
    let q = admin.from("tenants").select("id");
    q = subId ? q.eq("asaas_subscription_id", subId) : q.eq("asaas_customer_id", custId as string);
    const { data: t } = await q.maybeSingle();
    tenantId = (t as any)?.id || null;
  }

  // ---- 1) fatura pelo asaas_payment_id
  let inv: any = null;
  if (payId) {
    const { data } = await admin
      .from("platform_invoices")
      .select("id, tenant_id, payment_link, status, amount, due_date, asaas_subscription_id")
      .eq("asaas_payment_id", payId)
      .maybeSingle();
    inv = data || null;
  }

  // ---- 1b) sem id casado: procura a fatura aberta deste tenant que corresponda
  //
  // Fatura criada com link colado à mão nasce sem `asaas_payment_id` e nunca casaria.
  // Aqui ela é encontrada pelo tenant + valor, e o id do Asaas é gravado de volta —
  // então isto conserta o cadastro além de fechar a fatura desta vez.
  if (!inv && tenantId && (ehPagamento || event === "PAYMENT_OVERDUE")) {
    const { data: candidatas } = await admin
      .from("platform_invoices")
      .select("id, tenant_id, amount, due_date, status, asaas_payment_id, asaas_subscription_id")
      .eq("tenant_id", tenantId)
      .in("status", ["pending", "overdue"])
      .is("asaas_payment_id", null)
      .order("due_date", { ascending: true })
      .limit(20);
    const lista = (candidatas as any[]) || [];
    const centavos = (n: any) => Math.round((Number(n) || 0) * 100);
    inv =
      lista.find((x) => centavos(x.amount) === centavos(value) && x.due_date === dueDate) ||
      lista.find((x) => centavos(x.amount) === centavos(value)) ||
      null;
    if (inv && payId) {
      await admin.from("platform_invoices").update({ asaas_payment_id: payId }).eq("id", inv.id);
    }
  }

  if (inv) {
    if (event === "PAYMENT_CREATED") {
      if (invoiceUrl && !inv.payment_link) {
        await admin.from("platform_invoices").update({ payment_link: invoiceUrl }).eq("id", inv.id);
      }
      await import("@/lib/dunning").then((m) => m.sendInvoiceCreated(admin, inv.id)).catch(() => {});
      await registrar(admin, { evento: event, pagamento: payId, resultado: `link garantido na fatura ${inv.id}` });
      return NextResponse.json({ ok: true, event, invoice: inv.id, note: "link garantido" });
    }

    if (ehPagamento) {
      const r = await marcarFaturaPaga(admin, {
        invoiceId: inv.id,
        tenantId: inv.tenant_id,
        dueDate: dueDate || inv.due_date,
        valor: value || Number(inv.amount) || 0,
        daAssinatura: !!(subId || inv.asaas_subscription_id),
        pagoEm: paymentDate ? `${paymentDate}T12:00:00Z` : undefined,
      });
      await registrar(admin, {
        evento: event, pagamento: payId,
        resultado: r.ok ? `fatura ${inv.id} paga${r.reativou ? " e assinatura reativada" : ""}` : "",
        erro: r.ok ? undefined : r.erro,
      });
      // 500 de propósito: o Asaas reenvia. Responder 200 numa escrita recusada é
      // dizer "recebido e tratado" para algo que se perdeu.
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 500 });
      return NextResponse.json({ ok: true, event, invoice: inv.id });
    }

    if (ehDesfeito) {
      // Estorno/chargeback: a fatura volta a ser devida. Sem isto ela ficava "Paga"
      // para sempre e o MRR do painel contava dinheiro que voltou.
      const { error } = await admin
        .from("platform_invoices")
        .update({ status: "overdue", paid_at: null })
        .eq("id", inv.id);
      if (!error && inv.tenant_id) {
        await admin.from("tenants").update({ subscription_status: "past_due" }).eq("id", inv.tenant_id);
      }
      await registrar(admin, {
        evento: event, pagamento: payId,
        resultado: `fatura ${inv.id} voltou a devida (estorno/chargeback)`,
        erro: error ? (error as any).message : undefined,
      });
      if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 });
      return NextResponse.json({ ok: true, event, invoice: inv.id });
    }

    if (event === "PAYMENT_OVERDUE") {
      const { error } = await admin.from("platform_invoices").update({ status: "overdue" }).eq("id", inv.id);
      if (!error && inv.tenant_id) {
        await admin.from("tenants").update({ subscription_status: "past_due" }).eq("id", inv.tenant_id);
      }
      await registrar(admin, { evento: event, pagamento: payId, resultado: `fatura ${inv.id} vencida`, erro: error ? (error as any).message : undefined });
      if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 });
      return NextResponse.json({ ok: true, event, invoice: inv.id });
    }

    if (event === "PAYMENT_DELETED") {
      const { error } = await admin.from("platform_invoices").update({ status: "canceled" }).eq("id", inv.id);
      await registrar(admin, { evento: event, pagamento: payId, resultado: `fatura ${inv.id} cancelada no Asaas`, erro: error ? (error as any).message : undefined });
      if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 });
      return NextResponse.json({ ok: true, event, invoice: inv.id });
    }

    await registrar(admin, { evento: event, pagamento: payId, resultado: `evento sem tratamento (fatura ${inv.id})` });
    return NextResponse.json({ ok: true, event, invoice: inv.id, note: "evento sem tratamento" });
  }

  // ---- 2) não há fatura local
  if (tenantId && payId) {
    // PAGAMENTO SEM FATURA: cria já quitada. Dinheiro que entrou tem de existir no
    // sistema — antes, este caminho apenas marcava o tenant como ativo e devolvia
    // "ok", e a cobrança nunca aparecia na Central.
    if (ehPagamento) {
      const { data: nova, error } = await admin
        .from("platform_invoices")
        .upsert(
          {
            tenant_id: tenantId,
            amount: value,
            description: description || "Assinatura Contatia",
            due_date: dueDate || null,
            payment_link: invoiceUrl || null,
            asaas_payment_id: payId,
            asaas_subscription_id: subId || null,
            status: "paid",
            paid_at: paymentDate ? `${paymentDate}T12:00:00Z` : new Date().toISOString(),
          },
          { onConflict: "asaas_payment_id" }
        )
        .select("id")
        .maybeSingle();
      if (error) {
        await registrar(admin, { evento: event, pagamento: payId, resultado: "", erro: (error as any).message });
        return NextResponse.json({ error: (error as any).message }, { status: 500 });
      }
      const r = await marcarFaturaPaga(admin, {
        invoiceId: (nova as any)?.id,
        tenantId,
        dueDate,
        valor: value,
        daAssinatura: !!subId,
        pagoEm: paymentDate ? `${paymentDate}T12:00:00Z` : undefined,
      });
      await registrar(admin, { evento: event, pagamento: payId, resultado: `fatura criada já paga (${(nova as any)?.id})`, erro: r.ok ? undefined : r.erro });
      return NextResponse.json({ ok: true, event, invoice: (nova as any)?.id, note: "fatura criada já paga" });
    }

    if (event === "PAYMENT_CREATED") {
      await admin.from("platform_invoices").upsert(
        {
          tenant_id: tenantId,
          amount: value,
          description: description || "Assinatura Contatia",
          due_date: dueDate || null,
          payment_link: invoiceUrl || null,
          asaas_payment_id: payId,
          asaas_subscription_id: subId || null,
          status: "pending",
        },
        { onConflict: "asaas_payment_id", ignoreDuplicates: true }
      );
      const { data: created } = await admin.from("platform_invoices").select("id").eq("asaas_payment_id", payId).maybeSingle();
      if (created) await import("@/lib/dunning").then((m) => m.sendInvoiceCreated(admin, (created as any).id)).catch(() => {});
      await registrar(admin, { evento: event, pagamento: payId, resultado: "fatura criada a partir do Asaas" });
      return NextResponse.json({ ok: true, event, note: "fatura criada a partir do Asaas" });
    }
  }

  if (!tenantId) {
    await registrar(admin, { evento: event, pagamento: payId, resultado: "", erro: "tenant não encontrado (assinatura/cliente sem workspace)" });
    return NextResponse.json({ ok: true, ignored: "tenant não encontrado" });
  }

  // ---- 3) sem fatura: ao menos o estado da assinatura
  const patch: any = {};
  if (ehPagamento) {
    patch.subscription_status = "active";
    patch.suspended_at = null;
    if (subId) {
      if (value) patch.mrr = value;
      const base = dueDate ? new Date(`${dueDate.slice(0, 10)}T12:00:00Z`) : new Date();
      // somarMeses respeita o fim do mês: 31/01 + 1 = 28/02, e não 03/03 como o
      // `setMonth` cru fazia.
      patch.current_period_end = diaISO(somarMeses(base, 1));
    }
  } else if (event === "PAYMENT_OVERDUE" || ehDesfeito) {
    patch.subscription_status = "past_due";
  } else if (event === "PAYMENT_DELETED" || event === "SUBSCRIPTION_DELETED") {
    patch.subscription_status = "canceled";
  } else {
    await registrar(admin, { evento: event, pagamento: payId, resultado: "evento sem tratamento (sem fatura)" });
    return NextResponse.json({ ok: true, ignored: event });
  }

  const { error } = await admin.from("tenants").update(patch).eq("id", tenantId);
  await registrar(admin, {
    evento: event, pagamento: payId,
    resultado: `assinatura → ${patch.subscription_status}`,
    erro: error ? (error as any).message : undefined,
  });
  if (error) return NextResponse.json({ error: (error as any).message }, { status: 500 });
  return NextResponse.json({ ok: true, event, tenant: tenantId });
}
