import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { POINTS } from "@/lib/scoring";

export const dynamic = "force-dynamic";

// GIF transparente de 1x1 (43 bytes). Fica embutido para a rota NUNCA depender de
// arquivo em disco nem de outra requisição.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

// A resposta é sempre a mesma imagem, com o mesmo status 200 — inclusive para token
// inválido. Um 404 aqui desenharia o ícone de "imagem quebrada" no e-mail do
// destinatário, ou seja: o rastreio apareceria para quem está sendo rastreado.
function pixel() {
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      // sem cache: senão o proxy do Gmail entrega a imagem guardada e a segunda
      // abertura nunca chega até aqui.
      "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();
  if (!admin) return pixel();

  try {
    const { data: row } = await admin
      .from("email_opens")
      .select("id, tenant_id, contact_id, opens, first_open_at")
      .eq("token", params.token)
      .maybeSingle();
    if (!row) return pixel();

    const R = row as any;
    const agora = new Date().toISOString();
    const primeira = !R.first_open_at;

    await admin
      .from("email_opens")
      .update({ opens: (R.opens || 0) + 1, first_open_at: R.first_open_at ?? agora, last_open_at: agora })
      .eq("id", R.id);

    // ============================================================
    // O EVENTO SÓ NA PRIMEIRA ABERTURA
    //
    // Um e-mail é reaberto o tempo todo (rolar a caixa, reencaminhar, o proxy
    // recarregar). Gravar um evento por carregamento inflaria o score e encheria a
    // linha do tempo do contato de ruído — a segunda abertura não é notícia nova.
    // O contador `opens` continua somando tudo, para quem quiser olhar.
    // ============================================================
    if (primeira && R.contact_id) {
      await admin.from("events").insert({
        tenant_id: R.tenant_id,
        contact_id: R.contact_id,
        type: "email_opened",
        meta: { fonte: "pixel" },
      });
      const { data: c } = await admin.from("contacts").select("score").eq("id", R.contact_id).single();
      await admin
        .from("contacts")
        .update({ score: (c?.score || 0) + (POINTS["email_opened"] || 15), last_activity_at: agora })
        .eq("id", R.contact_id);
      try {
        const { runAutomations } = await import("@/lib/automations");
        await runAutomations(admin, { tenantId: R.tenant_id, contactId: R.contact_id, trigger: "score_gte" });
      } catch {
        /* automação nunca pode impedir a entrega do pixel */
      }
    }
  } catch {
    /* qualquer falha: devolve a imagem assim mesmo */
  }

  return pixel();
}
