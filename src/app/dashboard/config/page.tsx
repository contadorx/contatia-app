import type { ReactNode } from "react";
import { CrmIntegrations } from "@/components/CrmIntegrations";
import { createClient } from "@/lib/supabase/server";
import SmtpForm from "@/components/SmtpForm";
import BoxSignatureForm from "@/components/BoxSignatureForm";
import BoxCapForm from "@/components/BoxCapForm";
import { DomainHealthPanel } from "@/components/DomainHealthPanel";
import { BookingSettings } from "@/components/BookingSettings";
import AccountRowActions from "@/components/AccountRowActions";
import WebToLeadSnippet from "@/components/WebToLeadSnippet";
import WhatsAppConnect from "@/components/WhatsAppConnect";
import BusinessProfileForm from "@/components/BusinessProfileForm";
import SignatureForm from "@/components/SignatureForm";
import ConfigTabs from "@/components/ConfigTabs";

export const dynamic = "force-dynamic";

// Seção padrão: título + descrição curta + conteúdo.
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

// Card de link padronizado (deixa claro que abre outra página).
function LinkCard({ title, desc, href, cta = "Gerenciar →" }: { title: string; desc: string; href: string; cta?: string }) {
  return (
    <a href={href} className="card flex items-center justify-between gap-3 p-4 transition hover:border-brand/40">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-subtle">{desc}</p>
      </div>
      <span className="shrink-0 text-sm font-semibold text-brand">{cta}</span>
    </a>
  );
}

