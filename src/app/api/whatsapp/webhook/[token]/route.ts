import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { POINTS } from "@/lib/scoring";

export const dynamic = "force-dynamic";

function digits(s: string) {
  return (s || "").replace(/\D/g, "");
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "não configurado" }, { status: 500 });

  const { data: acc } = await admin
    .from("whatsapp_accounts")
    .select("id, tenant_id")
    .eq("inbound_token", params.token)
    .maybeSingle();
  if (!acc) return NextResponse.json({ error: "token inválido" }, { status: 404 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* vazio */
  }

  // Evolution: data.key.remoteJid (ex.: 55119...@s.whatsapp.net) + data.key.fromMe
  const data = body?.data || body?.message || body;
  const fromMe = data?.key?.fromMe ?? data?.fromMe ?? false;
  const jid = data?.key?.remoteJid || data?.remoteJid || "";
  const fromPhone = digits(String(jid).split("@")[0]);

  if (fromMe || !fromPhone) return NextResponse.json({ ok: true, skipped: true });

  const last10 = fromPhone.slice(-10);

  // contatos do tenant em cadência ativa cujo telefone bate
  const { data: enrs } = await admin
    .from("enrollments")
    .select("id, contact_id, contacts(phone)")
    .eq("tenant_id", (acc as any).tenant_id)
    .eq("status", "active");

  let marked = 0;
  for (const e of (enrs as any[]) || []) {
    const p = digits(e.contacts?.phone || "");
    if (!p || p.slice(-10) !== last10) continue;
    await admin.from("enrollments").update({ status: "replied" }).eq("id", e.id);
    await admin.from("tasks").update({ status: "skipped" }).eq("enrollment_id", e.id).eq("status", "pending");
    await admin.from("events").insert({
      tenant_id: (acc as any).tenant_id,
      contact_id: e.contact_id,
      type: "replied",
      meta: { via: "whatsapp" },
    });
    const { data: c } = await admin.from("contacts").select("score").eq("id", e.contact_id).single();
    await admin
      .from("contacts")
      .update({ score: (c?.score || 0) + (POINTS["replied"] || 30), last_activity_at: new Date().toISOString() })
      .eq("id", e.contact_id);
    marked++;
  }

  return NextResponse.json({ ok: true, marked });
}
