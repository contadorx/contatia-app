import { EmailFinder } from "@/components/EmailFinder";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HOT_THRESHOLD } from "@/lib/scoring";
import EnrollButton from "@/components/EnrollButton";
import QuickSend from "@/components/QuickSend";
import ScheduleMeetingForContact from "@/components/ScheduleMeetingForContact";
import RegisterTouchButton from "@/components/RegisterTouchButton";
import NewOpportunityForContact from "@/components/NewOpportunityForContact";
import ContactReplyButton from "@/components/ContactReplyButton";
import NoteComposer from "@/components/NoteComposer";
import ContactCadences from "@/components/ContactCadences";
import EditContactButton from "@/components/EditContactButton";
import DeleteContactButton from "@/components/DeleteContactButton";
import ContactExtras from "@/components/ContactExtras";
import ProdutoBadges from "@/components/ProdutoBadges";
import RevisarContato from "@/components/RevisarContato";
import AtualizarDadosContato from "@/components/AtualizarDadosContato";
import RedesContato from "@/components/RedesContato";
import { EmailVerifyBadge, TestEmailBox } from "@/components/EmailVerify";
import { channelLabel, type Channel } from "@/lib/cadence";
import { produtosDoContato } from "@/lib/produtos";
import { dominioCorporativo, ehCaixaDeBalcao, pareceEmailDaPessoa } from "@/lib/emailFinder";
import { dataHora } from "@/lib/datas";

export const dynamic = "force-dynamic";
// A busca/verificação de e-mail conversa com o servidor SMTP do destino, que pode
// levar 20-30s (greylisting/servidores lentos). Sem isto, a função da Vercel morre
// no meio e a tela mostra "não foi possível verificar agora". 60s cobre o caso real
// e é permitido tanto no Hobby (teto 60s) quanto no Pro.
export const maxDuration = 60;

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className={value ? "" : "text-subtle"}>{value || "—"}</p>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  note: "Nota",
  task_done: "Toque executado",
  email_sent: "E-mail enviado",
  replied: "Respondeu",
  doc_opened: "Abriu a proposta",
  email_opened: "Abriu o e-mail",
  link_clicked: "Clicou no link",
  meeting: "Reunião marcada",
};
const EVENT_COLOR: Record<string, string> = {
  replied: "bg-signal",
  doc_opened: "bg-signal",
  meeting: "bg-brand",
  email_opened: "bg-brand",
  note: "bg-warn",
};

function fmt(iso: string) {
  return dataHora(iso);
}

