import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// A3: esta rota é PÚBLICA (o token fica no HTML do site do cliente). Sem defesas ela
// dá pra floodar o CRM, duplicar contatos e — via checagem de MX — virar amplificador
// de DNS. Mitigações abaixo: rate-limit em memória (por token+IP), teto por hora no
// tenant, dedup por e-mail, limite de tamanho dos campos e validação SEM rede (só
// sintaxe + descartável; nada de resolveMx aqui).

// limitador em memória (best-effort por instância quente do serverless)
type Bucket = { count: number; resetAt: number };
const RL = new Map<string, Bucket>();
const RL_WINDOW_MS = 60_000;
const RL_MAX = 20; // req/min por token+IP
function rateLimited(key: string): boolean {
  const now = Date.now();
  const b = RL.get(key);
  if (!b || now > b.resetAt) {
    RL.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    if (RL.size > 5000) for (const [k, v] of RL) if (now > v.resetAt) RL.delete(k); // poda
    return false;
  }
  b.count += 1;
  return b.count > RL_MAX;
}

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "throwaway.email", "yopmail.com", "getnada.com", "trashmail.com", "sharklasers.com",
  "maildrop.cc", "dispostable.com", "fakeinbox.com", "mailnesia.com",
]);
const EMAIL_RE = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;
const clip = (v: string, n: number) => v.slice(0, n);

const HOURLY_CAP = 300; // teto de leads web/hora por workspace (form real não chega perto)

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Captação não configurada." }, { status: 500, headers: cors });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
  if (rateLimited(`${params.token}:${ip}`)) {
    return NextResponse.json({ error: "Muitas requisições. Tente em instantes." }, { status: 429, headers: cors });
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("inbound_token", params.token)
    .maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Token inválido." }, { status: 404, headers: cors });
  const tenant_id = (tenant as any).id as string;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* corpo vazio */
  }
  const name = clip((body.name || "").toString().trim(), 120);
  const email = clip((body.email || "").toString().trim().toLowerCase(), 160);
  const phone = clip((body.phone || "").toString().trim(), 40);
  const company = clip((body.company || "").toString().trim(), 160);
  if (!name && !email) {
    return NextResponse.json({ error: "Informe ao menos nome ou e-mail." }, { status: 400, headers: cors });
  }

  // teto por hora no workspace — barra o flood sem depender de store externo
  const sinceIso = new Date(Date.now() - 3600_000).toISOString();
  const { count: recent } = await admin
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant_id)
    .eq("origin", "web")
    .gte("created_at", sinceIso);
  if ((recent ?? 0) >= HOURLY_CAP) {
    return NextResponse.json({ error: "Limite de captação atingido para este período." }, { status: 429, headers: cors });
  }

  // dedup: já existe contato com este e-mail no workspace? não duplica (idempotente)
  if (email) {
    const { data: dup } = await admin
      .from("contacts")
      .select("id")
      .eq("tenant_id", tenant_id)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (dup) return NextResponse.json({ ok: true, dedup: true }, { status: 200, headers: cors });
  }

  // validação SEM rede: só sintaxe + descartável (o MX ao vivo fica nos fluxos
  // autenticados — evita virar amplificador de DNS nesta rota pública).
  let email_status = "ok";
  if (email) {
    const m = email.match(EMAIL_RE);
    email_status = !m || DISPOSABLE.has(m[1]) ? "invalid" : "ok";
  }

  const { error } = await admin.from("contacts").insert({
    tenant_id,
    name: name || email,
    email: email || null,
    phone: phone || null,
    company: company || null,
    origin: "web",
    status: "new",
    email_status,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: cors });

  return NextResponse.json({ ok: true, email_status }, { status: 200, headers: cors });
}
