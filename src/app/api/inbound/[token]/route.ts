import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Captação não configurada." }, { status: 500, headers: cors });
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("inbound_token", params.token)
    .maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Token inválido." }, { status: 404, headers: cors });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* corpo vazio */
  }
  const name = (body.name || "").toString().trim();
  const email = (body.email || "").toString().trim();
  const phone = (body.phone || "").toString().trim();
  const company = (body.company || "").toString().trim();
  if (!name && !email) {
    return NextResponse.json({ error: "Informe ao menos nome ou e-mail." }, { status: 400, headers: cors });
  }

  // verifica o e-mail na entrada (sintaxe + descartável + MX) e grava o status
  let email_status = "ok";
  if (email) {
    const { verifyEmail } = await import("@/lib/emailverify");
    const check = await verifyEmail(email);
    email_status = check.valid ? "ok" : check.disposable ? "invalid" : check.hasMx ? "ok" : "invalid";
  }

  const { error } = await admin.from("contacts").insert({
    tenant_id: (tenant as any).id,
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
