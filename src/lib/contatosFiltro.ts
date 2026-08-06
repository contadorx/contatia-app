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
import { comoLista, SEM_DONO, SEM_VINCULO } from "@/lib/filtros";
import { vereditoEmail, VEREDITOS_EMAIL } from "@/lib/emailVeredito";

const NENHUM = "00000000-0000-0000-0000-000000000000";
export { SEM_DONO };
// Valor pedido que não é veredito nenhum. Vira "nenhum contato", nunca "todos" —
// mesma regra do responsável: faceta descartada em silêncio ALARGA a consulta, e esta
// consulta também alimenta a exclusão em massa.
const EMAIL_INVALIDO = "__invalido__";
const VIEWS_VALIDAS = ["completar", "quentes", "com_wa", "sem_wa", "prontos", "resgatar"];
const FRIOS_VALIDOS = ["nunca", "15", "30"];
// Páginas de 1.000 ao varrer as tabelas de vínculo. O PostgREST corta em 1.000 por
// consulta; sem paginar, um filtro de tag com 5.000 contatos devolveria mil ids
// DIFERENTES a cada chamada (não há ORDER BY estável) — a tela mostraria um conjunto
// e a exclusão apagaria outro.
const PAGINA_VINCULOS = 1000;
const MAX_VINCULOS = 100000;

export type FiltroContatos = {
  q?: string;
  view?: string;                 // completar | quentes | com_wa | sem_wa | prontos | resgatar
  tag?: string[];
  produto?: string[];
  cadencia?: string[];
  frio?: string;                 // "15" | "30" | "nunca"
  responsavel?: string[];        // ids de profiles; "__sem__" = sem dono
  // VEREDITO DO E-MAIL — lista, igual às outras caixas.
  // Nasceu como valor único e destoava: as demais facetas são multi + busca, e a
  // pergunta real quase sempre é "o que ainda dá trabalho", que são DOIS vereditos
  // (caixa geral e outro nome). Dentro da caixa é OU, como nas outras.
  email?: string[];
  // ---- FILTRO NEGATIVO (ver o bloco "O QUE NÃO TEM" mais abaixo) ----
  // Em cada faceta de vínculo, `true` inverte: em vez de "tem alguma destas", vira
  // "não tem nenhuma destas". O valor especial SEM_VINCULO ("__sem__") dentro da lista
  // significa "não tem NENHUMA", sem precisar escolher quais.
  tagNao?: boolean;
  produtoNao?: boolean;
  cadenciaNao?: boolean;
};

// ============================================================
// O QUE NÃO TEM — o filtro que faltava
//
// Toda a barra de filtros respondia "quem TEM isto". A pergunta que sobra na operação
// é a oposta, e é ela que gera trabalho: quem ainda não entrou em cadência nenhuma,
// quem não tem tag, quem não está ligado a produto nenhum. Sem isso, achar os 3.000
// contatos importados que ninguém tocou dependia de exportar tudo e cruzar na planilha.
//
// O mecanismo é o mesmo do filtro positivo — a lista de ids de quem TEM —, só que
// aplicada ao contrário. E entra na mesma peneira: "quem já está em cadência" costuma
// ser uma lista grande demais para caber numa URL, que foi o Bad Request de ontem.
// ============================================================
export { SEM_VINCULO } from "@/lib/filtros";


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
    // Só uuid ou o marcador de "sem dono". E se o pedido tinha valores mas NENHUM
    // sobreviveu, o resultado é NENHUM contato — não "todos". Faceta descartada em
    // silêncio alarga a consulta, e esta mesma lista alimenta a exclusão em massa: o
    // erro tem de cair para o lado de mostrar de menos. É a lição do filtro de CNAE do
    // Radar, onde a validação transformou "contabilidade" em "a base inteira".
    responsavel: (() => {
      const pedidos = comoLista(f?.responsavel);
      if (!pedidos.length) return [];
      const bons = pedidos.filter((x) => x === SEM_DONO || /^[0-9a-f-]{36}$/i.test(x));
      return bons.length ? bons : [NENHUM];
    })(),
    tagNao: !!f?.tagNao,
    produtoNao: !!f?.produtoNao,
    cadenciaNao: !!f?.cadenciaNao,
    email: (() => {
      const pedidos = comoLista(f?.email);
      if (!pedidos.length) return [];
      const bons = pedidos.filter((v) => (VEREDITOS_EMAIL as string[]).includes(v));
      // pediu e nada sobreviveu = NENHUM contato, nunca "todos" (mesma regra do
      // responsável e do CNAE do Radar)
      return bons.length ? bons : [EMAIL_INVALIDO];
    })(),
  };
}

