import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { processEmailDiscovery } from "@/lib/emailDiscoverySync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Drena a fila de descoberta de e-mail (email_discovery_queue = 'pending') de HORA
// EM HORA. Antes isso só rodava 1×/dia dentro do check-replies — lento demais para a
// esteira do Radar. Cada lead com NOME + domínio vira uma conversa SMTP no worker do
// VPS; só grava o e-mail quando o servidor CONFIRMA a caixa (nunca chuta).
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

  try {
    const r = await processEmailDiscovery(admin);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "erro" }, { status: 500 });
  }
}
