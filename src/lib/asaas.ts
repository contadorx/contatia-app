import "server-only";

// Integração com a API do Asaas. Usa ASAAS_API_KEY.
// Ambiente: produção por padrão; defina ASAAS_ENV=sandbox para testes.
function base() {
  return (process.env.ASAAS_ENV || "").toLowerCase() === "sandbox"
    ? "https://sandbox.asaas.com/api/v3"
    : "https://api.asaas.com/v3";
}

function headers() {
  const key = process.env.ASAAS_API_KEY;
  return key ? { access_token: key, "content-type": "application/json", accept: "application/json" } : null;
}

// Cria (ou reusa) um cliente no Asaas e devolve o customerId.
export async function ensureAsaasCustomer(input: { name: string; email?: string | null; cpfCnpj?: string | null; existingId?: string | null }): Promise<{ id?: string; error?: string }> {
  const h = headers();
  if (!h) return { error: "ASAAS_API_KEY não configurada." };

  const doc = (input.cpfCnpj || "").replace(/\D/g, "") || undefined;

  // customer já existe: atualiza com o documento (o Asaas exige CPF/CNPJ para cobrar;
  // customers antigos podem ter sido criados sem ele)
  if (input.existingId) {
    if (doc) {
      const up = await fetch(`${base()}/customers/${input.existingId}`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: input.name, email: input.email || undefined, cpfCnpj: doc }),
      });
      if (!up.ok) {
        let d = `${up.status}`;
        try { const j = await up.json(); d = j?.errors?.[0]?.description || d; } catch {}
        return { error: `Asaas (atualizar cliente): ${d}` };
      }
    }
    return { id: input.existingId };
  }

  const res = await fetch(`${base()}/customers`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ name: input.name, email: input.email || undefined, cpfCnpj: doc }),
  });
  if (!res.ok) {
    let d = `${res.status}`;
    try { const j = await res.json(); d = j?.errors?.[0]?.description || d; } catch {}
    return { error: `Asaas (cliente): ${d}` };
  }
  const j = (await res.json()) as { id?: string };
  return { id: j.id };
}

// Cria uma cobrança avulsa e devolve id + link de pagamento (invoiceUrl).
export async function createAsaasCharge(input: {
  customerId: string;
  value: number;
  dueDate: string; // YYYY-MM-DD
  description?: string;
  billingType?: "BOLETO" | "PIX" | "CREDIT_CARD" | "UNDEFINED";
}): Promise<{ id?: string; link?: string; error?: string }> {
  const h = headers();
  if (!h) return { error: "ASAAS_API_KEY não configurada." };

  const res = await fetch(`${base()}/payments`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      customer: input.customerId,
      billingType: input.billingType || "UNDEFINED", // UNDEFINED = cliente escolhe (boleto/pix/cartão)
      value: Number(input.value),
      dueDate: input.dueDate,
      description: input.description || "Assinatura Contatia",
    }),
  });
  if (!res.ok) {
    let d = `${res.status}`;
    try { const j = await res.json(); d = j?.errors?.[0]?.description || d; } catch {}
    return { error: `Asaas (cobrança): ${d}` };
  }
  const j = (await res.json()) as { id?: string; invoiceUrl?: string; bankSlipUrl?: string };
  return { id: j.id, link: j.invoiceUrl || j.bankSlipUrl };
}

// Cria uma ASSINATURA recorrente mensal e devolve o link da 1ª cobrança.
// value = preço por assento × nº de assentos.
export async function createAsaasSubscription(input: {
  customerId: string;
  value: number;
  description?: string;
  billingType?: "BOLETO" | "PIX" | "CREDIT_CARD" | "UNDEFINED";
}): Promise<{ id?: string; link?: string; error?: string }> {
  const h = headers();
  if (!h) return { error: "ASAAS_API_KEY não configurada." };

  const next = new Date();
  next.setDate(next.getDate() + 3); // primeira cobrança em 3 dias
  const dueDate = next.toISOString().slice(0, 10);

  const res = await fetch(`${base()}/subscriptions`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      customer: input.customerId,
      billingType: input.billingType || "UNDEFINED",
      value: Number(input.value),
      nextDueDate: dueDate,
      cycle: "MONTHLY",
      description: input.description || "Assinatura Contatia",
    }),
  });
  if (!res.ok) {
    let d = `${res.status}`;
    try { const j = await res.json(); d = j?.errors?.[0]?.description || d; } catch {}
    return { error: `Asaas (assinatura): ${d}` };
  }
  const sub = (await res.json()) as { id?: string };

  // busca a 1ª cobrança da assinatura para devolver o link de pagamento
  let link: string | undefined;
  try {
    const pr = await fetch(`${base()}/subscriptions/${sub.id}/payments`, { headers: h });
    if (pr.ok) {
      const pj = (await pr.json()) as { data?: { invoiceUrl?: string; bankSlipUrl?: string }[] };
      const first = pj.data?.[0];
      link = first?.invoiceUrl || first?.bankSlipUrl;
    }
  } catch { /* link vem depois pelo webhook se necessário */ }

  return { id: sub.id, link };
}

// Atualiza o VALOR de uma assinatura recorrente (ex.: mudou o nº de assentos ou entrou/saiu
// um cupom). updatePendingPayments reprecifica também as cobranças já geradas em aberto.
export async function updateAsaasSubscription(subscriptionId: string, value: number): Promise<{ ok?: boolean; error?: string }> {
  const h = headers();
  if (!h) return { error: "ASAAS_API_KEY não configurada." };
  const res = await fetch(`${base()}/subscriptions/${subscriptionId}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ value: Number(value), updatePendingPayments: true }),
  });
  if (!res.ok && res.status !== 404) {
    let d = `${res.status}`;
    try { const j = await res.json(); d = j?.errors?.[0]?.description || d; } catch {}
    return { error: `Asaas (atualizar assinatura): ${d}` };
  }
  return { ok: true };
}

// Cancela uma assinatura recorrente (usado ao trocar de plano, para não cobrar em dobro).
export async function cancelAsaasSubscription(subscriptionId: string): Promise<{ ok?: boolean; error?: string }> {
  const h = headers();
  if (!h) return { error: "ASAAS_API_KEY não configurada." };
  const res = await fetch(`${base()}/subscriptions/${subscriptionId}`, { method: "DELETE", headers: h });
  if (!res.ok && res.status !== 404) {
    let d = `${res.status}`;
    try { const j = await res.json(); d = j?.errors?.[0]?.description || d; } catch {}
    return { error: `Asaas (cancelar assinatura): ${d}` };
  }
  return { ok: true };
}
