import { createClient } from "@/lib/supabase/server";
import SmtpForm from "@/components/SmtpForm";
import AccountRowActions from "@/components/AccountRowActions";
import WebToLeadSnippet from "@/components/WebToLeadSnippet";
import AiSettingsForm from "@/components/AiSettingsForm";
import WhatsAppConnect from "@/components/WhatsAppConnect";
import BusinessProfileForm from "@/components/BusinessProfileForm";
import SignatureForm from "@/components/SignatureForm";
import ConfigTabs from "@/components/ConfigTabs";

export const dynamic = "force-dynamic";

export default async function Config() {
  const supabase = createClient();
  // NUNCA seleciona smtp_pass/oauth_refresh_token (segredos ficam no servidor)
  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("id, provider, from_email, display_name, is_active, daily_cap, warmup_stage")
    .order("created_at", { ascending: false });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  const isOwner = (me as any)?.role === "owner";

  const { data: tenant } = await supabase
    .from("tenants")
    .select("inbound_token, ai_model, ai_api_key, legal_name, cnpj, segment, contact_email, phone, website, logo_url, brand_color, email_signature, file_retention_months, platform_plans(name, file_retention_months)")
    .maybeSingle();
  const inboundToken = (tenant as any)?.inbound_token as string | undefined;
  const aiModel = ((tenant as any)?.ai_model as string) || "";
  const aiHasKey = !!(tenant as any)?.ai_api_key;

  const { data: waAccounts } = await supabase
    .from("whatsapp_accounts")
    .select("id, evolution_url, instance, is_active, inbound_token")
    .order("created_at", { ascending: false });

  const rows = (accounts as any[]) || [];
  const gmailReady = !!process.env.GOOGLE_CLIENT_ID;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-bold">Configurações</h1>
      <p className="mt-1 mb-6 text-sm text-subtle">A ficha do seu negócio, os canais de envio e as integrações.</p>

      <ConfigTabs tabs={["Negócio", "E-mail", "WhatsApp", "Captação"]}>
        {/* Negócio */}
        <div>
          <p className="text-sm text-subtle">Identidade e marca do workspace — usadas nos entregáveis white-label.</p>
          <div className="card mt-3 p-5">
            <BusinessProfileForm biz={(tenant as any) || {}} canEdit={isOwner} />
          </div>

          <p className="mt-6 text-sm font-semibold">Assinatura de e-mail</p>
          <p className="text-sm text-subtle">Anexada ao fim dos e-mails enviados pela fila.</p>
          <div className="card mt-2 p-5">
            <SignatureForm initial={((tenant as any)?.email_signature as string) || ""} />
          </div>

          <p className="mt-6 text-sm font-semibold">Inteligência (IA)</p>
          <p className="text-sm text-subtle">Modelo e chave usados pelo &ldquo;Gerar cadência com IA&rdquo;. Definidos aqui, valem sem mexer no ambiente.</p>
          <div className="card mt-2 p-5">
            <AiSettingsForm currentModel={aiModel} hasKey={aiHasKey} />
          </div>

          <p className="mt-6 text-sm font-semibold">Produtos & Serviços</p>          <p className="text-sm text-subtle">Seu catálogo do que você vende, para vincular às oportunidades e medir receita por produto.</p>
          <a href="/dashboard/config/produtos" className="btn-ghost mt-2 inline-flex">Gerenciar catálogo →</a>

          <p className="mt-6 text-sm font-semibold">Entregabilidade & reputação</p>
          <p className="text-sm text-subtle">E-mails que devolveram, marcaram spam ou pediram descadastro são bloqueados automaticamente para proteger seu domínio.</p>
          <a href="/dashboard/config/supressao" className="btn-ghost mt-2 inline-flex">Ver lista de supressão →</a>

          <p className="mt-6 text-sm font-semibold">Retenção de arquivos</p>
          <p className="text-sm text-subtle">Os PDFs de proposta ficam guardados por um prazo definido pelo seu <b>plano</b>. Depois do prazo, o arquivo é automaticamente excluído (o registro do documento permanece no histórico) — por LGPD e economia de armazenamento.</p>
          <div className="card mt-2 p-5">
            {(() => {
              const planName = (tenant as any)?.platform_plans?.name as string | undefined;
              const months = Number((tenant as any)?.platform_plans?.file_retention_months ?? (tenant as any)?.file_retention_months ?? 6);
              return (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm">Plano <b>{planName || "—"}</b></p>
                    <p className="mt-0.5 text-2xl font-bold text-brand-dark">{months} meses</p>
                    <p className="mt-1 text-xs text-subtle">Arquivos com mais de {months} meses são excluídos automaticamente. Baixe o que precisar guardar antes do prazo.</p>
                  </div>
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-subtle">política do plano</span>
                </div>
              );
            })()}
          </div>
        </div>

        {/* E-mail */}
        <div>
          <p className="text-sm text-subtle">Conecte as caixas que enviam suas cadências. O envio respeita o limite diário (Envio Seguro).</p>

          <div className="mt-4 space-y-3">
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

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="card p-5">
              <p className="text-sm font-semibold">Gmail / Google Workspace</p>
              <p className="mt-1 text-xs text-subtle">Conecte via OAuth (recomendado): envia e, no futuro, lê respostas.</p>
              {gmailReady ? (
                <a href="/api/gmail/connect" className="btn-brand mt-3 inline-flex">Conectar Gmail</a>
              ) : (
                <p className="mt-3 rounded-lg bg-warn/10 p-3 text-xs text-warn">
                  Falta configurar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no ambiente (Vercel) para habilitar o OAuth do Gmail.
                </p>
              )}
            </div>
            <div className="card p-5">
              <p className="text-sm font-semibold">Outro provedor (SMTP)</p>
              <p className="mt-1 text-xs text-subtle">Outlook, servidor próprio, ou Gmail com senha de app.</p>
              <p className="mt-1 text-xs text-subtle">A <b>detecção de respostas por IMAP</b> tem uma seção própria dentro deste formulário — ative para a Contatia pausar a cadência sozinha quando o lead responder.</p>
              <div className="mt-3">
                <SmtpForm />
              </div>
            </div>
          </div>
        </div>

        {/* WhatsApp */}
        <div>
          <p className="text-sm text-subtle">Conecte sua instância Evolution (você a hospeda). Envia da fila e detecta respostas via webhook.</p>
          <div className="card mt-3 p-5">
            <WhatsAppConnect accounts={(waAccounts as any[]) || []} />
          </div>
        </div>

        {/* Captação */}
        <div>
          <p className="text-sm text-subtle">Cole um formulário no seu site; os envios viram contatos no pipeline.</p>
          <div className="card mt-3 p-5">
            {inboundToken ? (
              <WebToLeadSnippet token={inboundToken} />
            ) : (
              <p className="text-sm text-subtle">Token de captação indisponível. Rode a migration 0005 para gerá-lo.</p>
            )}
          </div>
        </div>
      </ConfigTabs>
    </div>
  );
}
