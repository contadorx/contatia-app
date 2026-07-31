import { msgErro } from "@/lib/erros";

// ============================================================
// APAGAR UM LOTE — do lado do banco quando dá, pelo caminho antigo quando não dá.
//
// O caminho antigo (PostgREST, `id=in.(...)`) manda os ids na URL, e 1.000 uuids passam
// de 37 KB — acima do limite de 8 KB. Por isso ele apagava de 200 em 200: cada 1.000
// contatos viravam 5 requisições, cada uma com sua ida e volta até o banco. Somado ao
// statement_timeout curto do papel `authenticated`, era isso que fazia a exclusão parar
// no meio de uma base grande.
//
// A função `excluir_lote` (migration 0102) recebe os ids no CORPO da requisição — sem
// limite de tamanho — e apaga tudo numa ida só, com limite de tempo próprio.
//
// O fallback não é preciosismo: o app é publicado pela Vercel e a migration é aplicada
// à mão no Supabase, em momentos diferentes. Entre os dois, o app TEM que continuar
// apagando. Só o 404 da função (PGRST202) e o "função não existe" (42883) fazem cair
// para o caminho antigo — qualquer outro erro é erro de verdade e sobe.
// ============================================================

const ONDA_DELETE = 200; // ~7,4 KB de URL, dentro do limite do PostgREST

export type ResultadoLote = { n: number; erro?: string; viaBanco?: boolean };

export async function apagarLote(
  supabase: any,
  entidade: "contacts" | "accounts",
  tenant_id: string,
  ids: string[]
): Promise<ResultadoLote> {
  if (!ids.length) return { n: 0 };

  // 1) tentativa pela função do banco
  const { data, error } = await supabase.rpc("excluir_lote", {
    p_entidade: entidade,
    p_tenant: tenant_id,
    p_ids: ids,
  });
  if (!error) return { n: Number(data) || 0, viaBanco: true };

  const cod = String((error as any)?.code || "");
  const ausente = cod === "PGRST202" || cod === "42883" || /excluir_lote/i.test(String((error as any)?.message || ""));
  if (!ausente) return { n: 0, erro: msgErro(error) };

  // 2) caminho antigo: pedaços de 200 por causa do tamanho da URL
  let n = 0;
  for (let i = 0; i < ids.length; i += ONDA_DELETE) {
    const { data: apagados, error: errDel } = await supabase
      .from(entidade).delete().eq("tenant_id", tenant_id).in("id", ids.slice(i, i + ONDA_DELETE)).select("id");
    if (errDel) return { n, erro: msgErro(errDel) };
    const q = ((apagados as any[]) || []).length;
    n += q;
    if (!q) break; // RLS barrou
  }
  return { n, viaBanco: false };
}
