import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Webhook de eventos transacionais do Brevo. Configure no painel Brevo:
// Transactional → Settings → Webhook → eventos hard_bounce, spam, unsubscribe, blocked.
// Protegido por token: /api/webhooks/brevo?token=BREVO_WEBHOOK_TOKEN
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (process.env.BREVO_WEBHOOK_TOKEN && token !== process.env.BREVO_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "sem admin client" }, { status: 500 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  // Brevo manda um evento por request (event) ou uma lista (events)
  const events: any[] = Array.isArray(body?.events) ? body.events : [body];
  let suppressed = 0;

  for (const ev of events) {
    const event = (ev?.event || ev?.["event"] || "").toString().toLowerCase();
    const email = (ev?.email || ev?.["email"] || "").toString().toLowerCase().trim();
    if (!email) continue;

    // mapeia o evento Brevo → razão de supressão
    let reason: string | null = null;
    let status: string | null = null;
    if (event === "hard_bounce" || event === "hardbounce") { reason = "hard_bounce"; status = "hard_bounce"; }
    else if (event === "spam" || event === "complaint") { reason = "complaint"; status = "complaint"; }
    else if (event === "unsubscribe" || event === "unsubscribed") { reason = "unsubscribe"; status = "ok"; }
    else if (event === "blocked" || event === "invalid_email") { reason = "invalid"; status = "invalid"; }
    else if (event === "soft_bounce" || event === "softbounce") { status = "soft_bounce"; } // não suprime, só marca

    // acha o(s) contato(s) com esse e-mail (pode existir em mais de um tenant)
    const { data: contacts } = await admin.from("contacts").select("id, tenant_id").eq("email", email);
    for (const c of (contacts as any[]) || []) {
      if (status) await admin.from("contacts").update({ email_status: status }).eq("id", c.id);
      if (reason) {
        await admin.from("email_suppressions").upsert(
          { tenant_id: c.tenant_id, email, reason },
          { onConflict: "tenant_id,email", ignoreDuplicates: true }
        );
        // pausa cadências de e-mail em curso desse contato (cancela tasks de e-mail pendentes)
        await admin.from("tasks").update({ status: "skipped" }).eq("contact_id", c.id).eq("channel", "email").eq("status", "pending");
        suppressed++;
      }
    }
  }

  return NextResponse.json({ ok: true, suppressed });
}
