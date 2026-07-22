import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { captureContactsBatch, buildCaptureUpdate } from "@/lib/webPhone";
import { dominioDe } from "@/lib/emailFinder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Drena a fila de captura no site (contacts.web_capture = 'queued'). Raspagem é
// HTTP puro (não depende do Evolution/worker). Um wa.me vira WhatsApp confirmado;
// um telefone comum cai na fila de verificação, que o cron wa-verify completa.
const BATCH = 24;

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

  const { data: rows } = await admin
    .from("contacts")
    .select("id, tenant_id, phone, company_domain, wa_status, accounts(domain)")
    .eq("web_capture", "queued")
    .limit(BATCH);
  const list = ((rows as any[]) || []).map((c) => ({
    id: c.id,
    tenant_id: c.tenant_id,
    phone: c.phone as string | null,
    wa_status: c.wa_status as string | null,
    domain: dominioDe(c.company_domain || c.accounts?.domain || null),
  }));
  if (!list.length) return NextResponse.json({ ok: true, capturados: 0 });

  // sem domínio → não há o que raspar
  const semDom = list.filter((c) => !c.domain);
  await Promise.all(semDom.map((c) => admin.from("contacts").update({ web_capture: "notfound" }).eq("id", c.id)));

  const comDom = list.filter((c) => c.domain);
  const byId = new Map(comDom.map((c) => [c.id, c]));
  const results = await captureContactsBatch(
    comDom.map((c) => ({ id: c.id, domain: c.domain })),
    6,
    Date.now() + 45_000
  );

  const nowIso = new Date().toISOString();
  let achou = 0, whats = 0;
  await Promise.all(
    results.map((r) => {
      if (r.skipped) return null; // não alcançado nesta rodada → segue 'queued'
      const cur = byId.get(r.id)!;
      if (r.whatsapp) { achou++; whats++; }
      else if (r.phone) achou++;
      return admin.from("contacts").update(buildCaptureUpdate(r, cur, nowIso)).eq("id", r.id);
    })
  );

  return NextResponse.json({ ok: true, capturados: comDom.length, achou, whats });
}
