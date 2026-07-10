import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { fetchRecentSenders } from "@/lib/imap";
import { POINTS } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const { data: accounts } = await admin
    .from("email_accounts")
    .select("id, tenant_id, smtp_host, smtp_user, smtp_pass, imap_host, imap_port, last_reply_check_at")
    .eq("detect_replies", true)
    .eq("is_active", true);

  let marked = 0;
  const errors: string[] = [];

  for (const acc of (accounts as any[]) || []) {
    const since = acc.last_reply_check_at
      ? new Date(acc.last_reply_check_at)
      : new Date(Date.now() - 24 * 3600 * 1000);

    let senders: string[] = [];
    try {
      senders = await fetchRecentSenders(acc, since);
    } catch (e: any) {
      errors.push(`${acc.id}: ${e?.message || "imap erro"}`);
      continue; // não atualiza o cursor se falhou, tenta de novo depois
    }

    if (senders.length) {
      const set = new Set(senders);
      const { data: enrs } = await admin
        .from("enrollments")
        .select("id, contact_id, contacts(email)")
        .eq("tenant_id", acc.tenant_id)
        .eq("status", "active");

      for (const e of (enrs as any[]) || []) {
        const email = (e.contacts?.email || "").toLowerCase();
        if (!email || !set.has(email)) continue;
        await admin.from("enrollments").update({ status: "replied" }).eq("id", e.id);
        await admin.from("tasks").update({ status: "skipped" }).eq("enrollment_id", e.id).eq("status", "pending");
        await admin.from("events").insert({
          tenant_id: acc.tenant_id,
          contact_id: e.contact_id,
          type: "replied",
          meta: { via: "imap" },
        });
        const { data: c } = await admin.from("contacts").select("score").eq("id", e.contact_id).single();
        await admin
          .from("contacts")
          .update({ score: (c?.score || 0) + (POINTS["replied"] || 30), last_activity_at: new Date().toISOString() })
          .eq("id", e.contact_id);
        marked++;
      }
    }

    await admin.from("email_accounts").update({ last_reply_check_at: new Date().toISOString() }).eq("id", acc.id);
  }

  return NextResponse.json({ ok: true, accounts: (accounts as any[])?.length || 0, marked, errors });
}
