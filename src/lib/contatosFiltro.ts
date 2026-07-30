import "server-only";

// ============================================================
// FILTRO DE CONTATOS — fonte única de verdade.
//
// POR QUE existe: a lista mostra 200 contatos e o "marcar todos" só alcançava esses
// 200. Para oferecer "selecionar TODOS os que batem com o filtro", a exclusão precisa
// reconstruir no servidor exatamente a mesma consulta que a tela usou. Se a tela e a
// ação divergirem em UMA condição, o operador apaga o que não estava vendo.
//
// Por isso a montagem da consulta mora aqui, e tanto a página quanto as ações em lote
// chamam esta função. Mudou um filtro? Muda num lugar só, e os dois acompanham.
// ============================================================

import { HOT_THRESHOLD } from "@/lib/scoring";
import { contatoIdsPorProduto } from "@/lib/produtos";
import { comoLista } from "@/lib/filtros";

const NENHUM = "00000000-0000-0000-0000-000000000000";
const VIEWS_VALIDAS = ["completar", "quentes", "com_wa", "prontos", "resgatar"];
const FRIOS_VALIDOS = ["nunca", "15", "30"];
// Páginas de 1.000 ao varrer as tabelas de vínculo. O PostgREST corta em 1.000 por
// consulta; sem paginar, um filtro de tag com 5.000 contatos devolveria mil ids
// DIFERENTES a cada chamada (não há ORDER BY estável) — a tela mostraria um conjunto
// e a exclusão apagaria outro.
const PAGINA_VINCULOS = 1000;
const MAX_VINCULOS = 100000;

export type FiltroContatos = {
  q?: string;
  view?: string;                 // completar | quentes | com_wa | prontos | resgatar
  tag?: string[];
  produto?: string[];
  cadencia?: string[];
  frio?: string;                 // "15" | "30" | "nunca"
};

// A busca passa por saneamento: `%`, `*`, vírgula e parênteses viram espaço, porque
// vão direto num `or=(name.ilike.%…)` do PostgREST. Exportada porque quem decide se o
// filtro é "vazio" precisa olhar o texto EFETIVO, não o que foi digitado.
export function buscaEfetiva(q: any): string {
  return typeof q === "string" ? q.trim().slice(0, 80).replace(/[,()%*]/g, " ").trim() : "";
}

// Normaliza o que vem da URL ou do cliente — nunca confie no formato de entrada.
// Usa comoLista (o MESMO parser da URL): aceita "a", "a,b" e ["a","b"]. Antes aqui só
// array passava, e o erro caía para o lado perigoso — uma faceta ignorada ALARGA a
// consulta, ou seja, a exclusão pegaria a base inteira em vez de uma tag.
export function normalizarFiltro(f: any): FiltroContatos {
  const view = typeof f?.view === "string" && VIEWS_VALIDAS.includes(f.view) ? f.view : "";
  const frio = typeof f?.frio === "string" && FRIOS_VALIDOS.includes(f.frio) ? f.frio : "";
  return {
    q: typeof f?.q === "string" ? f.q.trim().slice(0, 80) : "",
    view,
    tag: comoLista(f?.tag),
    produto: comoLista(f?.produto),
    cadencia: comoLista(f?.cadencia),
    frio,
  };
}

// Existe algum recorte ATIVO DE VERDADE? Repare que olha a busca EFETIVA e as listas
// já normalizadas: `?q=%%%` sana para vazio e não filtra nada, e `?view=lixo` não
// aplica condição nenhuma. Tratar esses casos como "tem filtro" faria a exclusão pular
// a confirmação extra e zerar a base achando que estava recortando.
export function filtroVazio(bruto: any): boolean {
  const f = normalizarFiltro(bruto);
  return (
    !buscaEfetiva(f.q) && !f.view && !f.frio &&
    !f.tag?.length && !f.produto?.length && !f.cadencia?.length
  );
}

type Contexto = { gerente: boolean; userId?: string | null; tenantId?: string | null };

// Lê TODAS as páginas de uma tabela de vínculo. Sem isto o PostgREST devolve só as
// primeiras 1.000 linhas e o filtro passa a mentir silenciosamente.
async function todosOsVinculos(consulta: (de: number, ate: number) => any, campo: string): Promise<string[]> {
  const ids: string[] = [];
  for (let inicio = 0; inicio < MAX_VINCULOS; inicio += PAGINA_VINCULOS) {
    const { data, error } = await consulta(inicio, inicio + PAGINA_VINCULOS - 1);
    if (error) throw error;
    const linhas = ((data as any[]) || []);
    for (const r of linhas) if (r?.[campo]) ids.push(r[campo]);
    if (linhas.length < PAGINA_VINCULOS) break;
  }
  return ids;
}