function SubHead({ children }: { children: ReactNode }) {
  return <p className="mb-3 border-b border-line pb-2 font-display text-lg font-bold">{children}</p>;
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${ok ? "bg-signal/10 text-signal" : "bg-muted text-subtle"}`}>
      <span>{ok ? "✓" : "○"}</span> {label}
    </span>
  );
}

const RAMP = [10, 15, 20, 25, 30, 40, 50, 65, 80, 100, 125, 150, 175, 200];

export default async function Config() {
  const supabase = createClient();
  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("id, provider, from_email, display_name, is_active, daily_cap, warmup_stage, created_at, verified, verified_at, smtp_host, smtp_port, smtp_secure, smtp_user, detect_replies, imap_host, signature")
    .order("created_at", { ascending: false });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  const isOwner = (me as any)?.role === "owner";

  const { data: tenant } = await supabase
    .from("tenants")
    .select("inbound_token, legal_name, cnpj, segment, contact_email, phone, website, logo_url, brand_color, email_signature, whatsapp_mode, whatsapp_risk_ack_at, booking_enabled, booking_duration_min, booking_days, booking_start_hour, booking_end_hour, booking_title")
    .maybeSingle();
  const inboundToken = (tenant as any)?.inbound_token as string | undefined;

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

  const activeBoxes = rows.filter((a) => a.is_active);
  const capOf = (a: any) => {
    const target = Number(a.daily_cap) || 40;
    const on = (a.warmup_stage ?? 0) !== -1;
    const days = a.created_at ? Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000) : 0;
    return !on || days >= RAMP.length ? target : Math.min(RAMP[Math.max(0, days)], target);
  };

  // status de setup
  const idOk = !!(tenant as any)?.legal_name;
  const emailOk = rows.length > 0;
  const waLabel = waMode === "evolution" ? "automático" : waMode === "meta" ? "oficial" : "assistido";

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-bold">Configurações</h1>
      <p className="mt-1 text-sm text-subtle">Quem você é, como fala com o lead, suas ferramentas de venda e suas conexões.</p>

      {!isOwner && (
        <p className="mt-3 rounded-lg bg-muted p-3 text-sm text-subtle">Algumas configurações são editáveis apenas pelo dono do workspace.</p>
      )}

      {/* Status de configuração */}
      <div className="mt-5 card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Status de configuração</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip ok={idOk} label="Identidade" />
          <Chip ok={emailOk} label="E-mail conectado" />
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-dark">WhatsApp: {waLabel}</span>
        </div>
      </div>

      <div className="mt-6">
        <ConfigTabs tabs={["Negócio", "Canais", "Vendas", "Conexões"]}>
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
          </div>

          {/* ===================== CANAIS ===================== */}
          <div>
            <SubHead>E-mail</SubHead>
            <Section title="Caixas de envio" desc="As caixas que disparam suas cadências. O envio respeita o limite diário de cada uma (Envio Seguro) e alterna entre elas.">
              {activeBoxes.length >= 2 && (
                <div className="mb-3 rounded-lg bg-brand-soft p-3 text-xs text-brand-dark">
                  <b>Rotação ativa:</b> {activeBoxes.length} caixas conectadas — a Contatia distribui os envios entre elas, somando até <b>{activeBoxes.reduce((s, a) => s + capOf(a), 0)} e-mails/dia</b> com segurança.
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
                      <div key={a.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                        <div>
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                            {a.from_email}
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-subtle">{a.provider === "gmail" ? "Gmail" : "SMTP"}</span>
                            {a.provider !== "gmail" && (
                              a.verified ? (
                                <span className="rounded-full bg-signal/10 px-2 py-0.5 text-xs font-medium text-signal">● validada</span>
                              ) : (
                                <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">● não validada</span>
                              )
                            )}
                            {a.detect_replies && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-dark">IMAP on</span>}
                            {!a.is_active && <span className="text-xs text-subtle">(inativa)</span>}
                          </p>
                          <p className="text-xs text-subtle">
                            {warming ? `Aquecendo: hoje envia ${cap} e-mails. Sobe até ${target}/dia automaticamente.` : `Limite diário: ${target}/dia${on ? " (aquecida)" : " (aquecimento desligado)"}.`}
                            {a.provider !== "gmail" && !a.verified && " · A conexão não validou no último teste — clique em Editar para corrigir host/porta/senha."}
                          </p>
                          {a.provider !== "gmail" && (
                            <div className="mt-2"><SmtpForm editAccount={a} /></div>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <BoxSignatureForm accountId={a.id} initial={(a.signature as string) || ""} />
                            <BoxCapForm accountId={a.id} initialCap={Number(a.daily_cap) || 40} initialWarmup={(a.warmup_stage ?? 0) !== -1} />
                          </div>
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

            <Section title="Lista de supressão">
              <LinkCard
                title="Lista de supressão"
                desc="E-mails que devolveram, marcaram spam ou pediram descadastro — bloqueados para proteger seu domínio."
                href="/dashboard/config/supressao"
              />
            </Section>

            <div className="mt-2 mb-8">
              <SubHead>WhatsApp</SubHead>
              <Section title="Canal do WhatsApp" desc="Escolha COMO usar o WhatsApp na cadência — o nível é seu, por trade-off de risco: do link sem risco à API automática.">
                {/* WhatsApp incluído em TODOS os planos — sem gate. */}
                <div className="card p-5">
                  <WhatsAppConnect accounts={(waAccounts as any[]) || []} mode={waMode as any} acked={waAcked} platformReady={waPlatformReady} />
                </div>
              </Section>
            </div>
          </div>

          {/* ===================== VENDAS ===================== */}
          <div>
            <Section title="Produtos e serviços" desc="Seu catálogo do que você vende, para vincular às oportunidades e medir receita por produto.">
              <LinkCard title="Catálogo de produtos e serviços" desc="Cadastre o que você vende (avulso ou recorrente) e vincule às oportunidades." href="/dashboard/config/produtos" />
            </Section>

            <Section title="IA de cadência" desc="A IA que monta a cadência já vem incluída e gerenciada pela Contatia — nada para configurar aqui.">
              {/* IA incluída em TODOS os planos — sem gate. */}
              <div className="card p-5">
                <p className="text-sm text-subtle">
                  A geração de cadência com IA já vem <b>pronta e gerenciada pela Contatia</b> — você não precisa
                  informar modelo nem chave. Use direto na tela de <b>Cadências</b> (Começar → Com IA).
                </p>
              </div>
            </Section>
          </div>

          {/* ===================== CONEXÕES ===================== */}
          <div>
            <Section title="Formulário no site (web-to-lead)" desc="Cole um formulário no seu site; os envios viram contatos no pipeline.">
              <div className="card p-5">
                {inboundToken ? (
                  <WebToLeadSnippet token={inboundToken} />
                ) : (
                  <p className="text-sm text-subtle">O link de captação ainda está sendo preparado para este workspace. Recarregue a página em instantes; se continuar, fale com o suporte.</p>
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

            <Section title="CRM e webhooks" desc="A Contatia faz a prospecção e alimenta o seu CRM — não o substitui. Conecte o destino dos leads quentes.">
              <CrmIntegrations connections={(crmConns as any[]) || []} />
            </Section>
          </div>
        </ConfigTabs>
      </div>

      {/* Rodapé-ponte: configs de conta que vivem fora daqui */}
      <div className="mt-10 border-t border-line pt-6">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">Configurações da conta</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <LinkCard title="Usuários e permissões" desc="Convide gente, defina papéis e veja o placar da equipe." href="/dashboard/equipe" cta="Abrir Equipe →" />
          <LinkCard title="Plano e cobrança" desc="Seu plano, faturas, cupom e retenção de arquivos." href="/dashboard/planos" cta="Abrir Planos →" />
        </div>
      </div>
    </div>
  );
}
