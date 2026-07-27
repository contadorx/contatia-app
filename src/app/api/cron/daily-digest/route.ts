import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { runDailyDigest } from "@/lib/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Resumo diário "você tem N toques na fila hoje" — retenção. Agendado no vercel.json.
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

  const r = await runDailyDigest(admin);
  return NextResponse.json({ ok: true, ...r });
}