// As três facetas que restringem por LISTA DE IDS (tag, produto, cadência) são
// resolvidas antes e intersectadas: dentro da caixa é OU, entre caixas é E.
async function idsDasFacetas(supabase: any, f: FiltroContatos): Promise<string[] | null> {
  const restricoes: string[][] = [];

  if (f.tag?.length) {
    // ordem estável + paginação: com várias tags há uma linha POR TAG por contato,
    // então o teto de 1.000 estoura ainda mais rápido que com uma tag só.
    restricoes.push(
      await todosOsVinculos(
        (de, ate) => supabase.from("contact_tags").select("contact_id").in("tag_id", f.tag!).order("contact_id", { ascending: true }).range(de, ate),
        "contact_id"
      )
    );
  }
  if (f.produto?.length) {
    restricoes.push(await contatoIdsPorProduto(supabase, f.produto));
  }
  if (f.cadencia?.length) {
    restricoes.push(
      await todosOsVinculos(
        (de, ate) => supabase.from("enrollments").select("contact_id").in("sequence_id", f.cadencia!).in("status", ["active", "paused"]).order("contact_id", { ascending: true }).range(de, ate),
        "contact_id"
      )
    );
  }

  if (!restricoes.length) return null;
  // Set para a interseção: com dezenas de milhares de ids, o .includes() em array
  // vira O(n²) e a página trava antes de qualquer consulta sair.
  return restricoes.reduce((acc, cur) => {
    const s = new Set(cur);
    return acc.filter((id) => s.has(id));
  });
}

// Monta a consulta já com TODAS as condições aplicadas. Quem chama decide o `select`,
// a ordem e o limite — é a única diferença entre listar, contar e apagar.
//
// Devolve { query } EM VEZ da consulta direto: o builder do postgrest é "thenable", e
// devolvê-lo de uma função async faz o JavaScript executá-lo na hora (o await adota a
// promise). Resultado: a consulta saía do Promise.all da página e perdia o paralelismo,
// e o erro escapava do try. Embrulhado num objeto, quem chama decide QUANDO executar.
export async function consultaContatos(
  supabase: any,
  filtro: FiltroContatos,
  ctx: Contexto,
  opts: { select: string; count?: "exact"; head?: boolean; limit?: number; ordenar?: boolean }
): Promise<{ query: any }> {
  const f = normalizarFiltro(filtro);
  const idsFacetas = await idsDasFacetas(supabase, f);

  // "prontos" e "resgatar" excluem quem já está em cadência ativa
  let emCadencia: string[] = [];
  if (f.view === "prontos" || f.view === "resgatar") {
    // paginado pelo mesmo motivo das facetas: com mais de 1.000 matrículas ativas, a
    // tela excluiria um conjunto e a exclusão outro.
    emCadencia = Array.from(new Set(await todosOsVinculos(
      (de, ate) => supabase.from("enrollments").select("contact_id").in("status", ["active", "paused"]).order("contact_id", { ascending: true }).range(de, ate),
      "contact_id"
    )));
  }

  let q = supabase
    .from("contacts")
    .select(opts.select, opts.count ? { count: opts.count, head: !!opts.head } : undefined);

  if (opts.ordenar !== false) {
    q = q.order("score", { ascending: false }).order("created_at", { ascending: false });
  }
  if (opts.limit) q = q.limit(opts.limit);

  // um id impossível quando a interseção deu vazia: "nenhum" e não "todos"
  if (idsFacetas) q = q.in("id", idsFacetas.length ? idsFacetas : [NENHUM]);
  // tenant explícito quando o chamador souber: a RLS já isola, mas este módulo é a
  // fonte de uma EXCLUSÃO — se um dia alguém passar aqui o client de service role
  // (como os crons fazem), sem esta linha a consulta atravessaria workspaces.
  if (ctx.tenantId) q = q.eq("tenant_id", ctx.tenantId);
  if (!ctx.gerente) q = q.eq("assigned_to", ctx.userId ?? "");

  const qSafe = buscaEfetiva(f.q);
  if (qSafe) q = q.or(`name.ilike.%${qSafe}%,email.ilike.%${qSafe}%,company.ilike.%${qSafe}%`);

  // ---- visões rápidas ----
  if (f.view === "completar") {
    q = q.or("email.is.null,email.eq.").or("phone.is.null,phone.eq.");
  } else if (f.view === "quentes") {
    q = q.gte("score", HOT_THRESHOLD);
  } else if (f.view === "com_wa") {
    q = q.eq("wa_status", "valid");
  } else if (f.view === "prontos") {
    q = q.or("email.neq.,phone.neq.");
    if (emCadencia.length) q = q.not("id", "in", `(${emCadencia.join(",")})`);
  } else if (f.view === "resgatar") {
    const corte = new Date(); corte.setDate(corte.getDate() - 30);
    q = q.or(`last_activity_at.is.null,last_activity_at.lt.${corte.toISOString()}`);
    if (emCadencia.length) q = q.not("id", "in", `(${emCadencia.join(",")})`);
  }

  // ---- último toque (vale junto com qualquer visão) ----
  if (f.frio === "nunca") {
    q = q.is("last_activity_at", null);
  } else if (f.frio === "15" || f.frio === "30") {
    const corte = new Date(); corte.setDate(corte.getDate() - Number(f.frio));
    q = q.or(`last_activity_at.is.null,last_activity_at.lt.${corte.toISOString()}`);
  }

  return { query: q };
}