// ============================================================
// VOLTAR SEM PERDER O FILTRO
//
// A lista é uma fila de trabalho: você filtra "sem e-mail, do fulano, tag X", abre o
// primeiro, trata, volta — e caía numa lista sem filtro nenhum, tendo que remontar tudo
// para pegar o segundo. Isso torna impossível trabalhar uma sequência, que é o uso
// normal da tela.
//
// A lista agora manda a própria query string no parâmetro `de`, e o "← Contatos" a
// devolve. Só isso. Sem histórico do navegador, sem estado global: o link carrega de
// onde veio, então funciona igual se você abrir em nova aba ou mandar o link para
// alguém.
// ============================================================
export default async function ContatoDetalhe({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { de?: string };
}) {
  const voltarPara = (() => {
    const de = typeof searchParams?.de === "string" ? searchParams.de : "";
    if (!de) return "/dashboard/contatos";
    // decodifica e remonta com URLSearchParams: nada do que veio na URL entra cru num
    // href, e um `de` malformado vira simplesmente a lista sem filtro.
    try {
      const qs = new URLSearchParams(decodeURIComponent(de)).toString();
      return qs ? `/dashboard/contatos?${qs}` : "/dashboard/contatos";
    } catch {
      return "/dashboard/contatos";
    }
  })();

  const supabase = createClient();

  const { data: contact } = await supabase
    .from("contacts")
    // select("*"): instagram/linkedin nascem na 0110 e derrubariam a ficha inteira
    // se fossem pedidos pelo nome antes da migration.
    .select("*, accounts(name, domain, website, cnpj, cnae, uf, municipio, porte)")
    .eq("id", params.id)
    .maybeSingle();
  if (!contact) notFound();

  const [{ data: sequences }, { data: enrollments }, { data: tasks }, { data: events }, { data: meetings }, { data: opps }, { data: irmaos }] =
    await Promise.all([
      supabase.from("sequences").select("id, name").eq("is_active", true),
      supabase.from("enrollments").select("id, status, sequences(name)").eq("contact_id", params.id).order("created_at", { ascending: false }),
      supabase.from("tasks").select("id, channel, title, due_date").eq("contact_id", params.id).eq("status", "pending").order("due_date", { ascending: true }),
      supabase.from("events").select("id, type, created_at, meta").eq("contact_id", params.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("meetings").select("id, title, datetime, status").eq("contact_id", params.id).order("datetime", { ascending: false }),
      supabase.from("opportunities").select("id, title, value_mrr, status").eq("primary_contact_id", params.id).order("created_at", { ascending: false }),
      // Outros contatos da MESMA empresa. Entra aqui no Promise.all porque `contact` já
      // foi buscado acima — não custa uma ida a mais em série.
      // A guarda do account_id importa: `.eq("account_id", null)` no PostgREST não
      // devolve "os sem empresa", devolve nada útil. Sem empresa, nem consulta.
      (contact as any).account_id
        ? supabase
            .from("contacts")
            .select("id, name, role_title, email, phone, score, wa_status")
            .eq("account_id", (contact as any).account_id)
            .neq("id", params.id)
            .order("score", { ascending: false })
            .limit(25)
        : Promise.resolve({ data: [] as any[] }),
    ]);

  const produtos = await produtosDoContato(supabase, params.id);

  const c = contact as any;
  const score = c.score ?? 0;
  const hot = score >= HOT_THRESHOLD;
  const custom = (c.custom as any) || {};
  const acc = c.accounts || {};
  const cnpj = c.cnpj || acc.cnpj || null;
  // Receita: prefere o que o Radar enriqueceu no contato; cai para os campos da empresa
  const receita = {
    cnae: custom.cnae || acc.cnae || null,
    cnae_descricao: custom.cnae_descricao || null,
    situacao: custom.situacao || null,
    porte: custom.porte || acc.porte || null,
    uf: custom.uf || acc.uf || null,
    municipio: custom.municipio || acc.municipio || null,
  };
  const socios: string[] = Array.isArray(custom.socios) ? custom.socios : [];
  const enrichedAt = custom.enriched_at || null;
  const linkedin = custom.linkedin || null;
  const rapport = custom.rapport || {};
  const hasReceita = !!(receita.cnae || receita.cnae_descricao || receita.situacao || receita.porte || socios.length);

  // ============================================================
  // O DOMÍNIO PODE ESTAR ESCONDIDO NO E-MAIL
  //
  // Um contato importado com "joao@escritoriosilva.com.br" e nada mais tinha, para o
  // app, "nenhum domínio" — e portanto nenhum caminho para o site nem para as redes.
  // Mas o domínio está ali, na frente. `dominioCorporativo` devolve null para gmail e
  // afins, então isto não transforma e-mail pessoal em site de empresa.
  // ============================================================
  const dominioContato = c.company_domain || acc.domain || dominioCorporativo(c.email) || "";
  const enr = (enrollments as any[]) || [];
  const activeEnr = enr.find((e) => e.status === "active");
  const pendingTasks = (tasks as any[]) || [];
  const evs = (events as any[]) || [];
  const mtgs = (meetings as any[]) || [];
  const oppList = (opps as any[]) || [];
  const daEmpresa = ((irmaos as any[]) || []);
  const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  // Falta algum canal? Decide se o painel de ajuste fino já abre aberto. Um contato
  // completo não precisa de painel nenhum; um incompleto não deveria cobrar três
  // cliques para mostrar o que falta.
  const faltaAlgumCanal =
    !c.email ||
    (c as any).custom?.email_check?.valid !== true ||
    (c as any).wa_status !== "valid" ||
    !((c as any).instagram || (c as any).linkedin);

  return (
    <div className="max-w-4xl">
      <Link href={voltarPara} className="text-sm text-subtle hover:text-brand">
        ← Contatos{voltarPara.includes("?") ? " (com seus filtros)" : ""}
      </Link>

      {/* Cabeçalho */}
      <div className="mt-3 card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold">{c.name}</h1>
              {hot && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-bold text-warn">QUENTE</span>}
            </div>
            <p className="mt-1 text-sm text-subtle">
              {c.role_title ? `${c.role_title} · ` : ""}
              {c.accounts?.name ? (
                <Link href={`/dashboard/contas/${c.account_id}`} className="text-brand-dark hover:underline">
                  {c.accounts.name}
                </Link>
              ) : (
                c.company || "—"
              )}
            </p>
            <p className="mt-1 text-sm text-subtle">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</p>
            <div className="mt-2">
              <EmailVerifyBadge contactId={c.id} hasEmail={!!c.email} initial={(c as any).custom?.email_check ?? null} />
            </div>
          </div>
          <div className="text-right">
            <p className="label">Score</p>
            <p className={`font-display text-3xl font-bold ${hot ? "text-warn" : ""}`}>{score}</p>
          </div>
        </div>

        {/* âncora #enviar — os selos de canal na lista de Contatos apontam para cá */}
        <div id="enviar" className="mt-4 flex scroll-mt-24 flex-wrap items-center gap-2">
          <EnrollButton contactId={c.id} sequences={(sequences as { id: string; name: string }[]) || []} />
          <QuickSend contactId={c.id} hasEmail={!!c.email} hasPhone={!!c.phone} />
          <ScheduleMeetingForContact contactId={c.id} contactName={c.name} />
          <RegisterTouchButton contactId={c.id} />
          <ContactReplyButton contactId={c.id} />
          <EditContactButton contact={c as any} />
          <span className="ml-auto"><DeleteContactButton contactId={c.id} name={c.name} /></span>
        </div>

        {/* ============================================================
            DADOS DE CONTATO — um lugar só
            Antes eram seis controles em quatro alturas diferentes da página, e o de
            WhatsApp estava dentro de um painel recolhido. Descobrir dado de contato é
            UMA decisão, então virou um botão. Os controles finos continuam aqui
            embaixo, recolhidos, para quando você quiser mexer num canal só.
            ============================================================ */}
        <section className="mt-4 rounded-xl border border-line p-4">
          <h2 className="font-display text-sm font-semibold">Dados de contato</h2>
          <p className="mt-0.5 text-xs text-subtle">
            E-mail, WhatsApp, redes e cadastro da Receita — descobertos na ordem em que um
            alimenta o outro.
          </p>

          <div className="mt-3">
            <AtualizarDadosContato
              contactId={c.id}
              estadoInicial={{
                temCnpj: !!cnpj,
                enriquecido: !!enrichedAt,
                dominio: dominioContato,
                temEmail: !!c.email,
                emailDeBalcao: ehCaixaDeBalcao(c.email),
                emailForaDoDominio: !!(dominioCorporativo(c.email) && dominioContato && dominioCorporativo(c.email) !== dominioContato),
                emailDeOutraPessoa: !!c.email && !ehCaixaDeBalcao(c.email) && !pareceEmailDaPessoa(c.email, c.name),
                temTelefone: !!c.phone,
                waStatus: (c as any).wa_status || null,
                temRede: !!((c as any).instagram || (c as any).linkedin),
                // Os VALORES. Sem eles o quadro abriria dizendo "não tem" para um
                // contato que tem, e só passaria a mostrar depois de rodar um passo.
                email: c.email || null,
                emailConferido: (c as any).custom?.email_check?.valid === true,
                emailConferidoEm: (c as any).custom?.email_check?.checked_at || null,
                telefone: c.phone || null,
                waCheckedAt: (c as any).wa_checked_at || null,
                instagram: (c as any).instagram || null,
                linkedin: (c as any).linkedin || null,
                enriquecidoEm: enrichedAt || null,
              }}
            />
          </div>

          {/* ============================================================
              ABERTO QUANDO AINDA FALTA ALGO
              O painel vinha sempre fechado, então em toda ficha incompleta a
              sequência era a mesma: abrir para ver as redes, abrir de novo para o
              e-mail, de novo para o WhatsApp. Três cliques para chegar ao trabalho
              que ainda existe. Fechar por padrão só faz sentido quando não há mais
              nada a fazer — e é exatamente isso que a condição diz.
              ============================================================ */}
          <details className="mt-3" open={faltaAlgumCanal}>
            <summary className="cursor-pointer text-xs font-medium text-subtle hover:text-ink">
              Ajustar um canal específico
              {faltaAlgumCanal && <span className="ml-1 text-warn">· ainda falta algo</span>}
            </summary>
            <div className="mt-2 space-y-2 border-l-2 border-line pl-3">
              {!c.email && (
                <>
                  <EmailFinder
                    contactId={c.id}
                    contactName={c.name}
                    companyDomain={dominioContato || null}
                    discovery={(c as any).email_discovery || null}
                  />
                  {/* "Testar um e-mail que já tenho": para endereços por função
                      (contato@, contabil@) que não seguem o nome da pessoa. */}
                  <TestEmailBox contactId={c.id} />
                </>
              )}

              {/* embutido: aqui dentro ele não pode ser mais uma gaveta — e-mail e
                  WhatsApp ficam na mesma altura das redes, sem clique extra.
                  Vem ANTES das redes para a ordem bater com a do quadro de canais
                  logo acima (E-mail · WhatsApp · Redes · Receita) — a mesma ordem nos
                  dois lugares é o que evita procurar. */}
              <RevisarContato
                contactId={c.id}
                contactName={c.name}
                email={c.email || null}
                phone={c.phone || null}
                waStatus={(c as any).wa_status || null}
                waCheckedAt={(c as any).wa_checked_at || null}
                companyDomain={dominioContato || null}
                discovery={(c as any).email_discovery || null}
                embutido
              />

              <div className="border-t border-line pt-2">
                <RedesContato
                  contactId={c.id}
                  instagram={(c as any).instagram || null}
                  linkedin={(c as any).linkedin || null}
                  temDominio={!!((c as any).company_domain || (c as any).accounts?.domain || (c as any).accounts?.website)}
                  igOrigem={(c as any).instagram_origem || null}
                  igConferidoEm={(c as any).instagram_conferido_at || null}
                  liOrigem={(c as any).linkedin_origem || null}
                  liConferidoEm={(c as any).linkedin_conferido_at || null}
                />
              </div>
            </div>
          </details>
        </section>

        {/* Dados do contato/empresa (o que já está no banco e antes ficava escondido) */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-3">
          <Field label="CNPJ" value={cnpj} />
          <Field label="Domínio" value={c.company_domain || acc.domain} />
          <Field label="Origem" value={c.origin} />
          <Field label="Situação" value={c.status} />
          <div>
            <p className="label">LinkedIn</p>
            {linkedin ? (
              <a href={linkedin} target="_blank" rel="noreferrer" className="text-brand-dark hover:underline">ver perfil ↗</a>
            ) : (
              <p className="text-subtle">—</p>
            )}
          </div>
        </div>

        <ProdutoBadges produtos={produtos} />
      </div>

      {/* Empresa (Receita Federal) + Rapport */}
      <ContactExtras
        contactId={c.id}
        accountId={c.account_id || null}
        cnpj={cnpj}
        hasReceita={hasReceita}
        receita={receita}
        socios={socios}
        enrichedAt={enrichedAt}
        linkedin={linkedin || ""}
        rapport={rapport}
      />

      {/* ============================================================
          OUTROS CONTATOS DA MESMA EMPRESA
          Numa empresa com três sócios, tratar um e ter que voltar à lista para achar os
          outros é atrito puro — e é o caminho normal depois de enriquecer pelo CNPJ, que
          cria justamente um contato por sócio. O bloco só aparece quando há empresa
          vinculada e alguém além do contato aberto.
          ============================================================ */}
      {daEmpresa.length > 0 && (
        <div className="mt-6 card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-sm font-semibold">
              Outros contatos {acc.name ? `da ${acc.name}` : "desta empresa"}
            </h2>
            <span className="text-xs text-subtle">{daEmpresa.length}</span>
            {c.account_id && (
              <Link href={`/dashboard/contas/${c.account_id}`} className="ml-auto text-xs text-brand-dark hover:underline">
                ver a empresa →
              </Link>
            )}
          </div>
          <ul className="mt-3 divide-y divide-line">
            {daEmpresa.map((o: any) => {
              const canais = [
                o.email ? "e-mail" : null,
                o.wa_status === "valid" ? "WhatsApp" : o.phone ? "telefone" : null,
              ].filter(Boolean);
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Link
                    href={`/dashboard/contatos/${o.id}${searchParams?.de ? `?de=${encodeURIComponent(searchParams.de)}` : ""}`}
                    className="font-medium text-brand-dark hover:underline"
                  >
                    {o.name}
                  </Link>
                  {o.role_title && <span className="text-xs text-subtle">{o.role_title}</span>}
                  <span className="ml-auto text-xs text-subtle">
                    {canais.length ? canais.join(" · ") : "sem canal — precisa completar"}
                  </span>
                  {(o.score ?? 0) >= HOT_THRESHOLD && (
                    <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-bold text-warn">QUENTE</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Próximos toques + reuniões */}
        <div className="space-y-6">
          <div>
            <h2 className="mb-3 font-display text-lg font-bold">Cadências</h2>
            <div className="card p-4">
              <ContactCadences enrollments={enr} />
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-bold">Próximos toques</h2>
            <div className="card divide-y divide-line">
              {pendingTasks.length ? (
                pendingTasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-3">
                    <span className="text-sm">{t.title || channelLabel[t.channel as Channel]}</span>
                    <span className="text-xs text-subtle">{channelLabel[t.channel as Channel]} · {t.due_date}</span>
                  </div>
                ))
              ) : (
                <p className="p-4 text-sm text-subtle">Nenhum toque pendente.</p>
              )}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Reuniões</h2>
              <ScheduleMeetingForContact contactId={c.id} contactName={c.name} />
            </div>
            <div className="card divide-y divide-line">
              {mtgs.length ? (
                mtgs.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-3">
                    <span className="text-sm">{m.title}</span>
                    <span className="text-xs text-subtle">{fmt(m.datetime)} · {m.status}</span>
                  </div>
                ))
              ) : (
                <p className="p-4 text-sm text-subtle">Nenhuma reunião. Use “Marcar reunião” acima.</p>
              )}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Oportunidades</h2>
              <NewOpportunityForContact contactId={c.id} defaultTitle={c.company || c.accounts?.name || c.name} />
            </div>
            <div className="card divide-y divide-line">
              {oppList.length ? (
                oppList.map((o) => (
                  <Link key={o.id} href={`/dashboard/pipeline?opp=${o.id}`} className="flex items-center justify-between p-3 transition hover:bg-muted">
                    <div>
                      <p className="text-sm font-medium">{o.title}</p>
                      <p className="text-xs text-subtle">{o.status} · abrir no funil →</p>
                    </div>
                    <span className="text-sm font-bold text-brand-dark">{brl(o.value_mrr)}/mês</span>
                  </Link>
                ))
              ) : (
                <p className="p-4 text-sm text-subtle">Nenhuma oportunidade. Use “Nova oportunidade” acima.</p>
              )}
            </div>
          </div>
        </div>

        {/* Linha do tempo */}
        <div>
          <h2 className="mb-3 font-display text-lg font-bold">Linha do tempo</h2>
          <div className="card p-5">
            <NoteComposer contactId={c.id} />
            {evs.length ? (
              <div className="relative space-y-4 pl-5">
                <div className="absolute bottom-1 left-[5px] top-1 w-0.5 bg-line" />
                {evs.map((e) => (
                  <div key={e.id} className="relative">
                    <div className={`absolute -left-[18px] top-1 h-[9px] w-[9px] rounded-full ${EVENT_COLOR[e.type] || "bg-subtle"}`} />
                    <p className="text-sm font-medium">{e.type === "task_done" && e.meta?.manual ? `Toque${e.meta?.canal ? ` · ${e.meta.canal}` : ""}` : (EVENT_LABEL[e.type] || e.type)}</p>
                    {(e.type === "note" || e.type === "replied" || (e.type === "task_done" && e.meta?.text)) && e.meta?.text && (
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink/80">
                        {e.type === "replied" ? `"${e.meta.text}"` : e.meta.text}
                      </p>
                    )}
                    {(e.type === "link_clicked" || e.type === "doc_opened") && e.meta?.url && (
                      <a href={e.meta.url} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-xs text-brand-dark hover:underline" title={e.meta.url}>
                        {e.meta.url}
                      </a>
                    )}
                    <p className="text-xs text-subtle">{fmt(e.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-subtle">Nenhuma atividade registrada ainda.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
