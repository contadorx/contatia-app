import { createClient } from "@/lib/supabase/server";
import ContactTools from "@/components/ContactTools";
import ContactsTable from "@/components/ContactsTable";
import ContactsFilterBar from "@/components/ContactsFilterBar";
import { isManager } from "@/lib/permissions";
import { produtosPorContatos } from "@/lib/produtos";
import { comoLista } from "@/lib/filtros";
import { varrerContatos } from "@/lib/contatosFiltro";
import { msgErro } from "@/lib/erros";

export const dynamic = "force-dynamic";
// A captura no site raspa vários domínios por ação (HTTP); 60s cobre o lote inline.
export const maxDuration = 60;

export default async function Contatos({
  searchParams,
}: {
  searchParams: {
    tag?: string | string[];
    q?: string;
    frio?: string;
    produto?: string | string[];
    cadencia?: string | string[];
    responsavel?: string | string[];
    semcontato?: string;
    view?: string;
    email?: string;
  };
}) {
  const supabase = createClient();
  // Filtros MULTI (?tag=a,b): dentro da mesma caixa é OU, entre caixas é E.
  const tagFilter = comoLista(searchParams.tag);
  const produtoFilter = comoLista(searchParams.produto);
  const cadenciaFilter = comoLista(searchParams.cadencia);
  const frio = searchParams.frio || ""; // "15" | "30" | "nunca"
  const responsavelFilter = comoLista(searchParams.responsavel);
  // visão rápida: completar | prontos | resgatar | quentes (vazio = todos). semcontato=1 vira "completar".
  const view = searchParams.view || (searchParams.semcontato === "1" ? "completar" : "");
  const q = (searchParams.q || "").trim();
  // veredito do e-mail: bate | caixa | outro | sem
  const emailFiltro = (searchParams.email || "").trim();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role, team_role").eq("id", user?.id ?? "").maybeSingle();
  const gerente = isManager((me as any)?.role, (me as any)?.team_role);

  const { data: tags } = await supabase.from("tags").select("id, name, color").order("name", { ascending: true });
  const { count: suggestionCount } = await supabase.from("contact_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending");

  // O filtro é montado por consultaContatos (@/lib/contatosFiltro) — o MESMO código que
  // a exclusão em massa usa. Antes essa lógica vivia só aqui; se a ação em lote a
  // recriasse "parecida", uma diferença sutil apagaria contatos fora do filtro.
  const filtro = { q, view, tag: tagFilter, produto: produtoFilter, cadencia: cadenciaFilter, frio, responsavel: responsavelFilter, email: emailFiltro };

  // varrerContatos é a porta única: sem filtro de e-mail é a consulta de sempre; com
  // ele, passa pela peneira em JS e devolve TAMBÉM o total real do conjunto.
  //
  // NÃO ignore o erro daqui. Quando a consulta estoura o tempo limite do Postgres,
  // `data` vem null e a tela mostrava "nenhum contato" — igualzinho a uma base vazia.
  // Isso já custou um susto de "os contatos sumiram": eram 22 mil, intactos.
  const [varredura, { data: sequences }, { data: members }, { data: produtos }] = await Promise.all([
    varrerContatos(
      supabase,
      filtro,
      { gerente, userId: user?.id },
      {
        select:
          // `*` porque instagram/linkedin nascem na 0110: nomeadas, derrubariam a LISTA
          // inteira antes da migration.
          "*, contact_tags(tag_id, tags(id, name, color))",
        quantidade: 200,
      }
    )
      .then((v) => ({ v, erro: null as string | null }))
      .catch((e: any) => ({ v: null, erro: msgErro(e) })),
    supabase.from("sequences").select("id, name").eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true),
    supabase.from("products").select("id, name").eq("active", true).order("name", { ascending: true }),
  ]);

  const contacts = varredura.v?.linhas || [];
  const erroContatos = varredura.erro;
  const totalPeneira = varredura.v?.total ?? null;
  const peneiraTruncada = !!varredura.v?.truncado;

  const seqs = (sequences as { id: string; name: string }[]) || [];
  const memberList = (members as { id: string; full_name: string | null; email: string }[]) || [];
  const tagList = (tags as { id: string; name: string; color: string }[]) || [];
  const produtoList = (produtos as { id: string; name: string }[]) || [];

  // produtos por contato (para as etiquetas na lista) — 2 queries, não N
  const contatoIds = ((contacts as any[]) || []).map((c) => c.id);
  const produtosPorId = await produtosPorContatos(supabase, contatoIds);
  const produtosContato: Record<string, { id: string; name: string }[]> = {};
  for (const [cid, arr] of Object.entries(produtosPorId)) produtosContato[cid] = arr.map((p) => ({ id: p.id, name: p.name }));

  // ESTEIRA: quais contatos ainda estão na fila de descoberta de e-mail (SMTP).
  // 1 query só, para pintar o estágio "Buscando e-mail" na lista.
  const emailPendente = new Set<string>();
  if (contatoIds.length) {
    const { data: eq } = await supabase
      .from("email_discovery_queue")
      .select("contact_id")
      .eq("status", "pending")
      .in("contact_id", contatoIds);
    for (const r of (eq as any[]) || []) if (r.contact_id) emailPendente.add(r.contact_id);
  }
  const contactsComEsteira = ((contacts as any[]) || []).map((c) => ({ ...c, emailPendente: emailPendente.has(c.id) }));

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Contatos</h1>
          <p className="mt-1 text-sm text-subtle">Sua base de prospecção e relacionamento. Comece pela <b>Visão</b> e afunile nos filtros quando precisar.</p>
        </div>
        {(suggestionCount ?? 0) > 0 && (
          <a href="/dashboard/contatos/sugestoes" className="shrink-0 rounded-lg bg-warn/10 px-3 py-2 text-sm font-semibold text-warn hover:bg-warn/20">
            {suggestionCount} {suggestionCount === 1 ? "sugestão" : "sugestões"} →
          </a>
        )}
      </div>

      <div className="mt-6">
        <ContactTools />
      </div>

      <ContactsFilterBar
        view={view}
        q={q}
        tag={tagFilter}
        produto={produtoFilter}
        cadencia={cadenciaFilter}
        frio={frio}
        responsavel={responsavelFilter}
        email={emailFiltro}
        tags={tagList}
        produtos={produtoList}
        cadencias={seqs}
        membros={memberList.map((m) => ({ id: m.id, name: m.full_name || m.email }))}
      />

      {erroContatos && (
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm">
          <p className="font-semibold text-danger">A consulta de contatos falhou — a lista abaixo NÃO reflete sua base.</p>
          <p className="mt-1 text-subtle">
            Seus dados continuam no banco. O motivo costuma ser consulta lenta demais (tempo limite) ou queda momentânea
            do banco. Recarregue; se persistir, tire um filtro ou confira o número real em{" "}
            <a href="/dashboard/config" className="text-brand-dark underline">Configurações → Negócio</a>.
          </p>
          <p className="mt-2 font-mono text-[11px] text-subtle">{erroContatos}</p>
        </div>
      )}

      {/* O TAMANHO REAL DO CONJUNTO.
          Filtrar, ver 200 linhas e concluir que a base tem 200 é o erro que este aviso
          existe para impedir — quando a peneira roda ela já contou tudo, então o número
          é dito. Ela roda por dois motivos: veredito de e-mail (regra em JS) ou lista de
          ids grande demais para caber na URL (o caso do "Prontos p/ cadência"). */}
      {totalPeneira !== null && !erroContatos && (
        <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-subtle">
          <b>{totalPeneira}</b> {totalPeneira === 1 ? "contato bate" : "contatos batem"} com este filtro
          {totalPeneira > contacts.length ? ` — mostrando os ${contacts.length} de maior score.` : "."}
          {peneiraTruncada && " Paramos em 60.000 contatos examinados: pode haver mais."}
        </p>
      )}

      <div className="mt-4">
        <ContactsTable
          contacts={contactsComEsteira}
          sequences={seqs}
          members={memberList}
          tags={tagList}
          products={produtosContato}
          filtro={filtro}
        />
      </div>
    </div>
  );
}
