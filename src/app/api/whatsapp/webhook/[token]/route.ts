import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { POINTS } from "@/lib/scoring";

export const dynamic = "force-dynamic";

function digits(s: string) {
  return (s || "").replace(/\D/g, "");
}

// Extrai o texto de qualquer formato de mensagem da Evolution/Baileys.
function extractText(data: any): string {
  const m = data?.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    data?.body ||
    ""
  );
}

// Identifica o TIPO de mídia (o binário é buscado sob demanda, não aqui).
function detectMedia(data: any): { type: string | null; mime: string | null } {
  const m = data?.message || {};
  if (m.imageMessage) return { type: "image", mime: m.imageMessage.mimetype || "image/jpeg" };
  if (m.audioMessage) return { type: "audio", mime: m.audioMessage.mimetype || "audio/ogg" };
  if (m.videoMessage) return { type: "video", mime: m.videoMessage.mimetype || "video/mp4" };
  if (m.documentMessage) return { type: "document", mime: m.documentMessage.mimetype || "application/octet-stream" };
  if (m.stickerMessage) return { type: "sticker", mime: m.stickerMessage.mimetype || "image/webp" };
  return { type: null, mime: null };
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

  const tenant_id = (acc as any).tenant_id as string;
  const account_id = (acc as any).id as string;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* vazio */
  }

  const event = String(body?.event || body?.type || "").toLowerCase();
  const data = body?.data || body?.message || body;

  // ---- CONNECTION_UPDATE: o número conectou/desconectou ----
  const looksLikeConnection = event.includes("connection") || (data?.state && !data?.key);
  if (looksLikeConnection) {
    const state = String(data?.state || data?.connection || "").toLowerCase() || "desconhecido";
    await admin
      .from("whatsapp_accounts")
      .update({ status: state, last_seen_at: new Date().toISOString() })
      .eq("id", account_id);
    if (state !== "open") {
      await admin.from("events").insert({
        tenant_id,
        type: "note",
        meta: { text: `WhatsApp: conexão do número mudou para "${state}".` },
      });
    }
    return NextResponse.json({ ok: true, connection: state });
  }

  // ---- MENSAGEM RECEBIDA ----
  const fromMe = data?.key?.fromMe ?? data?.fromMe ?? false;
  const jid = data?.key?.remoteJid || data?.remoteJid || "";
  const fromPhone = digits(String(jid).split("@")[0]);

  // ignora status@broadcast, grupos (@g.us) e mensagens minhas
  if (fromMe || !fromPhone || String(jid).includes("@g.us") || String(jid).includes("broadcast")) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const text = extractText(data);
  const media = detectMedia(data);
  const waId = data?.key?.id || null;
  const last10 = fromPhone.slice(-10);

  // número bloqueado (LGPD/pessoal) → ignora silenciosamente
  const { data: blocked } = await admin
    .from("whatsapp_blocklist")
    .select("phone")
    .eq("tenant_id", tenant_id);
  if (((blocked as any[]) || []).some((b) => digits(b.phone).slice(-10) === last10)) {
    return NextResponse.json({ ok: true, blocked: true });
  }

  // acha o contato pelo telefone (mesmo tenant)
  const { data: contacts } = await admin
    .from("contacts")
    .select("id, phone, score")
    .eq("tenant_id", tenant_id);
  const contact = ((contacts as any[]) || []).find(
    (c) => digits(c.phone || "").slice(-10) === last10 && last10.length >= 8
  );

  // GUARDA A MENSAGEM (mesmo de número desconhecido — nada se perde)
  // dedupe pelo id da mensagem
  if (waId) {
    const { data: exists } = await admin
      .from("whatsapp_messages")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("wa_message_id", waId)
      .maybeSingle();
    if (exists) return NextResponse.json({ ok: true, duplicate: true });
  }
  await admin.from("whatsapp_messages").insert({
    tenant_id,
    account_id,
    contact_id: contact?.id || null,
    phone: fromPhone,
    direction: "in",
    text,
    media_type: media.type,
    media_mime: media.mime,
    wa_message_id: waId,
    raw: data || {},
  });

  // se é um contato conhecido em cadência ativa → pausa a sequência e pontua
  let marked = 0;
  if (contact) {
    const { data: enrs } = await admin
      .from("enrollments")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("contact_id", contact.id)
      .eq("status", "active");
    for (const e of (enrs as any[]) || []) {
      await admin.from("enrollments").update({ status: "replied" }).eq("id", e.id);
      await admin.from("tasks").update({ status: "skipped" }).eq("enrollment_id", e.id).eq("status", "pending");
      marked++;
    }
    if (marked > 0) {
      await admin.from("events").insert({
        tenant_id,
        contact_id: contact.id,
        type: "replied",
        meta: { via: "whatsapp", text: text?.slice(0, 280) || "" },
      });
      await admin
        .from("contacts")
        .update({ score: (contact.score || 0) + (POINTS["replied"] || 30), last_activity_at: new Date().toISOString() })
        .eq("id", contact.id);
    }
  }

  return NextResponse.json({ ok: true, stored: true, matched: !!contact, marked });
}