// Existe algum recorte ATIVO DE VERDADE? Repare que olha a busca EFETIVA e as listas
// já normalizadas: `?q=%%%` sana para vazio e não filtra nada, e `?view=lixo` não
// aplica condição nenhuma. Tratar esses casos como "tem filtro" faria a exclusão pular
// a confirmação extra e zerar a base achando que estava recortando.
export function filtroVazio(bruto: any): boolean {
  const f = normalizarFiltro(bruto);
  return (
    !buscaEfetiva(f.q) && !f.view && !f.frio && !f.email?.length &&
    !f.tag?.length && !f.produto?.length && !f.cadencia?.length &&
    !f.responsavel?.length
  );
}

// O veredito "sem" (não tem e-mail) o banco resolve sozinho. "bate", "caixa" e "outro"
// dependem de comparar o endereço com o NOME da pessoa — regra em JavaScript, com
// acento removido e abreviação (jsilva) reconhecida. Não existe SQL equivalente, então
// esses três passam pela peneira de varrerContatos().
export function precisaPeneira(filtro: any): boolean {
  const e = normalizarFiltro(filtro).email || [];
  // "sem e-mail" o banco resolve sozinho; os outros três dependem do JavaScript.
  return e.some((v) => v === "bate" || v === "caixa" || v === "outro");
}

// ============================================================
// LISTA DE IDS NÃO CABE NUMA URL — e o banco responde "Bad Request"
//
// Tag, produto e cadência viram uma lista de ids que entrava na consulta como
// `id=in.(uuid,uuid,…)`; "Prontos p/ cadência" e "Frios a resgatar" fazem o inverso,
// `id=not.in.(…)` com TODO MUNDO que está em cadência ativa. Enquanto a base era
// pequena, passava. Depois de umas matrículas em lote, a lista chegou aos milhares:
// cada uuid ocupa 37 caracteres na URL, então 1.000 já passam de 37 KB e o servidor
// recusa a requisição inteira — a tela mostrava "a consulta de contatos falhou" com um
// "Bad Request" que não dizia nada, e o filtro simplesmente parava de existir.
//
// Repare que o erro NÃO estava na lista: ela é buscada certinha, paginada, completa. O
// erro era insistir em mandá-la pela URL. Acima deste teto a restrição passa a ser
// aplicada em memória, na peneira — mais lento, e correto.
//
// O teto é conservador de propósito: 250 uuids ≈ 9 KB, e ainda sobra espaço para o
// resto do filtro (busca, responsável, datas) na mesma URL. A exclusão em massa já
// usava 200 pelo mesmo motivo, medido.
// ============================================================
const TETO_IDS_NA_URL = 250;

export function listasGrandes(pre: Preparo): boolean {
  return (
    (pre.idsFacetas?.length ?? 0) > TETO_IDS_NA_URL ||
    pre.emCadencia.length > TETO_IDS_NA_URL ||
    pre.idsExcluidos.length > TETO_IDS_NA_URL
  );
}

type Contexto = { gerente: boolean; userId?: string | null; tenantId?: string | null };

