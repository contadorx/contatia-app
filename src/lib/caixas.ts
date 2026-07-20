import "server-only";

// Resolve a CAIXA de e-mail de uma inscrição (enrollment), com rodízio no pool do
// produto. Ordem: override da cadência → pool do produto (sorteia entre as ativas)
// → caixa única legada do produto → null (rodízio geral no envio).
//
// O sorteio dentro do pool dá a rotação por CONTATO (todos os passos do contato
// saem da mesma caixa = sender consistente); contatos diferentes caem em caixas
// diferentes. Os limites diários/aquecimento continuam sendo respeitados no envio.
export async function resolveEmailBox(db: any, _tenantId: string, sequenceId: string): Promise<string | null> {
  const { data: seq } = await db
    .from("sequences")
    .select("product_id, email_account_id")
    .eq("id", sequenceId)
    .maybeSingle();

  // 1) override explícito da cadência
  const seqBox = ((seq as any)?.email_account_id as string) || null;
  if (seqBox) return seqBox;

  const productId = ((seq as any)?.product_id as string) || null;
  if (!productId) return null;

  // 2) pool do produto — só as caixas ATIVAS entram no rodízio
  const { data: pool } = await db
    .from("product_email_accounts")
    .select("email_account_id")
    .eq("product_id", productId);
  let ids = ((pool as any[]) || []).map((r) => r.email_account_id).filter(Boolean);
  if (ids.length) {
    const { data: ativas } = await db.from("email_accounts").select("id").in("id", ids).eq("is_active", true);
    ids = ((ativas as any[]) || []).map((a) => a.id);
    if (ids.length) return ids[Math.floor(Math.random() * ids.length)];
  }

  // 3) caixa única legada do produto (0064)
  const { data: prod } = await db.from("products").select("email_account_id").eq("id", productId).maybeSingle();
  return ((prod as any)?.email_account_id as string) || null;
}
