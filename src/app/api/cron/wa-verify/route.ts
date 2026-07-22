import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { verifyContactsBatch } from "@/lib/waVerify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Drena a fila de verificação de WhatsApp (contacts.wa_status = 'queued'), por
// tenant, em lotes pequenos por rodada. Rodando de hora em hora, o volume diário
// fica alto o suficiente sem sinalizar scraping ao WhatsApp (anti-ban).
const BATCH_POR_TENANT = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}` && key !== secret) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SERVICE_ROLE ausente" }, { status: 500 });

  // instâncias Evolution ativas (uma por tenant, a mais antiga)
  const { data: accts } = await admin
    .from("whatsapp_accounts")
    .select("id, tenant_id, evolution_url, api_key, instance, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  const porTenant = new Map<string, any>();
  for (const a of (accts as any[]) || []) if (!porTenant.has(a.tenant_id)) porTenant.set(a.tenant_id, a);

  let verificados = 0, comWa = 0;
  const errors: string[] = [];
  const DEADLINE = Date.now() + 45_000;

  for (const acc of porTenant.values()) {
    if (Date.now() > DEADLINE) { errors.push("orçamento esgotado; resto na próxima rodada"); break; }

    const { data: rows } = await admin
      .from("contacts")
      .select("id, phone")
      .eq("tenant_id", acc.tenant_id)
      .eq("wa_status", "queued")
      .limit(BATCH_POR_TENANT);
    const list = ((rows as any[]) || []);
    if (!list.length) continue;

    try {
      const results = await verifyContactsBatch(acc, list);
      const nowIso = new Date().toISOString();
      await Promise.all(
        results.map((r) => {
          if (r.status === "valid") comWa++;
          return admin
            .from("contacts")
            .update({ wa_status: r.status, wa_number: r.number, wa_checked_at: nowIso })
            .eq("id", r.id);
        })
      );
      verificados += results.length;
    } catch (e: any) {
      // não marca — os 'queued' seguem na fila e o cron tenta de novo
      errors.push(`${acc.tenant_id}: ${e?.message || "erro"}`);
    }
  }

  return NextResponse.json({ ok: true, verificados, comWa, errors });
}