// O que é caro e não muda entre as páginas de uma mesma varredura.
export type Preparo = {
  idsFacetas: string[] | null;
  // ids a EXCLUIR vindos das facetas negativas ("sem cadência nenhuma", "sem a tag X")
  idsExcluidos: string[];
  emCadencia: string[];
};

export async function prepararFiltro(supabase: any, filtro: FiltroContatos): Promise<Preparo> {
  const f = normalizarFiltro(filtro);
  const { incluir: idsFacetas, excluir: idsExcluidos } = await idsDasFacetas(supabase, f);
  // "prontos" e "resgatar" excluem quem já está em cadência ativa. Paginado pelo mesmo
  // motivo das facetas: com mais de 1.000 matrículas ativas, a tela excluiria um
  // conjunto e a exclusão outro.
  let emCadencia: string[] = [];
  if (f.view === "prontos" || f.view === "resgatar") {
    emCadencia = Array.from(new Set(await todosOsVinculos(
      (de, ate) => supabase.from("enrollments").select("contact_id").in("status", ["active", "paused"]).order("contact_id", { ascending: true }).range(de, ate),
      "contact_id"
    )));
  }
  return { idsFacetas, idsExcluidos, emCadencia };
}

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
// resolvidas antes: dentro da caixa é OU, entre caixas é E. Com a negação ligada, a
// mesma lista vira EXCLUSÃO — e `__sem__` quer dizer "não tem nenhuma", que é a lista
// de quem tem QUALQUER uma.
async function idsDasFacetas(
  supabase: any,
  f: FiltroContatos
): Promise<{ incluir: string[] | null; excluir: string[] }> {
  const restricoes: string[][] = [];
  const excluir = new Set<string>();

  // quem tem QUALQUER tag / produto / cadência (para o "não tem nenhuma")
  const comQualquerTag = () =>
    todosOsVinculos(
      (de, ate) => supabase.from("contact_tags").select("contact_id").order("contact_id", { ascending: true }).range(de, ate),
      "contact_id"
    );
  const comQualquerCadencia = () =>
    todosOsVinculos(
      // TODAS as matrículas, em qualquer estado: quem terminou uma cadência já entrou
      // numa — e a pergunta aqui é "nunca entrou em nenhuma".
      (de, ate) => supabase.from("enrollments").select("contact_id").order("contact_id", { ascending: true }).range(de, ate),
      "contact_id"
    );

  const facetas: {
    valores: string[];
    negar: boolean;
    doValor: () => Promise<string[]>;
    deQualquer: () => Promise<string[]>;
  }[] = [
    {
      valores: f.tag || [],
      negar: !!f.tagNao,
      // ordem estável + paginação: com várias tags há uma linha POR TAG por contato,
      // então o teto de 1.000 estoura ainda mais rápido que com uma tag só.
      doValor: () =>
        todosOsVinculos(
          (de, ate) => supabase.from("contact_tags").select("contact_id").in("tag_id", (f.tag || []).filter((t) => t !== SEM_VINCULO)).order("contact_id", { ascending: true }).range(de, ate),
          "contact_id"
        ),
      deQualquer: comQualquerTag,
    },
    {
      valores: f.produto || [],
      negar: !!f.produtoNao,
      doValor: () => contatoIdsPorProduto(supabase, (f.produto || []).filter((p) => p !== SEM_VINCULO)),
      // "sem produto nenhum" = quem não aparece em vínculo de produto algum. A função
      // de produtos só sabe consultar por ids, então a lista de "qualquer" é a união
      // dos produtos pedidos quando houver, e vazia quando não houver nenhum escolhido
      // — nesse caso o `__sem__` sozinho não tem como ser resolvido e a faceta não
      // aplica condição (melhor não filtrar do que filtrar errado).
      deQualquer: async () => [],
    },
    {
      valores: f.cadencia || [],
      negar: !!f.cadenciaNao,
      doValor: () =>
        todosOsVinculos(
          (de, ate) => supabase.from("enrollments").select("contact_id").in("sequence_id", (f.cadencia || []).filter((c) => c !== SEM_VINCULO)).in("status", ["active", "paused"]).order("contact_id", { ascending: true }).range(de, ate),
          "contact_id"
        ),
      deQualquer: comQualquerCadencia,
    },
  ];

  for (const faceta of facetas) {
    if (!faceta.valores.length) continue;
    const querSemNenhuma = faceta.valores.includes(SEM_VINCULO);
    const escolhidos = faceta.valores.filter((v) => v !== SEM_VINCULO);

    if (querSemNenhuma) {
      // "não tem nenhuma" ganha da escolha de valores específicos: pedir as duas
      // coisas na mesma caixa não quer dizer nada, e a leitura óbvia é a mais ampla.
      for (const id of await faceta.deQualquer()) excluir.add(id);
      continue;
    }
    if (!escolhidos.length) continue;

    const ids = await faceta.doValor();
    if (faceta.negar) for (const id of ids) excluir.add(id);
    else restricoes.push(ids);
  }

  // Set para a interseção: com dezenas de milhares de ids, o .includes() em array
  // vira O(n²) e a página trava antes de qualquer consulta sair.
  const incluir = restricoes.length
    ? restricoes.reduce((acc, cur) => {
        const s2 = new Set(cur);
        return acc.filter((id) => s2.has(id));
      })
    : null;

  return { incluir, excluir: Array.from(excluir) };
}

