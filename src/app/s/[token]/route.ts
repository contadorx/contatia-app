import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { POINTS } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();
  if (!admin) {
    return new NextResponse("Rastreio não configurado (falta SUPABASE_SERVICE_ROLE_KEY).", { status: 500 });
  }

  const { data: share } = await admin
    .from("document_shares")
    .select("id, tenant_id, contact_id, total_opens, first_open_at, documents(url, storage_path)")
    .eq("token", params.token)
    .maybeSingle();

  if (!share) return new NextResponse("Link inválido ou expirado.", { status: 404 });

  const url = (share as any).documents?.url as string | undefined;
  const storagePath = (share as any).documents?.storage_path as string | undefined;

  // registra a abertura
  await admin
    .from("document_shares")
    .update({
      total_opens: ((share as any).total_opens || 0) + 1,
      first_open_at: (share as any).first_open_at ?? new Date().toISOString(),
    })
    .eq("id", (share as any).id);

  // evento + score (sinal de compra forte)
  await admin.from("events").insert({
    tenant_id: (share as any).tenant_id,
    contact_id: (share as any).contact_id,
    type: "doc_opened",
    document_share_id: (share as any).id,
    meta: {},
  });
  if ((share as any).contact_id) {
    const { data: c } = await admin.from("contacts").select("score").eq("id", (share as any).contact_id).single();
    await admin
      .from("contacts")
      .update({ score: (c?.score || 0) + (POINTS["doc_opened"] || 15), last_activity_at: new Date().toISOString() })
      .eq("id", (share as any).contact_id);

    // automações: abriu proposta + (talvez) cruzou limiar de score
    try {
      const { runAutomations } = await import("@/lib/automations");
      await runAutomations(admin, { tenantId: (share as any).tenant_id, contactId: (share as any).contact_id, trigger: "doc_opened" });
      await runAutomations(admin, { tenantId: (share as any).tenant_id, contactId: (share as any).contact_id, trigger: "score_gte" });
    } catch {
      /* automação não deve quebrar o rastreio */
    }
  }

  // arquivo no Storage → signed URL temporária; senão, link externo
  if (storagePath) {
    const { data: signed } = await admin.storage.from("proposals").createSignedUrl(storagePath, 60 * 60);
    if (signed?.signedUrl) return NextResponse.redirect(signed.signedUrl);
    return new NextResponse("Não foi possível abrir o arquivo.", { status: 500 });
  }
  if (url) return NextResponse.redirect(url);
  return new NextResponse("Documento sem link de destino.", { status: 200 });
}
