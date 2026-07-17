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
