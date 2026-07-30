import "server-only";

// Em quais PRODUTOS um contato/empresa está "inscrito".
// Derivamos de duas fontes, sem tabela nova:
//   1) CADÊNCIA  — enrollments → sequences.product_id → products
//   2) OPORTUNIDADE — opportunities.product_id (o que está sendo vendido)
// Assim a ficha mostra os produtos em que a pessoa/empresa está engajada.

export type ProdutoVinculo = {
  id: string;
  name: string;
  viaCadencia: boolean;
  viaOportunidade: boolean;
};

function acumular(map: Map<string, ProdutoVinculo>, p: any, fonte: "cadencia" | "oportunidade") {
  if (!p?.id) return;
  const cur = map.get(p.id) || { id: p.id, name: p.name || "Produto", viaCadencia: false, viaOportunidade: false };
  if (fonte === "cadencia") cur.viaCadencia = true;
  else cur.viaOportunidade = true;
  map.set(p.id, cur);
}

function ordenar(map: Map<string, ProdutoVinculo>): ProdutoVinculo[] {
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Produtos de UM contato.
export async function produtosDoContato(supabase: any, contactId: string): Promise<ProdutoVinculo[]> {
  const [{ data: enr }, { data: opps }] = await Promise.all([
    supabase.from("enrollments").select("sequences(product_id, products(id, name))").eq("contact_id", contactId),
    supabase.from("opportunities").select("product_id, products(id, name)").eq("primary_contact_id", contactId).not("product_id", "is", null),
  ]);
  const map = new Map<string, ProdutoVinculo>();
  for (const e of (enr as any[]) || []) acumular(map, e?.sequences?.products, "cadencia");
  for (const o of (opps as any[]) || []) acumular(map, o?.products, "oportunidade");
  return ordenar(map);
}

// Produtos de VÁRIOS contatos de uma vez (para a LISTA). 2 queries, não N.
// Devolve um mapa contactId → produtos.
export async function produtosPorContatos(supabase: any, contactIds: string[]): Promise<Record<string, ProdutoVinculo[]>> {
  const ids = Array.from(new Set(contactIds)).filter(Boolean);
  if (!ids.length) return {};
  const [{ data: enr }, { data: opps }] = await Promise.all([
    supabase.from("enrollments").select("contact_id, sequences(product_id, products(id, name))").in("contact_id", ids),
    supabase.from("opportunities").select("primary_contact_id, product_id, products(id, name)").in("primary_contact_id", ids).not("product_id", "is", null),
  ]);
  const porContato = new Map<string, Map<string, ProdutoVinculo>>();
  const garantir = (cid: string) => {
    let m = porContato.get(cid);
    if (!m) { m = new Map(); porContato.set(cid, m); }
    return m;
  };
  for (const e of (enr as any[]) || []) if (e?.contact_id) acumular(garantir(e.contact_id), e?.sequences?.products, "cadencia");
  for (const o of (opps as any[]) || []) if (o?.primary_contact_id) acumular(garantir(o.primary_contact_id), o?.products, "oportunidade");
  const out: Record<string, ProdutoVinculo[]> = {};
  for (const [cid, m] of porContato) out[cid] = ordenar(m);
  return out;
}

// Produtos por EMPRESA, direto (para a lista de Empresas).
//
// POR QUE existe: a página de Empresas montava a lista de ids de TODOS os contatos
// das 300 empresas e chamava produtosPorContatos com ela. Numa base como a do
// ContadorX isso vira um `.in("contact_id", [~26.000 uuids])` — uma requisição de
// quase 1 MB só de parâmetros, que o PostgREST tem que analisar antes de tocar no
// banco. É lenta na melhor das hipóteses e estoura o limite da requisição na pior.
//
// Aqui o caminho é o inverso e custa 2 consultas fixas: pergunta ao banco pelos
// vínculos JÁ FILTRADOS pelas 300 empresas, usando o join interno com contacts.
export async function produtosPorEmpresas(supabase: any, accountIds: string[]): Promise<Record<string, ProdutoVinculo[]>> {
  const ids = Array.from(new Set(accountIds)).filter(Boolean);
  if (!ids.length) return {};
  const [{ data: enr }, { data: opps }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("contacts!inner(account_id), sequences(product_id, products(id, name))")
      .in("contacts.account_id", ids),
    supabase
      .from("opportunities")
      .select("account_id, product_id, products(id, name)")
      .in("account_id", ids)
      .not("product_id", "is", null),
  ]);
  const porConta = new Map<string, Map<string, ProdutoVinculo>>();
  const garantir = (aid: string) => {
    let m = porConta.get(aid);
    if (!m) { m = new Map(); porConta.set(aid, m); }
    return m;
  };
  for (const e of (enr as any[]) || []) {
    const aid = e?.contacts?.account_id;
    if (aid) acumular(garantir(aid), e?.sequences?.products, "cadencia");
  }
  for (const o of (opps as any[]) || []) {
    if (o?.account_id) acumular(garantir(o.account_id), o?.products, "oportunidade");
  }
  const out: Record<string, ProdutoVinculo[]> = {};
  for (const [aid, m] of porConta) out[aid] = ordenar(m);
  return out;
}

// IDs de contato inscritos em UM ou VÁRIOS produtos (para o FILTRO da lista).
// Vários produtos = OU (quem está em qualquer um deles) — é o que o filtro multi espera.
export async function contatoIdsPorProduto(supabase: any, productId: string | string[]): Promise<string[]> {
  const ids = (Array.isArray(productId) ? productId : [productId]).filter(Boolean);
  if (!ids.length) return [];
  const [{ data: enr }, { data: opps }] = await Promise.all([
    supabase.from("enrollments").select("contact_id, sequences!inner(product_id)").in("sequences.product_id", ids),
    supabase.from("opportunities").select("primary_contact_id").in("product_id", ids).not("primary_contact_id", "is", null),
  ]);
  const set = new Set<string>();
  for (const e of (enr as any[]) || []) if (e?.contact_id) set.add(e.contact_id);
  for (const o of (opps as any[]) || []) if (o?.primary_contact_id) set.add(o.primary_contact_id);
  return Array.from(set);
}

// Produtos de uma EMPRESA — agrega os contatos dela + as oportunidades da conta.
export async function produtosDaEmpresa(supabase: any, accountId: string, contactIds: string[]): Promise<ProdutoVinculo[]> {
  const [{ data: enr }, { data: opps }] = await Promise.all([
    contactIds.length
      ? supabase.from("enrollments").select("sequences(product_id, products(id, name))").in("contact_id", contactIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("opportunities").select("product_id, products(id, name)").eq("account_id", accountId).not("product_id", "is", null),
  ]);
  const map = new Map<string, ProdutoVinculo>();
  for (const e of (enr as any[]) || []) acumular(map, e?.sequences?.products, "cadencia");
  for (const o of (opps as any[]) || []) acumular(map, o?.products, "oportunidade");
  return ordenar(map);
}
