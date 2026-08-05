import { createClient } from "@/lib/supabase/server";
import AccountTools from "@/components/AccountTools";
import AccountImport from "@/components/AccountImport";
import AccountsCockpit from "@/components/AccountsCockpit";
import AccountsFilterBar from "@/components/AccountsFilterBar";
import { produtosPorEmpresas } from "@/lib/produtos";
import { comoLista } from "@/lib/filtros";

export const dynamic = "force-dynamic";

export default async function Contas({
  searchParams,
}: {
  searchParams: { tag?: string | string[]; q?: string; produto?: string | string[]; view?: string; uf?: string | string[]; cidade?: string };
}) {
  const supabase = createClient();
  const q = (searchParams.q || "").trim();
  const qSafe = q.slice(0, 80).replace(/[,()%*]/g, " ").trim();

  // ============================================================
  // LOCALIDADE FILTRA NO BANCO, NÃO NA TELA
  //
  // Tag, produto e "visão" são filtrados em memória sobre as 300 empresas que a
  // consulta traz. Para localidade isso seria errado de um jeito silencioso: filtrar
  // "Santo André" dentro das 300 mais recentes responderia "nenhuma empresa" para
  // quem tem 40 em Santo André mais antigas que isso. Por isso UF e cidade entram na
  // CONSULTA, junto com a busca por texto.
  //
  // O acento é o detalhe que decide se funciona: município vindo da Receita é gravado
  // sem acento ("SANTO ANDRE"), e digitado à mão costuma vir com ("Santo André"). O
  // Postgres não normaliza sozinho, então perguntamos das duas formas.
  // ============================================================
  const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ufs = comoLista(searchParams.uf).map((u) => u.toUpperCase().slice(0, 2)).filter((u) => /^[A-Z]{2}$/.test(u));
  const cidade = (searchParams.cidade || "").trim().slice(0, 60).replace(/[,()%*]/g, " ").trim();

  let accountsQuery = supabase
    .from("accounts")
    .select("id, name, uf, municipio, cnpj, domain, contacts(id, name, role_title, email, last_activity_at), opportunities(id, title, value_mrr, status, product_id, products(id, name)), account_tags(tags(id, name, color))")
    .order("created_at", { ascending: false })
    .limit(300);
  // busca por nome, CNPJ, domínio — e também por cidade, que é o que a pessoa digita
  // sem pensar em qual campo é qual
  if (qSafe) {
    const qSem = semAcento(qSafe);
    const alternativas = [
      `name.ilike.%${qSafe}%`, `cnpj.ilike.%${qSafe}%`, `domain.ilike.%${qSafe}%`,
      `municipio.ilike.%${qSafe}%`,
    ];
    if (qSem !== qSafe) alternativas.push(`name.ilike.%${qSem}%`, `municipio.ilike.%${qSem}%`);
    accountsQuery = accountsQuery.or(alternativas.join(","));
  }
  if (ufs.length) accountsQuery = accountsQuery.in("uf", ufs);
  if (cidade) {
    const cSem = semAcento(cidade);
    accountsQuery = accountsQuery.or(
      cSem !== cidade ? `municipio.ilike.%${cidade}%,municipio.ilike.%${cSem}%` : `municipio.ilike.%${cidade}%`
    );
  }
  // guarda o erro: sem isso, uma consulta que estoura o tempo limite vira "nenhuma
  // empresa" na tela — indistinguível de base vazia.
  const { data: accounts, error: erroEmpresas } = await accountsQuery;

  const [{ data: allTags }, { data: produtos }, { data: members }] = await Promise.all([
    supabase.from("tags").select("id, name, color").order("name", { ascending: true }),
    supabase.from("products").select("id, name").eq("active", true).order("name", { ascending: true }),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true),
  ]);
  const produtoList = (produtos as { id: string; name: string }[]) || [];
  const memberList = (members as { id: string; full_name: string | null; email: string }[]) || [];

  // Produtos por EMPRESA — 2 consultas, filtradas pelas 300 empresas da página.
  // ANTES isto passava a lista de ids de TODOS os contatos dessas empresas (~26 mil
  // numa base grande) num único `.in()`: requisição gigante, lenta, e candidata a
  // estourar o limite. Agora quem filtra é o banco, pelo account_id.
  const idsEmpresas = ((accounts as any[]) || []).map((a) => a.id);
  const produtosPorConta = await produtosPorEmpresas(supabase, idsEmpresas);

  let rows = ((accounts as any[]) || []).map((a) => {
    const contacts = (a.contacts as any[]) || [];
    const opps = (a.opportunities as any[]) || [];
    // produtos da empresa = vínculos por cadência dos contatos dela + produtos das oportunidades
    const map = new Map<string, { id: string; name: string }>();
    for (const p of produtosPorConta[a.id] || []) map.set(p.id, { id: p.id, name: p.name });
    for (const o of opps) if (o.products?.id) map.set(o.products.id, { id: o.products.id, name: o.products.name });
    return {
      id: a.id,
      name: a.name,
      domain: a.domain,
      cnpj: a.cnpj,
      uf: a.uf,
      municipio: a.municipio,
      contacts,
      opps,
      produtos: Array.from(map.values()).sort((x, y) => x.name.localeCompare(y.name, "pt-BR")),
      ultimo: (contacts
        .map((c) => c.last_activity_at)
        .filter(Boolean)
        .sort()
        .pop()) || null,
      tags: ((a.account_tags as any[]) || []).map((r) => r.tags).filter(Boolean),
    };
  });

  // Filtros MULTI: dentro da caixa é OU (tem qualquer uma das tags), entre caixas é E.
  const tagFilter = comoLista(searchParams.tag);
  if (tagFilter.length) rows = rows.filter((a) => a.tags.some((t: any) => tagFilter.includes(t.id)));
  const produtoFilter = comoLista(searchParams.produto);
  if (produtoFilter.length) rows = rows.filter((a) => a.produtos.some((p) => produtoFilter.includes(p.id)));

  // Visões rápidas (in-memory) — o "trabalho do dia" em Empresas
  const view = searchParams.view || "";
  if (view === "sem_contato") rows = rows.filter((a) => a.contacts.length === 0);
  else if (view === "sem_opp") rows = rows.filter((a) => a.opps.length === 0);
  else if (view === "com_opp") rows = rows.filter((a) => a.opps.some((o: any) => o.status === "open"));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Empresas</h1>
      <p className="mt-1 text-sm text-subtle">As contas B2B: cada empresa reúne seus contatos e oportunidades.</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <AccountTools />
        <AccountImport />
      </div>

      <AccountsFilterBar
        view={view}
        q={q}
        tag={tagFilter}
        produto={produtoFilter}
        uf={ufs}
        cidade={cidade}
        tags={(allTags as { id: string; name: string }[]) || []}
        produtos={produtoList}
      />

      {erroEmpresas && (
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm">
          <p className="font-semibold text-danger">A consulta de empresas falhou — a lista abaixo NÃO reflete sua base.</p>
          <p className="mt-1 text-subtle">
            Seus dados continuam no banco. Normalmente é tempo limite da consulta. Recarregue; se persistir, veja o
            número real em <a href="/dashboard/config" className="text-brand-dark underline">Configurações → Negócio</a>.
          </p>
          <p className="mt-2 font-mono text-[11px] text-subtle">{erroEmpresas.message}</p>
        </div>
      )}

      <div className="mt-6">
        <AccountsCockpit
          rows={rows}
          allTags={(allTags as any[]) || []}
          members={memberList}
          filtro={{ q, tag: tagFilter }}
          filtroSoDaTela={produtoFilter.length > 0 || !!view}
        />
      </div>
    </div>
  );
}
