import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { POINTS } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();
  if (!admin) return new NextResponse("Rastreio não configurado.", { status: 500 });

  const { data: link } = await admin
    .from("link_clicks")
    .select("id, tenant_id, contact_id, url, clicks, first_click_at")
    .eq("token", params.token)
    .maybeSingle();
  if (!link) return new NextResponse("Link inválido.", { status: 404 });

  const L = link as any;

  await admin
    .from("link_clicks")
    .update({ clicks: (L.clicks || 0) + 1, first_click_at: L.first_click_at ?? new Date().toISOString() })
    .eq("id", L.id);

  if (L.contact_id) {
    await admin.from("events").insert({ tenant_id: L.tenant_id, contact_id: L.contact_id, type: "link_clicked", meta: { url: L.url } });
    const { data: c } = await admin.from("contacts").select("score").eq("id", L.contact_id).single();
    await admin
      .from("contacts")
      .update({ score: (c?.score || 0) + (POINTS["link_clicked"] || 10), last_activity_at: new Date().toISOString() })
      .eq("id", L.contact_id);
    try {
      const { runAutomations } = await import("@/lib/automations");
      await runAutomations(admin, { tenantId: L.tenant_id, contactId: L.contact_id, trigger: "link_clicked" });
      await runAutomations(admin, { tenantId: L.tenant_id, contactId: L.contact_id, trigger: "score_gte" });
    } catch {
      /* não bloqueia o redirect */
    }
  }

  // valida e redireciona
  try {
    const u = new URL(L.url);
    if (u.protocol === "http:" || u.protocol === "https:") return NextResponse.redirect(L.url);
  } catch {
    /* url inválida */
  }
  return new NextResponse("Destino inválido.", { status: 400 });
}
