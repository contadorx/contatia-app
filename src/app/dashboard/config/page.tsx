import { createClient } from "@/lib/supabase/server";
import SmtpForm from "@/components/SmtpForm";
import AccountRowActions from "@/components/AccountRowActions";
import WebToLeadSnippet from "@/components/WebToLeadSnippet";

export const dynamic = "force-dynamic";

export default async function Config() {
  const supabase = createClient();
  // NUNCA seleciona smtp_pass/oauth_refresh_token (segredos ficam no servidor)
  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("id, provider, from_email, display_name, is_active, daily_cap, warmup_stage")
    .order("created_at", { ascending: false });

  const { data: tenant } = await supabase.from("tenants").select("inbound_token").maybeSingle();
  const inboundToken = (tenant as any)?.inbound_token as string | undefined;

  const rows = (accounts as any[]) || [];
  const gmailReady = !!process.env.GOOGLE_CLIENT_ID;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-bold">Configurações de e-mail</h1>
      <p className="mt-1 text-sm text-subtle">Conecte as caixas que enviam suas cadências. O envio respeita o limite diário (Envio Seguro).</p>

      <div className="mt-6 space-y-3">
        {rows.length ? (
          rows.map((a) => (
            <div key={a.id} className="card flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-semibold">
                  {a.from_email}{" "}
                  <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs text-subtle">
                    {a.provider === "gmail" ? "Gmail" : "SMTP"}
                  </span>
                  {!a.is_active && <span className="ml-1 text-xs text-subtle">(inativa)</span>}
                </p>
                <p className="text-xs text-subtle">Limite diário: {a.daily_cap}/dia · aquecimento etapa {a.warmup_stage}</p>
              </div>
              <AccountRowActions id={a.id} active={a.is_active} />
            </div>
          ))
        ) : (
          <div className="card p-6 text-sm text-subtle">Nenhuma caixa conectada. Conecte uma abaixo para enviar e-mails direto do app.</div>
        )}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {/* Gmail OAuth */}
        <div className="card p-5">
          <p className="text-sm font-semibold">Gmail / Google Workspace</p>
          <p className="mt-1 text-xs text-subtle">Conecte via OAuth (recomendado): envia e, no futuro, lê respostas.</p>
          {gmailReady ? (
            <a href="/api/gmail/connect" className="btn-brand mt-3 inline-flex">
              Conectar Gmail
            </a>
          ) : (
            <p className="mt-3 rounded-lg bg-warn/10 p-3 text-xs text-warn">
              Falta configurar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no ambiente (Vercel) para habilitar o OAuth do Gmail.
            </p>
          )}
        </div>

        {/* SMTP */}
        <div className="card p-5">
          <p className="text-sm font-semibold">Outro provedor (SMTP)</p>
          <p className="mt-1 text-xs text-subtle">Outlook, servidor próprio, ou Gmail com senha de app.</p>
          <div className="mt-3">
            <SmtpForm />
          </div>
        </div>
      </div>

      {/* Web-to-lead */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-bold">Captação no site (web-to-lead)</h2>
        <p className="mt-1 text-sm text-subtle">Cole um formulário no seu site; os envios viram contatos no pipeline.</p>
        <div className="card mt-3 p-5">
          {inboundToken ? (
            <WebToLeadSnippet token={inboundToken} />
          ) : (
            <p className="text-sm text-subtle">Token de captação indisponível. Rode a migration 0005 para gerá-lo.</p>
          )}
        </div>
      </div>
    </div>
  );
}