// Monta a consulta já com TODAS as condições aplicadas. Quem chama decide o `select`,
// a ordem e o limite — é a única diferença entre listar, contar e apagar.
//
// Devolve { query } EM VEZ da consulta direto: o builder do postgrest é "thenable", e
// devolvê-lo de uma função async faz o JavaScript executá-lo na hora (o await adota a
// promise). Resultado: a consulta saía do Promise.all da página e perdia o paralelismo,
// e o erro escapava do try. Embrulhado num objeto, quem chama decide QUANDO executar.
//
// `pre` existe para a peneira do e-mail: ela chama esta função uma vez POR PÁGINA da
// varredura, e sem isso as facetas (tag/produto/cadência) seriam reconsultadas em
// todas — dezenas de idas ao banco para chegar sempre ao mesmo conjunto.
export async function consultaContatos(
  supabase: any,
  filtro: FiltroContatos,
  ctx: Contexto,
  opts: { select: string; count?: "exact"; head?: boolean; limit?: number; ordenar?: boolean },
  pre?: Preparo
): Promise<{ query: any }> {
  const f = normalizarFiltro(filtro);

  // ============================================================
  // A GUARDA: filtro que esta função NÃO sabe aplicar vira ERRO, não consulta ampla.
  //
  // "bate com o nome" só existe em JavaScript. Se alguém chamar consultaContatos com
  // ele e a condição simplesmente não entrar, a consulta devolve TODO MUNDO — e como
  // este mesmo código alimenta a exclusão em massa, o operador apagaria a base achando
  // que estava recortando os endereços bons. É a lição do CNAE que virava "o estado
  // inteiro". Quem precisa desse filtro chama varrerContatos()/contarContatos().
  // ============================================================
  const preparo = pre || (await prepararFiltro(supabase, f));
  if (precisaPeneira(f)) {
    throw new Error(
      "O filtro de e-mail (bate/caixa/outro) precisa da peneira: use varrerContatos() ou contarContatos() em vez de consultaContatos()."
    );
  }
  if (listasGrandes(preparo)) {
    throw new Error(
      "As listas de ids deste filtro não cabem numa URL: use varrerContatos() ou contarContatos(), que aplicam a restrição em memória."
    );
  }

  const { idsFacetas, idsExcluidos, emCadencia } = preparo;

  let q = supabase
    .from("contacts")
    .select(opts.select, opts.count ? { count: opts.count, head: !!opts.head } : undefined);

  if (opts.ordenar !== false) {
    q = q.order("score", { ascending: false }).order("created_at", { ascending: false });
  }
  if (opts.limit) q = q.limit(opts.limit);

  // um id impossível quando a interseção deu vazia: "nenhum" e não "todos"
  if (idsFacetas) q = q.in("id", idsFacetas.length ? idsFacetas : [NENHUM]);
  // filtro negativo: fora quem tem o vínculo que se pediu para NÃO ter
  if (idsExcluidos.length) q = q.not("id", "in", `(${idsExcluidos.join(",")})`);
  // tenant explícito quando o chamador souber: a RLS já isola, mas este módulo é a
  // fonte de uma EXCLUSÃO — se um dia alguém passar aqui o client de service role
  // (como os crons fazem), sem esta linha a consulta atravessaria workspaces.
  if (ctx.tenantId) q = q.eq("tenant_id", ctx.tenantId);
  if (!ctx.gerente) q = q.eq("assigned_to", ctx.userId ?? "");

  // ============================================================
  // FILTRO POR RESPONSÁVEL
  //
  // A coluna `assigned_to` sempre existiu, aparece na lista e dá para atribuir em
  // lote — só não dava para FILTRAR por ela, que é justamente o que se quer fazer
  // antes de agir sobre um conjunto ("os meus", "os do fulano", "os sem dono").
  //
  // `SEM_DONO` vira `is null`, e por isso não pode entrar num `.in()` junto com os
  // uuids: `in("assigned_to", [null])` não casa com NULL no Postgres. Quando os dois
  // são pedidos juntos, o jeito certo é um `or` com as duas condições.
  // ============================================================
  const resp = f.responsavel || [];
  if (resp.length) {
    const donos = resp.filter((x) => x !== SEM_DONO);
    const querSemDono = resp.includes(SEM_DONO);
    if (querSemDono && donos.length) {
      q = q.or(`assigned_to.is.null,assigned_to.in.(${donos.join(",")})`);
    } else if (querSemDono) {
      q = q.is("assigned_to", null);
    } else {
      q = q.in("assigned_to", donos);
    }
  }

  // ---- veredito do e-mail: o que o banco resolve sozinho ----
  const vereditos = f.email || [];
  if (vereditos.includes(EMAIL_INVALIDO)) q = q.in("id", [NENHUM]);
  else if (vereditos.length === 1 && vereditos[0] === "sem") q = q.or("email.is.null,email.eq.");

  const qSafe = buscaEfetiva(f.q);
  if (qSafe) q = q.or(`name.ilike.%${qSafe}%,email.ilike.%${qSafe}%,company.ilike.%${qSafe}%`);

  // ---- visões rápidas ----
  if (f.view === "completar") {
    q = q.or("email.is.null,email.eq.").or("phone.is.null,phone.eq.");
  } else if (f.view === "quentes") {
    q = q.gte("score", HOT_THRESHOLD);
  } else if (f.view === "com_wa") {
    q = q.eq("wa_status", "valid");
  } else if (f.view === "sem_wa") {
    // FILA DE REVISÃO: número verificado e sem conta de WhatsApp. Não é "falta dado" —
    // o telefone está lá; o que falta é OUTRO número, e é isso que se vem fazer aqui.
    q = q.eq("wa_status", "invalid");
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

// ============================================================
// A PENEIRA — filtrar por algo que o banco não sabe julgar
//
// "bate com o nome" compara o começo do endereço com o nome da pessoa, sem acento e
// aceitando abreviação (jsilva, joaos). Isso é uma função JavaScript; não há coluna
// nem índice equivalentes no Postgres, e reescrevê-la em SQL criaria uma segunda
// opinião que um dia diverge da primeira — justo no ponto em que a lista diria "bate"
// e o filtro "bate" não traria a linha.
//
// Então a varredura é honesta e explícita:
//   1. lê o conjunto do filtro em páginas de 1.000, em ordem ESTÁVEL (por id — sem
//      ordem estável o `range` do Postgres repete e PULA linhas);
//   2. julga cada endereço em JS, guardando só id/score/created_at (leve: 60 mil
//      contatos cabem sem susto);
//   3. ordena como a tela ordena e busca as linhas completas só da fatia pedida.
//
// O TOTAL sai de graça no passo 2 — e é o que impede a queixa clássica: filtrar,
// ver 200 e concluir que a base tem 200. Quando a varredura bate no teto, quem chama
// recebe `truncado` e a tela DIZ isso, em vez de mostrar um número menor calado.
//
// CUSTO: uma varredura completa da base filtrada por carregamento (22 mil contatos ≈
// 22 idas ao banco, alguns segundos). É o preço de um filtro exato; por isso ele só
// roda quando o operador escolhe um veredito.
// ============================================================
const PAGINA_PENEIRA = 1000;
const TETO_PENEIRA = 60000;

type Acerto = { id: string; score: number | null; created_at: string | null };

async function peneirar(
  supabase: any,
  f: FiltroContatos,
  ctx: Contexto,
  pre: Preparo
): Promise<{ acertos: Acerto[]; examinados: number; truncado: boolean }> {
  const alvos = new Set(f.email || []);
  const julgaEmail = alvos.size > 0;
  // com "sem e-mail" na seleção, quem não tem endereço PRECISA entrar na varredura —
  // podar esses seria justamente esconder o que foi pedido
  const querSemEmail = alvos.has("sem");

  // O que não coube na URL vira conjunto em memória. O que couber continua no banco —
  // filtrar lá é sempre melhor, porque encurta a varredura.
  const facetasGrandes = (pre.idsFacetas?.length ?? 0) > TETO_IDS_NA_URL;
  const cadenciaGrande = pre.emCadencia.length > TETO_IDS_NA_URL;
  const excluidosGrandes = pre.idsExcluidos.length > TETO_IDS_NA_URL;
  const incluir = facetasGrandes ? new Set(pre.idsFacetas as string[]) : null;
  const excluir = cadenciaGrande || excluidosGrandes
    ? new Set([...(cadenciaGrande ? pre.emCadencia : []), ...(excluidosGrandes ? pre.idsExcluidos : [])])
    : null;
  const paraOBanco: Preparo = {
    idsFacetas: facetasGrandes ? null : pre.idsFacetas,
    idsExcluidos: excluidosGrandes ? [] : pre.idsExcluidos,
    emCadencia: cadenciaGrande ? [] : pre.emCadencia,
  };

  const acertos: Acerto[] = [];
  let examinados = 0;
  let truncado = false;

  for (let inicio = 0; inicio < TETO_PENEIRA; inicio += PAGINA_PENEIRA) {
    // `email: ""` + listas neutralizadas desarmam a guarda: aqui a peneira é
    // exatamente o que está sendo feito, e é feita logo abaixo.
    const { query } = await consultaContatos(
      supabase,
      { ...f, email: [] },
      ctx,
      { select: "id, name, email, score, created_at", ordenar: false },
      paraOBanco
    );
    let q = query;
    // quem não tem e-mail nunca vira "bate"/"caixa"/"outro" — tirar do caminho
    // encurta a varredura sem mudar o resultado. Só que essa poda vale SÓ para o
    // veredito: numa peneira que existe por causa do tamanho das listas, cortar quem
    // não tem e-mail esconderia contato legítimo.
    if (julgaEmail && !querSemEmail) q = q.not("email", "is", null).neq("email", "");
    const { data, error } = await q
      .order("id", { ascending: true })
      .range(inicio, inicio + PAGINA_PENEIRA - 1);
    if (error) throw error;

    const linhas = ((data as any[]) || []);
    examinados += linhas.length;
    for (const c of linhas) {
      if (incluir && !incluir.has(c.id)) continue;
      if (excluir && excluir.has(c.id)) continue;
      if (julgaEmail && !alvos.has(vereditoEmail(c.email, c.name))) continue;
      acertos.push({ id: c.id, score: c.score ?? null, created_at: c.created_at ?? null });
    }
    if (linhas.length < PAGINA_PENEIRA) break;
    if (inicio + PAGINA_PENEIRA >= TETO_PENEIRA) truncado = true;
  }

  return { acertos, examinados, truncado };
}

// Busca as linhas completas de uma lista de ids, em fatias de 200 (1.000 uuids numa
// URL do PostgREST passam de 37 KB e o servidor recusa — já medido na exclusão).
// Devolve NA ORDEM dos ids recebidos.
async function linhasPorIds(supabase: any, ctx: Contexto, select: string, ids: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    let q = supabase.from("contacts").select(select).in("id", ids.slice(i, i + 200));
    if (ctx.tenantId) q = q.eq("tenant_id", ctx.tenantId);
    if (!ctx.gerente) q = q.eq("assigned_to", ctx.userId ?? "");
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data as any[]) || []));
  }
  const pos = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
}

