import crypto from "crypto";

// ============================================================
// Integração com CRMs.
// Tese: o Contatia não é um CRM — ele ALIMENTA o CRM do cliente.
// Prospecção acontece aqui; quando o lead esquenta, o negócio vai para lá.
// E o que acontece lá (ganhou/perdeu) volta para cá, para a cadência parar.
// ============================================================

export type CrmConnection = {
  id: string;
  tenant_id: string;
  provider: "webhook" | "pipedrive" | "hubspot" | "rdstation";
  webhook_url?: string | null;
  webhook_secret?: string | null;
  api_token?: string | null;
  company_domain?: string | null;
  pipeline_id?: string | null;
  stage_id?: string | null;
  push_on: string;
  pull_enabled: boolean;
};

export type LeadPayload = {
  contact: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    origin?: string | null;
    status?: string | null;
  };
  trigger: "replied" | "meeting";
  meeting?: { datetime: string; title?: string | null } | null;
  cadence?: string | null;
  workspace: string;
};

// ------------------------------------------------------------
// WEBHOOK GENÉRICO — cobre Zapier, n8n, Make, ERPs e qualquer CRM.
// Envia JSON assinado (HMAC) para a URL do cliente.
// ------------------------------------------------------------
export async function pushToWebhook(conn: CrmConnection, payload: LeadPayload): Promise<{ ok?: boolean; remoteId?: string; error?: string }> {
  if (!conn.webhook_url) return { error: "URL do webhook não configurada." };

  const body = JSON.stringify({
    event: payload.trigger === "meeting" ? "meeting.scheduled" : "lead.replied",
    sent_at: new Date().toISOString(),
    data: payload,
  });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (conn.webhook_secret) {
    // assinatura para o destino validar que veio mesmo do Contatia
    headers["X-Contatia-Signature"] = crypto.createHmac("sha256", conn.webhook_secret).update(body).digest("hex");
  }

  try {
    const res = await fetch(conn.webhook_url, { method: "POST", headers, body });
    if (!res.ok) return { error: `Webhook respondeu ${res.status}` };
    return { ok: true };
  } catch (e: any) {
    return { error: `Falha ao chamar o webhook: ${e?.message || e}` };
  }
}

// ------------------------------------------------------------
// PIPEDRIVE — integração nativa.
// Push: cria/acha a Pessoa e abre um Negócio (Deal) no funil escolhido.
// ------------------------------------------------------------
function pdBase(conn: CrmConnection) {
  const domain = (conn.company_domain || "").trim();
  return domain ? `https://${domain}.pipedrive.com/api/v1` : `https://api.pipedrive.com/v1`;
}

