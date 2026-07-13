import type { ReactNode } from "react";
import { hasFeature, hasAi } from "@/lib/plan";
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

// Bloco padrão de configuração: título + descrição curta + conteúdo. Dá a mesma
// cara a todas as seções (era o que deixava a tela "bagunçada").
function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className="font-display text-base font-bold">{title}</h3>
      {desc && <p className="mt-0.5 mb-3 max-w-2xl text-sm text-subtle">{desc}</p>}
      {!desc && <div className="mb-3" />}
      {children}
    </section>
  );
}

const RAMP = [10, 15, 20, 25, 30, 40, 50, 65, 80, 100, 125, 150, 175, 200];

export default async function Config() {
  const supabase = createClient();
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
    .select("inbound_token, ai_model, ai_api_key, legal_name, cnpj, segment, contact_email, phone, website, logo_url, brand_color, email_signature, file_retention_months, whatsapp_mode, whatsapp_risk_ack_at, booking_enabled, booking_duration_min, booking_days, booking_start_hour, booking_end_hour, booking_title, platform_plans(name, file_retention_months)")
    .maybeSingle();
  const inboundToken = (tenant as any)?.inbound_token as string | undefined;
  const aiModel = ((tenant as any)?.ai_model as string) || "";
  const aiHasKey = !!(tenant as any)?.ai_api_key;

  const { data: waAccounts } = await supabase
    .from("whatsapp_accounts")
    .select("id, evolution_url, instance, is_active, inbound_token")
    .order("created_at", { ascending: false });

  const { data: crmConns } = await supabase.from("crm_connections").select("*");

  const rows = (accounts as any[]) || [];
  const gmailReady = !!process.env.GOOGLE_CLIENT_ID;
  const waMode = ((tenant as any)?.whatsapp_mode as string) || "assistido";
  const waAcked = !!(tenant as any)?.whatsapp_risk_ack_at;
  const waPlatformReady = !!process.env.EVOLUTION_URL && !!process.env.EVOLUTION_API_KEY;

  const temWhats = await hasFeature("whatsapp");
  const temIA = await hasAi();

  const activeBoxes = rows.filter((a) => a.is_active);
  const capOf = (a: any) => {
    const target = Number(a.daily_cap) || 40;
    const on = (a.warmup_stage ?? 0) !== -1;
    const days = a.created_at ? Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000) : 0;
    return !on || days >= RAMP.length ? target : Math.min(RAMP[Math.max(0, days)], target);
  };

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-bold">Configurações</h1>
      <p className="mt-1 mb-6 text-sm text-subtle">Tudo do seu workspace num lugar só: identidade, canais de envio, vendas e integrações.</p>

      <ConfigTabs tabs={["Negócio", "E-mail", "WhatsApp", "Vendas", "Captação", "Integrações"]}>
        {/* ===================== NEGÓCIO ===================== */}
        <div>
          <Section title="Identidade e marca" desc="Nome, documento e marca do workspace — usados nos entregáveis white-label (assinatura, propostas, relatórios).">
            <div className="card p-5">
              <BusinessProfileForm biz={(tenant as any) || {}} canEdit={isOwner} />
            </div>
          </Section>

          <Section title="Assinatura de e-mail" desc="Anexada automaticamente ao fim dos e-mails enviados pela fila.">
            <div className="card p-5">
              <SignatureForm initial={((tenant as any)?.email_signature as string) || ""} />
            </div>
          </Section>

          <Section title="Retenção de arquivos" desc="Os PDFs de proposta são guardados por um prazo definido pelo seu plano e depois excluídos automaticamente (o registro do documento permanece) — por LGPD e economia de armazenamento.">
            <div className="card p-5">
              {(() => {
                const planName = (tenant as any)?.platform_plans?.name as string | undefined;
                const months = Number((tenant as any)?.platform_plans?.file_retention_months ?? (tenant as any)?.file_retention_months ?? 6);
                return (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm">Plano <b>{planName || "—"}</b></p>
                      <p className="mt-0.5 text-2xl font-bold text-brand-dark">{months} meses</p>
                      <p className="mt-1 text-xs text-subtle">Baixe o que precisar guardar antes do prazo.</p>
                    </div>
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-subtle">política do plano</span>
                  </div>
                );
              })()}
            </div>
          </Section>
        </div>

        {/* ===================== E-MAIL ===================== */}
        <div>
          <Section title="Caixas de envio" desc="As caixas que disparam suas cadências. O envio respeita o limite diário de cada uma (Envio Seguro) e alterna entre elas.">
            {activeBoxes.length >= 2 && (
              <div className="mb-3 rounded-lg bg-brand-soft p-3 text-xs text-brand-dark">
                <b>Rotação ativa:</b> {activeBoxes.length} caixas conectadas — a Contatia distribui os envios entre elas (sempre a com mais folga), somando até <b>{activeBoxes.reduce((s, a) => s + capOf(a), 0)} e-mails/dia</b> com segurança.
              </div>
            )}

            <div className="space-y-3">
              {rows.length ? (
                rows.map((a) => {
                  const target = Number(a.daily_cap) || 40;
                  const on = (a.warmup_stage ?? 0) !== -1;
                  const cap = capOf(a);
                  const warming = on && cap < target;
                  return (
                    <div key={a.id} className="card flex items-center justify-between p-4">
                      <div>
                        <p className="text-sm font-semibold">
                          {a.from_email}{" "}
                          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs text-subtle">{a.provider === "gmail" ? "Gmail" : "SMTP"}</span>
                          {!a.is_active && <span className="ml-1 text-xs text-subtle">(inativa)</span>}
                        </p>
                        <p className="text-xs text-subtle">
                          {warming
                            ? `Aquecendo: hoje envia ${cap} e-mails. Sobe até ${target}/dia automaticamente.`
                            : `Limite diário: ${target}/dia${on ? " (aquecida)" : " (aquecimento desligado)"}.`}
                        </p>
                      </div>
                      <AccountRowActions id={a.id} active={a.is_active} />
                    </div>
                  );
                })
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
                  <p className="mt-3 rounded-lg bg-warn/10 p-3 text-xs text-warn">Falta configurar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no ambiente para habilitar o OAuth do Gmail.</p>
                )}
              </div>
              <div className="card p-5">
                <p className="text-sm font-semibold">Outro provedor (SMTP)</p>
                <p className="mt-1 text-xs text-subtle">Outlook, servidor próprio, ou Gmail com senha de app. A <b>detecção de respostas por IMAP</b> fica dentro deste formulário — ative para a cadência pausar sozinha quando o lead responder.</p>
                <div className="mt-3"><SmtpForm /></div>
              </div>
            </div>
          </Section>

          <Section title="Saúde do domínio" desc="Cheque MX, SPF, DKIM e DMARC — os quatro registros que fazem seus e-mails chegarem à caixa de entrada em vez do spam.">
            <DomainHealthPanel />
          </Section>

          <Section title="Lista de supressão" desc="E-mails que devolveram, marcaram spam ou pediram descadastro são bloqueados automaticamente para proteger seu domínio.">
            <a href="/dashboard/config/supressao" className="btn-ghost inline-flex">Ver lista de supressão →</a>
          </Section>
        </div>

        {/* ===================== WHATSAPP ===================== */}
        <div>
          <Section title="Canal do WhatsApp" desc="Escolha COMO usar o WhatsApp na cadência — o nível é seu, por trade-off de risco: do link sem risco à API automática.">
            {temWhats ? (
              <div className="card p-5">
                <WhatsAppConnect accounts={(waAccounts as any[]) || []} mode={waMode as any} acked={waAcked} platformReady={waPlatformReady} />
              </div>
            ) : (
              <FeatureLock feature="whatsapp" planoSugerido="Profissional" titulo="WhatsApp na cadência" descricao="O canal que o brasileiro responde, dentro do fluxo: dispare o toque da fila, receba a resposta e deixe a cadência pausar sozinha." />
            )}
          </Section>
        </div>

        {/* ===================== VENDAS ===================== */}
        <div>
          <Section title="Produtos e serviços" desc="Seu catálogo do que você vende, para vincular às oportunidades e medir receita por produto.">
            <a href="/dashboard/config/produtos" className="btn-ghost inline-flex">Gerenciar catálogo →</a>
          </Section>

          <Section title="IA de cadência" desc="Descreva o que você vende e para quem — a IA escreve a sequência completa (assuntos, corpos e intervalos). Modelo e chave definidos aqui valem sem mexer no ambiente.">
            {temIA ? (
              <div className="card p-5">
                <AiSettingsForm currentModel={aiModel} hasKey={aiHasKey} />
              </div>
            ) : (
              <FeatureLock feature="ia" planoSugerido="Performance" titulo="IA que monta a cadência" descricao="Descreva o que você vende e para quem — a IA escreve a sequência completa: assuntos, corpos e intervalos." />
            )}
          </Section>
        </div>

        {/* ===================== CAPTAÇÃO ===================== */}
        <div>
          <Section title="Formulário no site (web-to-lead)" desc="Cole um formulário no seu site; os envios viram contatos no pipeline.">
            <div className="card p-5">
              {inboundToken ? (
                <WebToLeadSnippet token={inboundToken} />
              ) : (
                <p className="text-sm text-subtle">Token de captação indisponível. Rode a migration 0005 para gerá-lo.</p>
              )}
            </div>
          </Section>

          <Section title="Link público de agendamento" desc="Deixe o lead escolher o horário direto na sua agenda — sem vai-e-vem. A reunião entra no pipeline e no Google Calendar (se conectado).">
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
          </Section>
        </div>

        {/* ===================== INTEGRAÇÕES ===================== */}
        <div>
          <Section title="CRM e webhooks" desc="A Contatia faz a prospecção e alimenta o seu CRM — não o substitui. Conecte o destino dos leads quentes.">
            <CrmIntegrations connections={(crmConns as any[]) || []} />
          </Section>
        </div>
      </ConfigTabs>
    </div>
  );
}