export type Varredura = { linhas: any[]; total: number | null; examinados: number; truncado: boolean };

// A porta de entrada para "me dá N contatos que batem com o filtro". Sem veredito de
// e-mail é a consulta de sempre (uma ida ao banco); com veredito, passa pela peneira.
// Quem chama não precisa saber a diferença — só ler `total`/`truncado` quando quiser
// mostrar o tamanho real do conjunto.
export async function varrerContatos(
  supabase: any,
  filtro: FiltroContatos,
  ctx: Contexto,
  opts: { select: string; quantidade: number; ordenar?: boolean }
): Promise<Varredura> {
  const f = normalizarFiltro(filtro);
  const pre = await prepararFiltro(supabase, f);

  // caminho normal: o banco dá conta de tudo numa consulta só
  if (!precisaPeneira(f) && !listasGrandes(pre)) {
    const { query } = await consultaContatos(
      supabase, f, ctx,
      { select: opts.select, limit: opts.quantidade, ordenar: opts.ordenar },
      pre
    );
    const { data, error } = await query;
    if (error) throw error;
    const linhas = ((data as any[]) || []);
    return { linhas, total: null, examinados: linhas.length, truncado: false };
  }

  const { acertos, examinados, truncado } = await peneirar(supabase, f, ctx, pre);

  if (opts.ordenar !== false) {
    // a MESMA ordem da consulta normal: score desc, depois mais novo primeiro
    acertos.sort(
      (a, b) =>
        (Number(b.score) || 0) - (Number(a.score) || 0) ||
        String(b.created_at || "").localeCompare(String(a.created_at || ""))
    );
  }

  const ids = acertos.slice(0, Math.max(0, opts.quantidade)).map((a) => a.id);
  const linhas = ids.length ? await linhasPorIds(supabase, ctx, opts.select, ids) : [];
  return { linhas, total: acertos.length, examinados, truncado };
}

// Quantos batem com o filtro DE VERDADE. `aproximado` só fica true quando a varredura
// bateu no teto — e aí quem mostra o número precisa dizer "pelo menos".
export async function contarContatos(
  supabase: any,
  filtro: FiltroContatos,
  ctx: Contexto
): Promise<{ total: number; aproximado: boolean }> {
  const f = normalizarFiltro(filtro);
  const pre = await prepararFiltro(supabase, f);

  if (!precisaPeneira(f) && !listasGrandes(pre)) {
    const { query } = await consultaContatos(
      supabase, f, ctx,
      { select: "id", count: "exact", head: true, ordenar: false },
      pre
    );
    const { count, error } = await query;
    if (error) throw error;
    return { total: count ?? 0, aproximado: false };
  }

  const { acertos, truncado } = await peneirar(supabase, f, ctx, pre);
  return { total: acertos.length, aproximado: truncado };
}