export async function pushToPipedrive(conn: CrmConnection, payload: LeadPayload): Promise<{ ok?: boolean; remoteId?: string; error?: string }> {
  const token = conn.api_token;
  if (!token) return { error: "Token da API do Pipedrive não configurado." };
  const base = pdBase(conn);
  const c = payload.contact;

  try {
    // 1) organização (empresa), se houver
    let orgId: number | undefined;
    if (c.company) {
      const orgRes = await fetch(`${base}/organizations/search?term=${encodeURIComponent(c.company)}&exact_match=true&api_token=${token}`);
      const orgJson: any = await orgRes.json();
      orgId = orgJson?.data?.items?.[0]?.item?.id;
      if (!orgId) {
        const created = await fetch(`${base}/organizations?api_token=${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: c.company }),
        });
        const cj: any = await created.json();
        orgId = cj?.data?.id;
      }
    }

    // 2) pessoa: procura por e-mail; cria se não existir
    let personId: number | undefined;
    if (c.email) {
      const pRes = await fetch(`${base}/persons/search?term=${encodeURIComponent(c.email)}&fields=email&exact_match=true&api_token=${token}`);
      const pJson: any = await pRes.json();
      personId = pJson?.data?.items?.[0]?.item?.id;
    }
    if (!personId) {
      const pRes = await fetch(`${base}/persons?api_token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: c.name || c.email || "Contato",
          email: c.email ? [{ value: c.email, primary: true }] : undefined,
          phone: c.phone ? [{ value: c.phone, primary: true }] : undefined,
          org_id: orgId,
        }),
      });
      const pj: any = await pRes.json();
      if (!pj?.success) return { error: `Pipedrive (pessoa): ${pj?.error || "falhou"}` };
      personId = pj?.data?.id;
    }

    // 3) negócio (deal) — o que interessa: a reunião/resposta vira oportunidade lá
    const title = payload.trigger === "meeting"
      ? `Reunião — ${c.company || c.name}`
      : `Respondeu a prospecção — ${c.company || c.name}`;

    const dRes = await fetch(`${base}/deals?api_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        person_id: personId,
        org_id: orgId,
        pipeline_id: conn.pipeline_id ? Number(conn.pipeline_id) : undefined,
        stage_id: conn.stage_id ? Number(conn.stage_id) : undefined,
      }),
    });
    const dj: any = await dRes.json();
    if (!dj?.success) return { error: `Pipedrive (negócio): ${dj?.error || "falhou"}` };
    const dealId = dj?.data?.id;

    // 4) nota com o contexto da prospecção (de onde veio esse lead)
    if (dealId) {
      const nota = [
        `Origem: Contatia (${payload.workspace})`,
        payload.cadence ? `Cadência: ${payload.cadence}` : null,
        payload.trigger === "meeting" && payload.meeting?.datetime
          ? `Reunião marcada para ${new Date(payload.meeting.datetime).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
          : "O contato respondeu à cadência de prospecção.",
      ].filter(Boolean).join("\n");
      await fetch(`${base}/notes?api_token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId, content: nota }),
      });
    }

    return { ok: true, remoteId: String(dealId) };
  } catch (e: any) {
    return { error: `Falha no Pipedrive: ${e?.message || e}` };
  }
}

// ------------------------------------------------------------
// PULL (Pipedrive): traz de volta os negócios ganhos/perdidos.
// Objetivo: se o cliente FECHOU (ou perdeu) lá, a cadência aqui precisa parar
// de perseguir a pessoa. É o que evita o vexame de mandar follow-up para quem
// já assinou o contrato.
// ------------------------------------------------------------
export async function pullFromPipedrive(conn: CrmConnection, remoteIds: string[]): Promise<{ statuses: Record<string, string>; error?: string }> {
  const token = conn.api_token;
  if (!token) return { statuses: {}, error: "Token da API do Pipedrive não configurado." };
  const base = pdBase(conn);
  const statuses: Record<string, string> = {};

  try {
    for (const id of remoteIds) {
      const res = await fetch(`${base}/deals/${id}?api_token=${token}`);
      const j: any = await res.json();
      const st = j?.data?.status; // 'open' | 'won' | 'lost' | 'deleted'
      if (st) statuses[id] = st;
    }
    return { statuses };
  } catch (e: any) {
    return { statuses, error: `Falha ao ler do Pipedrive: ${e?.message || e}` };
  }
}

// ------------------------------------------------------------
// Roteia o push conforme o provedor
// ------------------------------------------------------------
export async function pushLead(conn: CrmConnection, payload: LeadPayload) {
  switch (conn.provider) {
    case "pipedrive": return pushToPipedrive(conn, payload);
    case "hubspot":   return pushToHubspot(conn, payload);
    case "rdstation": return pushToRdstation(conn, payload);
    default:          return pushToWebhook(conn, payload);
  }
}

// ------------------------------------------------------------
// Roteia o pull (o webhook não tem pull — é de mão única por natureza)
// ------------------------------------------------------------
export async function pullDeals(conn: CrmConnection, remoteIds: string[]): Promise<{ statuses: Record<string, string>; error?: string }> {
  switch (conn.provider) {
    case "pipedrive": return pullFromPipedrive(conn, remoteIds);
    case "hubspot":   return pullFromHubspot(conn, remoteIds);
    case "rdstation": return pullFromRdstation(conn, remoteIds);
    default:          return { statuses: {} };
  }
}

// Provedores que suportam sincronia de volta (ganho/perda)
export const PULL_PROVIDERS = ["pipedrive", "hubspot", "rdstation"];

// ------------------------------------------------------------
// HUBSPOT — integração nativa (Private App Token).
// Push: cria/atualiza o Contato, a Empresa e um Negócio (Deal), associando tudo.
// ------------------------------------------------------------
const HS = "https://api.hubapi.com";

export async function pushToHubspot(conn: CrmConnection, payload: LeadPayload): Promise<{ ok?: boolean; remoteId?: string; error?: string }> {
  const token = conn.api_token;
  if (!token) return { error: "Token do HubSpot não configurado." };
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const c = payload.contact;

  try {
    // 1) contato: procura por e-mail; cria se não achar
    let contactId: string | undefined;
    if (c.email) {
      const s = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: c.email }] }],
          limit: 1,
        }),
      });
      const sj: any = await s.json();
      contactId = sj?.results?.[0]?.id;
    }
    if (!contactId) {
      const nome = (c.name || "").trim().split(/\s+/);
      const res = await fetch(`${HS}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          properties: {
            email: c.email || undefined,
            firstname: nome[0] || undefined,
            lastname: nome.slice(1).join(" ") || undefined,
            phone: c.phone || undefined,
            company: c.company || undefined,
            hs_lead_status: "OPEN",
          },
        }),
      });
      const j: any = await res.json();
      if (!res.ok) return { error: `HubSpot (contato): ${j?.message || res.status}` };
      contactId = j?.id;
    }

    // 2) empresa (opcional)
    let companyId: string | undefined;
    if (c.company) {
      const s = await fetch(`${HS}/crm/v3/objects/companies/search`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: c.company }] }],
          limit: 1,
        }),
      });
      const sj: any = await s.json();
      companyId = sj?.results?.[0]?.id;
      if (!companyId) {
        const res = await fetch(`${HS}/crm/v3/objects/companies`, {
          method: "POST", headers: H,
          body: JSON.stringify({ properties: { name: c.company } }),
        });
        const j: any = await res.json();
        companyId = j?.id;
      }
    }

    // 3) negócio
    const title = payload.trigger === "meeting"
      ? `Reunião — ${c.company || c.name}`
      : `Respondeu a prospecção — ${c.company || c.name}`;

    const dealBody: any = {
      properties: {
        dealname: title,
        dealstage: conn.stage_id || undefined,
        pipeline: conn.pipeline_id || undefined,
      },
      associations: [] as any[],
    };
    if (contactId) dealBody.associations.push({ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] });
    if (companyId) dealBody.associations.push({ to: { id: companyId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 5 }] });

    const dres = await fetch(`${HS}/crm/v3/objects/deals`, { method: "POST", headers: H, body: JSON.stringify(dealBody) });
    const dj: any = await dres.json();
    if (!dres.ok) return { error: `HubSpot (negócio): ${dj?.message || dres.status}` };

    // 4) nota com o contexto da prospecção
    const dealId = dj?.id;
    if (dealId) {
      const nota = [
        `Origem: Contatia (${payload.workspace})`,
        payload.trigger === "meeting" && payload.meeting?.datetime
          ? `Reunião marcada para ${new Date(payload.meeting.datetime).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
          : "O contato respondeu à cadência de prospecção.",
      ].join("\n");
      await fetch(`${HS}/crm/v3/objects/notes`, {
        method: "POST", headers: H,
        body: JSON.stringify({
          properties: { hs_note_body: nota, hs_timestamp: new Date().toISOString() },
          associations: [{ to: { id: dealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }] }],
        }),
      });
    }

    return { ok: true, remoteId: String(dealId) };
  } catch (e: any) {
    return { error: `Falha no HubSpot: ${e?.message || e}` };
  }
}

// PULL do HubSpot: negócios ganhos/perdidos voltam e encerram a cadência aqui.
export async function pullFromHubspot(conn: CrmConnection, remoteIds: string[]): Promise<{ statuses: Record<string, string>; error?: string }> {
  const token = conn.api_token;
  if (!token) return { statuses: {}, error: "Token do HubSpot não configurado." };
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const statuses: Record<string, string> = {};

  try {
    for (const id of remoteIds) {
      const res = await fetch(`${HS}/crm/v3/objects/deals/${id}?properties=dealstage,hs_is_closed_won,hs_is_closed`, { headers: H });
      if (!res.ok) continue;
      const j: any = await res.json();
      const p = j?.properties || {};
      // HubSpot marca fechamento por propriedades booleanas
      if (String(p.hs_is_closed_won) === "true") statuses[id] = "won";
      else if (String(p.hs_is_closed) === "true") statuses[id] = "lost";
      else statuses[id] = "open";
    }
    return { statuses };
  } catch (e: any) {
    return { statuses, error: `Falha ao ler do HubSpot: ${e?.message || e}` };
  }
}

// ------------------------------------------------------------
// RD STATION CRM — integração nativa (token na query string).
// API: https://crm.rdstation.com/api/v1 — cria organização, contato e negócio.
// ------------------------------------------------------------
const RD = "https://crm.rdstation.com/api/v1";

export async function pushToRdstation(conn: CrmConnection, payload: LeadPayload): Promise<{ ok?: boolean; remoteId?: string; error?: string }> {
  const token = conn.api_token;
  if (!token) return { error: "Token do RD Station CRM não configurado." };
  const J = { "Content-Type": "application/json" };
  const c = payload.contact;

  try {
    // 1) organização (empresa), se houver
    let orgId: string | undefined;
    if (c.company) {
      const s = await fetch(`${RD}/organizations?token=${token}&q=${encodeURIComponent(c.company)}&limit=1`);
      const sj: any = await s.json();
      orgId = sj?.organizations?.[0]?._id || sj?.[0]?._id;
      if (!orgId) {
        const res = await fetch(`${RD}/organizations?token=${token}`, {
          method: "POST", headers: J,
          body: JSON.stringify({ organization: { name: c.company } }),
        });
        const j: any = await res.json();
        orgId = j?._id;
      }
    }

    // 2) contato
    let contactId: string | undefined;
    if (c.email) {
      const s = await fetch(`${RD}/contacts?token=${token}&email=${encodeURIComponent(c.email)}&limit=1`);
      const sj: any = await s.json();
      contactId = sj?.contacts?.[0]?._id || sj?.[0]?._id;
    }
    if (!contactId) {
      const res = await fetch(`${RD}/contacts?token=${token}`, {
        method: "POST", headers: J,
        body: JSON.stringify({
          contact: {
            name: c.name || c.email || "Contato",
            emails: c.email ? [{ email: c.email }] : undefined,
            phones: c.phone ? [{ phone: c.phone, type: "cellphone" }] : undefined,
            organization_id: orgId,
          },
        }),
      });
      const j: any = await res.json();
      if (!res.ok) return { error: `RD Station (contato): ${j?.errors || res.status}` };
      contactId = j?._id;
    }

    // 3) negócio (deal)
    const title = payload.trigger === "meeting"
      ? `Reunião — ${c.company || c.name}`
      : `Respondeu a prospecção — ${c.company || c.name}`;

    const dealBody: any = {
      deal: {
        name: title,
        organization_id: orgId,
        deal_stage_id: conn.stage_id || undefined,
        // no RD, o funil é definido pela etapa (deal_stage) escolhida
      },
      contacts: contactId ? [{ id: contactId }] : undefined,
    };

    const dres = await fetch(`${RD}/deals?token=${token}`, { method: "POST", headers: J, body: JSON.stringify(dealBody) });
    const dj: any = await dres.json();
    if (!dres.ok) return { error: `RD Station (negócio): ${dj?.errors || dres.status}` };
    const dealId = dj?._id;

    // 4) anotação com o contexto
    if (dealId) {
      const nota = [
        `Origem: Contatia (${payload.workspace})`,
        payload.trigger === "meeting" && payload.meeting?.datetime
          ? `Reunião marcada para ${new Date(payload.meeting.datetime).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
          : "O contato respondeu à cadência de prospecção.",
      ].join(" — ");
      await fetch(`${RD}/annotations?token=${token}`, {
        method: "POST", headers: J,
        body: JSON.stringify({ annotation: { text: nota, deal_id: dealId } }),
      }).catch(() => {});
    }

    return { ok: true, remoteId: String(dealId) };
  } catch (e: any) {
    return { error: `Falha no RD Station: ${e?.message || e}` };
  }
}

// PULL do RD Station: negócio ganho/perdido encerra a cadência aqui.
export async function pullFromRdstation(conn: CrmConnection, remoteIds: string[]): Promise<{ statuses: Record<string, string>; error?: string }> {
  const token = conn.api_token;
  if (!token) return { statuses: {}, error: "Token do RD Station CRM não configurado." };
  const statuses: Record<string, string> = {};

  try {
    for (const id of remoteIds) {
      const res = await fetch(`${RD}/deals/${id}?token=${token}`);
      if (!res.ok) continue;
      const j: any = await res.json();
      // RD expõe win/loss no próprio negócio
      if (j?.win === true) statuses[id] = "won";
      else if (j?.win === false && j?.closed_at) statuses[id] = "lost";
      else statuses[id] = "open";
    }
    return { statuses };
  } catch (e: any) {
    return { statuses, error: `Falha ao ler do RD Station: ${e?.message || e}` };
  }
}
