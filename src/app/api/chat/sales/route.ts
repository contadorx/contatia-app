import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { assistantReply, buildSystem, extractContact, type ChatMsg } from "@/lib/aichat";
import { notifyEscalation } from "@/lib/aiNotify";

export const dynamic = "force-dynamic";

// IA de VENDAS — endpoint PÚBLICO chamado pelo widget do site (contatia.com.br).
// Guardas de custo: janela de contexto curta (no lib), teto por conversa e
// circuit-breaker global diário. Escala virando lead (conversa com contato) + e-mail.

const ALLOW = [
  "https://contatia.com.br",
  "https://www.contatia.com.br",
  "http://localhost:3000",
];
const MAX_USER_MSGS = 30;
const DAILY_USER_MSG_CAP = 800;

function cors(origin: string | null) {
  const o = origin && ALLOW.includes(origin) ? origin : ALLOW[0];
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

// GET → o widget do site inicializa com a saudação editável + on/off.
export async function GET(req: NextRequest) {
  const headers = cors(req.headers.get("origin"));
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ enabled: false }, { headers });
  const { data } = await admin.from("ai_assistants").select("enabled, greeting").eq("kind", "sales").maybeSingle();
  return NextResponse.json(
    { enabled: !!(data as any)?.enabled, greeting: (data as any)?.greeting || "Oi! Como posso ajudar?" },
    { headers }
  );
}

export async function POST(req: NextRequest) {
  const headers = cors(req.headers.get("origin"));
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "indisponível" }, { status: 503, headers });

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const message = (body?.message || "").toString().slice(0, 2000).trim();
  if (!message) return NextResponse.json({ error: "mensagem vazia" }, { status: 400, headers });

  const { data: asst } = await admin.from("ai_assistants").select("*").eq("kind", "sales").maybeSingle();
  if (!asst || !(asst as any).enabled)
    return NextResponse.json({ error: "indisponível" }, { status: 403, headers });

  // circuit-breaker global do dia
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { count: today } = await admin
    .from("ai_messages")
    .select("id", { count: "exact", head: true })
    .eq("role", "user")
    .gte("created_at", since.toISOString());
  if ((today || 0) > DAILY_USER_MSG_CAP)
    return NextResponse.json(
      { reply: "Estamos com muitas conversas agora 🙏 Tente daqui a pouco — ou deixe seu e-mail que a gente te chama.", escalated: false },
      { headers }
    );

  let convId = body?.conversationId as string | undefined;
  let history: ChatMsg[] = [];
  if (convId) {
    const { data: msgs } = await admin
      .from("ai_messages")
      .select("role, content")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    history = ((msgs as any[]) || [])
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
  } else {
    const { data: c } = await admin.from("ai_conversations").insert({ kind: "sales", source: "site" }).select("id").single();
    convId = (c as any)?.id;
  }
  if (!convId) return NextResponse.json({ error: "erro" }, { status: 500, headers });

  if (history.filter((m) => m.role === "user").length >= MAX_USER_MSGS) {
    return NextResponse.json(
      { conversationId: convId, reply: "Acho melhor te conectar com alguém do time pra seguir 🙂 Me deixa seu nome e o melhor e-mail ou WhatsApp?", escalated: true },
      { headers }
    );
  }

  const msgs: ChatMsg[] = [...history, { role: "user", content: message }];
  const system = buildSystem((asst as any).brain);
  const r = await assistantReply({ system, messages: msgs, model: (asst as any).model || undefined });
  if (r.error)
    return NextResponse.json({ conversationId: convId, reply: "Ops, tive um problema aqui. Pode tentar de novo?", escalated: false }, { headers });
  const reply = r.text || "Pode reformular?";

  await admin.from("ai_messages").insert([
    { conversation_id: convId, role: "user", content: message },
    { conversation_id: convId, role: "assistant", content: reply },
  ]);

  const contact = extractContact(msgs);
  const patch: any = { last_at: new Date().toISOString(), msg_count: msgs.length + 1 };
  if (contact.email) patch.visitor_email = contact.email;
  if (contact.phone) patch.visitor_phone = contact.phone;
  if (body?.name) patch.visitor_name = String(body.name).slice(0, 80);
  await admin.from("ai_conversations").update(patch).eq("id", convId);

  if (r.escalate) {
    const transcript = [...msgs, { role: "assistant" as const, content: reply }]
      .map((m) => `${m.role === "user" ? "Lead" : "IA"}: ${m.content}`)
      .join("\n");
    await admin.from("ai_conversations").update({ status: "escalated" }).eq("id", convId);
    await notifyEscalation({
      kind: "sales",
      notifyEmail: (asst as any).notify_email,
      visitorName: patch.visitor_name,
      visitorEmail: contact.email,
      visitorPhone: contact.phone,
      transcript,
      source: "site",
    });
    return NextResponse.json({ conversationId: convId, reply, escalated: true }, { headers });
  }

  return NextResponse.json({ conversationId: convId, reply, escalated: false }, { headers });
}
