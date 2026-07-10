import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const back = `${origin}/dashboard/config`;

  if (!code) return NextResponse.redirect(`${back}?erro=sem_codigo`);
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(`${back}?erro=gmail_nao_configurado`);
  }

  // 1) troca o code por tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin}/api/gmail/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tok = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
  if (!tok.refresh_token) {
    // Google só devolve refresh_token no 1º consentimento; prompt=consent força isso.
    return NextResponse.redirect(`${back}?erro=sem_refresh_token`);
  }

  // 2) descobre o e-mail da conta
  let email = "";
  try {
    const ui = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const info = (await ui.json()) as { email?: string };
    email = info.email || "";
  } catch {
    /* segue sem e-mail; usuário ajusta depois */
  }

  // 3) salva a caixa vinculada ao tenant do usuário logado
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.tenant_id) return NextResponse.redirect(`${back}?erro=sem_workspace`);

  await supabase.from("email_accounts").insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    provider: "gmail",
    from_email: email || user.email,
    display_name: null,
    oauth_refresh_token: tok.refresh_token,
    is_active: true,
  });

  return NextResponse.redirect(`${back}?ok=gmail_conectado`);
}
