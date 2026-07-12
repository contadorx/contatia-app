import { hasFeature } from "@/lib/plan";
import { FeatureLock } from "@/components/UsageLimits";
import { CrmIntegrations } from "@/components/CrmIntegrations";
import { createClient } from "@/lib/supabase/server";
import SmtpForm from "@/components/SmtpForm";
import { DomainHealthPanel } from "@/components/DomainHealthPanel";
import { BookingSettings } from "@/components/BookingSettings";
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
    .select("id, provider, from_email, display_name, is_active, daily_cap, warmup_stage, created_at")
    .order("created_at", { ascending: false });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  const isOwner = (me as any)?.role === "owner";

  const { data: tenant } = await supabase
    .from("tenants")
    .select("inbound_token, ai_model, ai_api_key, legal_name, cnpj, segment, contact_email, phone, website, logo_url, brand_color, email_signature, file_retention_months, booking_enabled, booking_duration_min, booking_days, booking_start_hour, booking_end_hour, booking_title, platform_plans(name, file_retention_months)")
    .maybeSingle();
  const inboundToken = (tenant as any)?.inbound_token as string | undefined;
  const aiModel = ((tenant as any)?.ai_model as string) || "";
  const aiHasKey = !!(tenant as any)?.ai_api_key;

  const { data: waAccounts } = await supabase
    .from("whatsapp_accounts")
    .select("id, evolution_url, instance, is_active, inbound_token")
    .order("created_at", { ascending: false });

  const { data: crmConns } = await supabase
    .from("crm_connections")
    .select("*");

  const rows = (accounts as any[]) || [];
  const gmailReady = !!process.env.GOOGLE_CLIENT_ID;

  // features do plano (Essencial não tem WhatsApp nem IA)
  const temWhats = await hasFeature("whatsapp");
  const temIA = await hasFeature("ia");

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-bold">Configurações</h1>
      <p className="mt-1 mb-6 text-sm text-subtle">A ficha do seu negócio, os canais de envio e as integrações.</p>

      <ConfigTabs tabs={["Negócio", "E-mail", "WhatsApp", "Vendas", "Captação", "Integrações"]}>
        {/* Negócio */}
        <div>
          <p className="text-sm text-subtle">Identidade e marca do workspace — usadas nos entregáveis white-label.</p>
          <div className="card mt-3 p-5">
            <BusinessProfileForm biz={(tenant as any) || {}} canEdit={isOwner} />
          </div>

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

          {(() => {
            const active = rows.filter((a) => a.is_active);
            if (active.length < 2) return null;
            const ramp = [10, 15, 20, 25, 30, 40, 50, 65, 80, 100, 125, 150, 175, 200];
            let total = 0;
            for (const a of active) {
              const target = Number(a.daily_cap) || 40;
              const on = (a.warmup_stage ?? 0) !== -1;
              const days = a.created_at ? Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000) : 0;
              total += !on || days >= ramp.length ? target : Math.min(ramp[Math.max(0, days)], target);
            }
            return (
              <div className="mt-3 rounded-lg bg-brand-soft p-3 text-sm">
                <p className="font-semibold text-brand-dark">Rotação de caixas ativa</p>
                <p className="text-xs text-brand-dark">Você tem {active.length} caixas conectadas. A Contatia distribui os envios entre elas (sempre a com mais folga), somando até <b>{total} e-mails/dia</b> com segurança. Conectar mais caixas aumenta seu volume sem queimar reputação.</p>
              </div>
            );
          })()}

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
                    <p className="text-xs text-subtle">{(() => {
                      const target = Number(a.daily_cap) || 40;
                      const on = (a.warmup_stage ?? 0) !== -1;
                      const created = a.created_at ? new Date(a.created_at) : null;
                      const days = created ? Math.floor((Date.now() - created.getTime()) / 86400000) : 0;
                      const ramp = [10, 15, 20, 25, 30, 40, 50, 65, 80, 100, 125, 150, 175, 200];
                      const cap = !on || days >= ramp.length ? target : Math.min(ramp[Math.max(0, days)], target);
                      const warming = on && cap < target;
                      return warming
                        ? `Aquecendo: hoje pode enviar ${cap} e-mails (dia ${days + 1}). Sobe até ${target}/dia automaticamente.`
                        : `Limite diário: ${target}/dia${on ? " (aquecida)" : " (aquecimento desligado)"}.`;
                    })()}</p>
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

          <div className="mt-6">
            <p className="text-sm font-semibold">Saúde do domínio (entregabilidade)</p>
            <p className="mt-1 text-sm text-subtle">Cheque se seu domínio tem MX, SPF, DKIM e DMARC — os quatro registros que fazem seus e-mails chegarem à caixa de entrada em vez do spam.</p>
            <div className="mt-2">
              <DomainHealthPanel />
            </div>
          </div>

          <div className="mt-6">
            <p className="text-sm font-semibold">Assinatura de e-mail</p>
            <p className="text-sm text-subtle">Anexada ao fim dos e-mails enviados pela fila.</p>
            <div className="card mt-2 p-5">
              <SignatureForm initial={((tenant as any)?.email_signature as string) || ""} />
            </div>
          </div>

          <div className="mt-6">
            <p className="text-sm font-semibold">Lista de supressão</p>
            <p className="text-sm text-subtle">E-mails que devolveram, marcaram spam ou pediram descadastro são bloqueados automaticamente para proteger seu domínio.</p>
            <a href="/dashboard/config/supressao" className="btn-ghost mt-2 inline-flex">Ver lista de supressão →</a>
          </div>
        </div>

        {/* WhatsApp */}
        <div>
          {temWhats ? (
            <>
              <p className="text-sm text-subtle">Conecte sua instância Evolution (você a hospeda). Envia da fila e detecta respostas via webhook.</p>
              <div className="card mt-3 p-5">
                <WhatsAppConnect accounts={(waAccounts as any[]) || []} />
              </div>
            </>
          ) : (
            <FeatureLock
              feature="whatsapp"
              titulo="WhatsApp na cadência"
              descricao="O canal que o brasileiro responde, dentro do fluxo: dispare o toque da fila, receba a resposta e deixe a cadência pausar sozinha."
            />
          )}
        </div>

        {/* Vendas */}
        <div>
          <p className="text-sm text-subtle">Ferramentas que apoiam a venda: seu catálogo e a IA que monta cadências.</p>

          <p className="mt-4 text-sm font-semibold">Produtos & Serviços</p>
          <p className="text-sm text-subtle">Seu catálogo do que você vende, para vincular às oportunidades e medir receita por produto.</p>
          <a href="/dashboard/config/produtos" className="btn-ghost mt-2 inline-flex">Gerenciar catálogo →</a>

          <div className="mt-6">
            {temIA ? (
              <>
                <p className="text-sm font-semibold">Inteligência (IA)</p>
                <p className="text-sm text-subtle">Modelo e chave usados pelo &ldquo;Gerar cadência com IA&rdquo;. Definidos aqui, valem sem mexer no ambiente.</p>
                <div className="card mt-2 p-5">
                  <AiSettingsForm currentModel={aiModel} hasKey={aiHasKey} />
                </div>
              </>
            ) : (
              <FeatureLock
                feature="ia"
                titulo="IA que monta a cadência"
                descricao="Descreva o que você vende e para quem — a IA escreve a sequência completa: assuntos, corpos e intervalos."
              />
            )}
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

          <p className="mt-6 text-sm font-semibold">Link público de agendamento</p>
          <p className="text-sm text-subtle">Deixe o lead escolher o horário direto na sua agenda — sem vai-e-vem. A reunião entra no seu pipeline e no Google Calendar (se conectado).</p>
          <div className="mt-2">
            <BookingSettings
              token={inboundToken || null}
              initial={{
                enabled: !!(tenant as any)?.booking_enabled,
                duration: Number((tenant as any)?.booking_duration_min ?? 30),
                days: (tenant as any)?.booking_days || "1,2,3,4,5",
                startHour: Number((tenant as any)?.booking_start_hour ?? 9),
                endHour: Number((tenant as any)?.booking_end_hour ?? 18),
                title: (tenant as any)?.booking_title || "",
              }}
            />
          </div>
        </div>

        {/* Integrações */}
        <div>
          <CrmIntegrations connections={(crmConns as any[]) || []} />
        </div>
      </ConfigTabs>
    </div>
  );
}
