"use server";

import { msgErro } from "@/lib/erros";
import { chaveCnpj } from "@/lib/cnpjFormato";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canCreate, mensagemLimite } from "@/lib/plan";
import { buscarAtividades, buscarEmpresas, buscarEmpresaPorCnpj, receitaConfigurada, type FiltroReceita } from "@/lib/receita";
import { nomeProprio, enrichCnpj } from "@/lib/cnpj";
import { dominioCorporativo } from "@/lib/emailFinder";
import { logAction } from "@/lib/actionLog";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

// CNPJ alfanumérico (jul/2026): esta função só é usada para CNPJ, e antes era
// `replace(/\D/g,"")` — que apagava as letras. A base da Receita no VPS ainda só tem
// CNPJ numérico, mas as EMPRESAS do workspace já podem ter um alfanumérico vindo de
// importação; com o corte antigo, a comparação "esta empresa já existe?" comparava
// coisas diferentes e o Radar reofertava quem você já tinha.
const soDigitos = (s: string | null | undefined) => chaveCnpj(s);

// ============================================================
// A CAUSA DO "CONTABILIDADE TROUXE CULTIVO DE ARROZ"
//
// `soDigitos` acima virou um apelido de `chaveCnpj`, que devolve "" para tudo que
// não seja um CNPJ completo de 14 caracteres. Correto para CNPJ — é o que ela existe
// para fazer. Só que o filtro de CNAE usava a MESMA função:
//
//     input.cnae.map(soDigitos).filter((c) => /^\d{7}$/.test(c))
//
// `soDigitos("6920601")` → "". Todos os códigos viravam string vazia, o filter
// zerava a lista, e a busca ia para a base SEM filtro de atividade — devolvendo o
// que houvesse no estado, em ordem de CNAE: arroz, milho, soja.
//
// E como o CNAE nunca contava como filtro, a regra "informe ao menos um filtro" só
// era satisfeita escolhendo um estado. Era o mesmo defeito produzindo as duas
// queixas: "traz tudo errado" e "exige estado junto com a atividade".
//
// A armadilha é o NOME. `soDigitos` parece "tira o que não é dígito" — e era isso
// mesmo, até ser reescrita para tratar CNPJ alfanumérico. Quem a chamava para CNAE
// não tinha como perceber: nenhum erro, nenhum aviso, só um resultado mais amplo.
//
// CNAE tem função própria agora, e as duas nunca mais se misturam.
// ============================================================
const soNumeros = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

// ============================================================
// TAMANHO DA PÁGINA E TETO DA CONTAGEM
//
// PAGINA: quantas empresas vêm por clique. Era 100 e ficou pequeno para trabalhar uma
// lista. A API aceita até 500; 250 é o meio-termo — menos cliques, sem transformar
// cada busca num pacote gordo (a tela renderiza tudo de uma vez).
//
// TETO_BASE: o servidor da base conta com teto, parando nas 100 mil primeiras linhas
// (é o que faz a contagem custar milissegundos em vez de mais de um minuto). Quando o
// total volta batendo exatamente nesse número, ele NÃO é o total — é o teto. A tela
// escreve "mais de 100.000" nesse caso, em vez de cravar um número que é mentira.
//
// Se um dia o teto do servidor mudar, este número tem de acompanhar.
// ============================================================
const PAGINA = 250;
const TETO_BASE = 100_000;

// Quantas empresas o "Exportar todos" entrega por vez. Acima disso o CSV vira arquivo
// de trabalho de outra natureza — e a tela avisa que cortou, dizendo de quanto era.
const TETO_EXPORT = 5_000;
const normNome = (s: string | null | undefined) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// ============================================================
// A BASE DA RECEITA NÃO TEM ACENTO
//
// Buscar município "são paulo" devolvia ZERO. O dump da Receita grava tudo sem
// acento e sem cedilha: "SAO PAULO", "AGUA BRANCA", "EPITACIOLANDIA",
// "SAMPAIO SERVICOS CONTABEIS". O filtro é `municipio ILIKE '%…%'`, e ILIKE ignora
// maiúscula/minúscula mas NÃO ignora acento — "são" nunca casa com "SAO".
//
// Então tiramos o acento de tudo que vira texto de busca (município e nome). Digitar
// certo, em português, tem de funcionar; quem tem de se adaptar é o código.
//
// NFD separa a letra do acento e o replace joga o acento fora. Vale para ç também:
// "ç" decomposto é "c" + cedilha, então "serviços" vira "servicos" — que é como a
// Receita gravou.
// ============================================================
const semAcento = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");

// Sócio pessoa jurídica não tem "e-mail do decisor" descoberto por nome: pula a fila
// SMTP para não gastar conversa à toa (razão social com LTDA/S.A/EIRELI, dígitos, etc.).
function pareceEmpresa(nome: string): boolean {
  const n = normNome(nome);
  if (!n) return true;
  if (/\d/.test(n)) return true;
  return /\b(ltda|s\/a|s a|sa|eireli|mei|epp|me|cia|s\.a|associacao|instituto|fundacao|igreja|condominio|municipio|prefeitura|ltda\.)\b/.test(n);
}

// Aceita string ("SP"), array (["SP","RJ"]) ou lista por vírgula, e devolve limpo.
function listaValida(v: any, valida: (s: string) => boolean, transforma: (s: string) => string = (s) => s): string[] {
  const bruto = Array.isArray(v) ? v : String(v ?? "").split(",");
  const out: string[] = [];
  for (const item of bruto) {
    const s = transforma(String(item ?? "").trim());
    if (s && valida(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

// ============================================================
// FILTRO QUE SOME EM SILÊNCIO — o bug do "contabilidade trouxe cultivo de arroz"
//
// A tela manda `cnae: [...]` com os códigos das atividades escolhidas. Se um código
// chegar vazio ou fora do formato — foi o que aconteceu: a lista de atividades veio
// com o código sob outro nome de campo, então cada item virou `undefined` —, a
// validação abaixo descartava TODOS e devolvia `cnae: undefined`. A busca então
// rodava sem filtro de atividade nenhum e trazia o que houvesse no estado: arroz,
// milho, soja, em ordem de código.
//
// Pior: como a atividade não valia como filtro, a única coisa capaz de satisfazer a
// regra "informe ao menos um filtro" era escolher um estado. Daí a impressão de que
// o Radar "exige estado junto com a atividade". Era este mesmo bug, de outro ângulo.
//
// REGRA NOVA: filtro que o operador pediu e que não sobreviveu à validação vira
// ERRO — nunca uma busca mais ampla. Mesma lição do apagar em lote que "funcionava"
// apagando zero linhas: falhar calado é pior do que falhar.
// ============================================================
function cnaePerdido(input: any): boolean {
  const pedidos = Array.isArray(input?.cnae) ? input.cnae : [];
  if (!pedidos.length) return false;
  return pedidos.map(soNumeros).filter((c: string) => /^\d{7}$/.test(c)).length === 0;
}

const ERRO_CNAE_PERDIDO =
  "As atividades escolhidas vieram sem código válido, então o filtro não foi aplicado — " +
  "eu preferi parar a te devolver a base inteira. Tire e escolha de novo na lista; " +
  "se insistir, digite o CNAE no campo ao lado.";

// Monta o filtro da API a partir do que a tela envia (validação básica).
// UF e porte aceitam VÁRIOS valores: mandamos a lista (`ufs`/`portes`, v3 da API) e
// também o primeiro valor no campo antigo (`uf`/`porte`), para a v2 não quebrar.
function montarFiltro(input: any): FiltroReceita {
  const cnae = Array.isArray(input?.cnae) ? input.cnae.map(soNumeros).filter((c: string) => /^\d{7}$/.test(c)) : [];
  const ufs = listaValida(input?.ufs ?? input?.uf, (s) => /^[A-Z]{2}$/.test(s), (s) => s.toUpperCase()).slice(0, 27);
  const portes = listaValida(input?.portes ?? input?.porte, (s) => ["ME", "EPP", "Demais"].includes(s)).slice(0, 3);
  return {
    // atividade é texto casado contra a tabela `cnaes`, que TEM acento — não mexer.
    atividade: typeof input?.atividade === "string" && input.atividade.trim().length >= 3 ? input.atividade.trim() : undefined,
    cnae: cnae.length ? cnae : undefined,
    uf: ufs[0],
    ufs: ufs.length > 1 ? ufs : undefined,
    // município e nome são casados contra `estabelecimentos`, que NÃO tem acento.
    municipio: typeof input?.municipio === "string" && input.municipio.trim() ? semAcento(input.municipio.trim()) : undefined,
    porte: portes[0] as FiltroReceita["porte"],
    portes: portes.length > 1 ? portes : undefined,
    com_email: input?.com_email === true,
    email_corporativo: input?.email_corporativo === true,
    com_telefone: input?.com_telefone === true,
  };
}

// ============================================================
// MOSTRAR O FILTRO QUE DE FATO VALEU
//
// Uma busca por "contabilidade" devolveu cultivo de arroz e eu passei horas
// alternando entre duas hipóteses — o app mandou errado, ou a base entendeu errado —
// sem conseguir provar nenhuma. O motivo é que a tela mostrava o formulário (o que
// você QUERIA) e a lista (o que VEIO), e nada entre os dois.
//
// Esta frase é o que faltava: ela é montada no servidor, a partir do filtro que
// realmente foi para a base, e aparece junto do total. Se um dia um filtro sumir de
// novo, a tela diz na hora — em vez de parecer que a base enlouqueceu.
// ============================================================
function descreverFiltro(f: FiltroReceita, busca?: string): string {
  const p: string[] = [];
  if (f.cnae?.length) p.push(`CNAE ${f.cnae.join(", ")}`);
  else if (f.atividade) p.push(`atividade "${f.atividade}"`);
  const nome = (busca || "").trim() || f.termo;
  if (nome) p.push(`nome contém "${nome}"`);
  if (f.ufs?.length) p.push(f.ufs.join("+"));
  else if (f.uf) p.push(f.uf);
  if (f.municipio) p.push(f.municipio);
  if (f.portes?.length) p.push(`porte ${f.portes.join("+")}`);
  else if (f.porte) p.push(`porte ${f.porte}`);
  if (f.email_corporativo) p.push("e-mail empresarial");
  else if (f.com_email) p.push("com e-mail");
  if (f.com_telefone) p.push("com telefone");
  return p.length ? p.join(" · ") : "sem filtro nenhum";
}

// marca cada resultado com jaTem=true se o CNPJ já estiver em Empresas (evita repuxar)
// e REMOVE os CNPJs descartados (radar_dismissed) — some das buscas de vez.
async function marcarJaTem(rows: any[]): Promise<any[]> {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return rows;
  const cnpjs = Array.from(new Set(rows.map((r) => soDigitos(r.cnpj)).filter((d) => d.length === 14)));
  const tem = new Set<string>();
  const desc = new Set<string>();
  for (let i = 0; i < cnpjs.length; i += 500) {
    const slice = cnpjs.slice(i, i + 500);
    const [{ data: accs }, { data: dis }] = await Promise.all([
      supabase.from("accounts").select("cnpj").eq("tenant_id", tenant_id).in("cnpj", slice),
      supabase.from("radar_dismissed").select("cnpj").eq("tenant_id", tenant_id).in("cnpj", slice),
    ]);
    for (const a of (accs as any[]) || []) if (a.cnpj) tem.add(soDigitos(a.cnpj));
    for (const d of (dis as any[]) || []) if (d.cnpj) desc.add(soDigitos(d.cnpj));
  }
  // Marca (não remove): já cadastrados E descartados aparecem em CINZA, iguais.
  return rows.map((r) => ({
    ...r,
    jaTem: tem.has(soDigitos(r.cnpj)),
    descartado: desc.has(soDigitos(r.cnpj)),
  }));
}

// Descarta CNPJs do Radar: sacode-os das buscas (sem virar contato/empresa).
export async function descartarCnpjs(cnpjs: string[]) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const limpos = Array.from(new Set((cnpjs || []).map(soDigitos).filter((d) => d.length === 14)));
  if (!limpos.length) return { error: "Nenhum CNPJ válido para descartar." };
  const rows = limpos.map((cnpj) => ({ tenant_id, cnpj }));
  const { error } = await supabase
    .from("radar_dismissed")
    .upsert(rows, { onConflict: "tenant_id,cnpj", ignoreDuplicates: true });
  if (error) return { error: msgErro(error) };
  return { ok: true, count: limpos.length };
}

// Desfaz o descarte: os CNPJs voltam a aparecer normalmente nas buscas.
export async function reincluirCnpjs(cnpjs: string[]) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const limpos = Array.from(new Set((cnpjs || []).map(soDigitos).filter((d) => d.length === 14)));
  if (!limpos.length) return { error: "Nenhum CNPJ válido." };
  const { error } = await supabase.from("radar_dismissed").delete().eq("tenant_id", tenant_id).in("cnpj", limpos);
  if (error) return { error: msgErro(error) };
  return { ok: true, count: limpos.length };
}

// garante a tag "Radar" e devolve o id (marca as empresas que vieram do Radar)
async function tagRadarId(supabase: any, tenant_id: string): Promise<string | null> {
  const { data: t } = await supabase.from("tags").select("id").eq("tenant_id", tenant_id).ilike("name", "Radar").maybeSingle();
  if (t) return (t as any).id;
  const { data: c } = await supabase.from("tags").insert({ tenant_id, name: "Radar", color: "#4A3AFF" }).select("id").maybeSingle();
  return (c as any)?.id || null;
}

// ============================================================
// Autocomplete de atividade (campo principal da busca).
// ============================================================
export async function atividadesReceita(q: string) {
  const { tenant_id } = await ctx();
  if (!tenant_id) return { atividades: [], error: "Sem workspace." };
  return await buscarAtividades(q);
}

// ============================================================
// Busca na base — devolve uma página de resultados + total.
// A tela mostra os resultados com checkbox; a ação em lote é o envio.
// ============================================================
// Contagem sob demanda: uma chamada só para o total, com orçamento próprio de tempo.
// Fica separada do resultado de propósito — assim a lista aparece rápido e o número,
// que é caro, só é pago por quem realmente quer.
export async function contarNaBase(input: any) {
  const { tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!receitaConfigurada()) return { error: "Base da Receita não configurada." };
  if (cnaePerdido(input)) return { error: ERRO_CNAE_PERDIDO };
  const f = montarFiltro(input);
  if (!f.atividade && !f.cnae && !f.uf && !f.termo) return { error: "Escolha um filtro antes de contar." };
  // limit 1: não queremos linhas, só o total. 50s de teto (a rota tem 60).
  const r = await buscarEmpresas({ ...f, limit: 1, offset: 0, contar: true }, 50_000);
  if (r.error) return { error: r.error };
  if (typeof r.total !== "number") return { error: "A base não devolveu o total." };
  return { ok: true, total: r.total };
}

export async function buscarNaBase(input: any, offset = 0) {
  const { tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!receitaConfigurada()) return { error: "Base da Receita não configurada (defina RECEITA_API_URL e RECEITA_API_TOKEN)." };

  if (cnaePerdido(input)) return { error: ERRO_CNAE_PERDIDO };
  const f = montarFiltro(input);
  // "ocultar as empresas que já estão no meu cadastro" (dedup por CNPJ contra Empresas)
  const ocultar = input?.ocultarJaTem === true;

  // Busca por NOME ou CNPJ (razão social / nome fantasia / CNPJ).
  const busca = typeof input?.busca === "string" ? input.busca.trim() : "";
  const digitos = busca.replace(/\D/g, "");
  if (digitos.length === 14) {
    // CNPJ completo → busca exata (traz mesmo se não tiver e-mail)
    const r = await buscarEmpresaPorCnpj(digitos);
    if (r.error) return { error: r.error };
    let rows = await marcarJaTem(r.empresa ? [r.empresa] : []);
    if (ocultar) rows = rows.filter((x) => !x.jaTem);
    return { ok: true, total: rows.length, atividades: [], rows, offset: 0, nextOffset: 0, temMais: false, aplicado: `CNPJ ${digitos}` };
  }
  if (busca.length >= 3) {
    // texto → procura em razão social + nome fantasia. RESPEITA os checkboxes de
    // e-mail marcados na tela (com_email / email_corporativo vêm de montarFiltro):
    // se o usuário pediu "só e-mail empresarial", o termo NÃO deve furar esse filtro.
    f.termo = semAcento(busca);
  }

  if (!f.atividade && !f.cnae && !f.uf && !f.termo) {
    return { error: "Escolha uma atividade/UF, ou digite um nome ou CNPJ para buscar." };
  }
  const off = Math.max(Number(offset) || 0, 0);
  // Marcou vários estados/portes mas a API do VPS ainda é a v2? Então só o primeiro
  // valor entrou no filtro — a tela avisa em vez de mentir um resultado "completo".
  const pediuMulti = (f.ufs?.length || 0) > 1 || (f.portes?.length || 0) > 1;

  // ============================================================
  // A CONTAGEM DEIXOU DE SER CARA — e por isso voltou
  //
  // Havia uma regra aqui que PULAVA a contagem em busca ampla, e a tela dizia
  // "muitos resultados" em vez do número. Fazia sentido quando contar custava 1min13s
  // e derrubava a busca junto. Não faz mais.
  //
  // Duas coisas mudaram no servidor da base:
  //   1. a contagem passou a ter TETO (para nas 100 mil primeiras linhas);
  //   2. o filtro voltou a usar o índice — a comparação convertia a coluna para text
  //      e desligava o índice sem ninguém perceber (`ANY($1)` → `ANY($1::bpchar[])`).
  //
  // Medido na base real depois das duas: contabilidade no Brasil inteiro, com
  // contagem, em menos de 1s frio e 0,067s quente. O motivo de esconder o total
  // acabou, então o total volta — sempre.
  // ============================================================
  // Caminho normal (sem ocultar): uma página direto da base, já com o total.
  if (!ocultar) {
    const r = await buscarEmpresas({ ...f, limit: PAGINA, offset: off, contar: off === 0 });
    if (r.error) return { error: r.error };
    const rows = await marcarJaTem(r.rows);
    return {
      ok: true, total: r.total, atividades: r.atividades, rows, offset: off,
      nextOffset: off + r.rows.length, temMais: r.rows.length === PAGINA,
      totalNoTeto: r.total !== null && r.total >= TETO_BASE,
      pagina: PAGINA, tetoExport: TETO_EXPORT,
      avisoMulti: pediuMulti && !r.multi ? avisoApiAntiga(f) : undefined,
      aplicado: descreverFiltro(f, busca),
    };
  }

  // Ocultar já cadastradas: a base não sabe do seu cadastro, então filtramos aqui.
  // Como isso "fura" a página (250 podem virar 160), buscamos páginas seguidas até
  // juntar uma página cheia de NOVAS ou acabar a base (teto de 6 idas por clique). O
  // offset é sempre o BRUTO consumido da base (nextOffset), para "carregar mais" não
  // repetir.
  let cursor = off;
  let total: number | null = null;
  let atividades: any[] = [];
  const acumulado: any[] = [];
  let temMais = false;
  let multiOk = true;
  for (let i = 0; i < 6; i++) {
    const contar = off === 0 && i === 0;
    const r = await buscarEmpresas({ ...f, limit: PAGINA, offset: cursor, contar });
    if (r.error) return { error: r.error };
    if (contar) { total = r.total; atividades = r.atividades || []; }
    if (!r.multi) multiOk = false;
    const marc = await marcarJaTem(r.rows);
    for (const x of marc) if (!x.jaTem) acumulado.push(x);
    cursor += r.rows.length;
    if (r.rows.length < PAGINA) { temMais = false; break; } // fim da base
    temMais = true;
    if (acumulado.length >= PAGINA) break; // já juntamos uma página cheia de novas
  }
  return {
    ok: true, total, atividades, rows: acumulado, offset: off, nextOffset: cursor, temMais,
    totalNoTeto: total !== null && total >= TETO_BASE,
    pagina: PAGINA, tetoExport: TETO_EXPORT,
    avisoMulti: pediuMulti && !multiOk ? avisoApiAntiga(f) : undefined,
    aplicado: descreverFiltro(f, busca),
  };
}

// Mensagem única do aviso de API antiga (usada nos dois caminhos da busca).
function avisoApiAntiga(f: FiltroReceita): string {
  const partes: string[] = [];
  if ((f.ufs?.length || 0) > 1) partes.push(`estados (só ${f.uf} entrou)`);
  if ((f.portes?.length || 0) > 1) partes.push(`portes (só ${f.porte} entrou)`);
  return `A API da Receita no seu VPS ainda é a v2: ela aceita um valor por filtro, então vários ${partes.join(" e ")}. Rode o script da API v3 no servidor para liberar a seleção múltipla.`;
}

// ============================================================
// EXPORTAR TODOS os resultados de uma busca (não só a página carregada). Puxa
// várias páginas da base até um TETO (anti-abuso e anti-timeout) e devolve as
// linhas para o cliente montar o CSV. Espelha a tela: exclui descartados e, se o
// usuário marcou "ocultar já cadastradas", exclui as que já estão na base.
// ============================================================
export async function exportarRadar(input: any): Promise<{ rows?: any[]; total?: number | null; capped?: boolean; teto?: number; error?: string }> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!receitaConfigurada()) return { error: "Base da Receita não configurada." };

  if (cnaePerdido(input)) return { error: ERRO_CNAE_PERDIDO };
  const f = montarFiltro(input);
  const busca = typeof input?.busca === "string" ? input.busca.trim() : "";
  const digitos = busca.replace(/\D/g, "");
  const acc: any[] = [];
  const vistos = new Set<string>();
  let total: number | null = null;
  let capped = false;

  if (digitos.length === 14) {
    const r = await buscarEmpresaPorCnpj(digitos);
    if (r.error) return { error: r.error };
    if (r.empresa) { acc.push(r.empresa); vistos.add(soDigitos(r.empresa.cnpj)); }
    total = acc.length;
  } else {
    if (busca.length >= 3) f.termo = semAcento(busca);
    // ============================================================
    // POR QUE VINHAM 4.999 E NÃO 5.000
    //
    // O laço antigo dava um número FIXO de idas à base (20 × 250) e exportava o que
    // sobrasse. Só que a cada ida os CNPJs repetidos são descartados — e repetição
    // acontece: a base pagina por `limit/offset` sem `order by`, então o Postgres não
    // garante a mesma ordem entre uma página e a seguinte. Uma linha repetida na
    // fronteira de duas páginas e o resultado fecha em 4.999.
    //
    // Agora o laço persegue o NÚMERO, não a quantidade de idas: busca até juntar 5.000
    // distintos ou a base acabar. Sai redondo.
    //
    // MAX_IDAS é só freio de segurança — 40 idas dariam 10.000 linhas brutas, o dobro
    // do teto. Se ele for atingido é porque há repetição demais, e aí o CSV sai com
    // menos: prefiro entregar menos do que rodar sem fim.
    // ============================================================
    const MAX_IDAS = 40;
    let offset = 0;
    for (let i = 0; i < MAX_IDAS && acc.length < TETO_EXPORT; i++) {
      const r = await buscarEmpresas({ ...f, limit: PAGINA, offset, contar: i === 0 });
      if (r.error) return { error: r.error };
      if (i === 0) total = r.total;
      const pagina = r.rows || [];
      for (const e of pagina) { const d = soDigitos(e.cnpj); if (d && !vistos.has(d)) { vistos.add(d); acc.push(e); } }
      offset += pagina.length;
      if (pagina.length < PAGINA) break;                // fim da base
    }
    if (acc.length > TETO_EXPORT) acc.length = TETO_EXPORT;
    // "Cortou" só é verdade se REALMENTE sobrou coisa lá. Uma busca com exatamente
    // 5.000 empresas enche o teto sem deixar nada para trás — dizer "refine para pegar
    // o restante" nesse caso seria mandar o operador procurar o que não existe.
    capped = acc.length >= TETO_EXPORT && (total === null || total > TETO_EXPORT);
  }

  // exclui descartados (sempre) e já-cadastradas (se pediu no filtro)
  const cnpjs = acc.map((e) => soDigitos(e.cnpj)).filter((d) => d.length === 14);
  const remover = new Set<string>();
  for (let i = 0; i < cnpjs.length; i += 500) {
    const slice = cnpjs.slice(i, i + 500);
    const [{ data: dis }, { data: accs }] = await Promise.all([
      supabase.from("radar_dismissed").select("cnpj").eq("tenant_id", tenant_id).in("cnpj", slice),
      input?.ocultarJaTem === true
        ? supabase.from("accounts").select("cnpj").eq("tenant_id", tenant_id).in("cnpj", slice)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    for (const d of (dis as any[]) || []) if (d.cnpj) remover.add(soDigitos(d.cnpj));
    for (const a of (accs as any[]) || []) if (a.cnpj) remover.add(soDigitos(a.cnpj));
  }
  const rows = acc.filter((e) => !remover.has(soDigitos(e.cnpj)));
  // `teto` vai junto para a tela escrever o número certo. Antes ela tinha "2.000"
  // escrito à mão e continuou dizendo isso quando o teto já era outro.
  return { rows, total, capped, teto: TETO_EXPORT };
}

// ============================================================
// Envia as empresas escolhidas para Empresas + Contatos, JÁ ENRIQUECIDAS.
// Como a busca já traz e-mail/telefone/CNAE/município da base, não precisa de
// nenhuma chamada externa: grava direto. Deduplica por CNPJ.
//
// No modo "empresa + contato" traz a EMPRESA e UM CONTATO POR SÓCIO (não mais um
// contato-fantasma com o nome da empresa): usa os sócios que a base já entrega na
// linha (e.socios) e, quando a linha não traz, enriquece por CNPJ (base + BrasilAPI)
// com teto de consultas externas por envio. Se ninguém for encontrado, cai no antigo
// (um contato com o nome da empresa) — nunca cria zero contato.
// ============================================================
export async function enviarParaCadastro(empresas: any[], modo: "empresa" | "empresa_contato" = "empresa") {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!Array.isArray(empresas) || !empresas.length) return { error: "Nenhuma empresa selecionada." };
  const criarContato = modo === "empresa_contato";

  // teto do plano só se apertar (só o modo "empresa + contato" cria contato).
  // Guardamos o orçamento restante: como agora um envio pode criar VÁRIOS contatos
  // (um por sócio), paramos de criar ao esgotar o limite em vez de estourar.
  let budgetContatos = Infinity;
  if (criarContato) {
    const lim = await canCreate("contatos");
    if (!lim.permitido) return { error: mensagemLimite("contatos", lim.usado, lim.limite, lim.sugerido) };
    if (lim.limite != null) budgetContatos = Math.max(0, lim.limite - lim.usado);
  }

  // 1) dedup: carrega o que já existe no workspace.
  //
  // ATENÇÃO ao detalhe que já mordeu: o PostgREST devolve no máximo ~1.000 linhas por
  // consulta. Ler "todos os contatos com CNPJ" numa base de 22 mil trazia só os 1.000
  // primeiros — e o dedup passava a deixar contato duplicado. Por isso o CNPJ é
  // consultado SÓ para os CNPJs desta seleção (dezenas/centenas), em fatias: exato,
  // independente do tamanho da base.
  const cnpjsSelecionados = Array.from(
    new Set(empresas.map((e: any) => soDigitos(e?.cnpj)).filter((d: string) => d.length === 14))
  );
  const emFatias = <T,>(arr: T[], n = 200): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  const contaPorCnpj = new Map<string, string>();
  const contaPorNome = new Map<string, string>();
  const contatoTemCnpj = new Set<string>();

  for (const fatia of emFatias(cnpjsSelecionados)) {
    const [{ data: accsCnpj }, { data: ctsCnpj }] = await Promise.all([
      supabase.from("accounts").select("id, name, cnpj").eq("tenant_id", tenant_id).in("cnpj", fatia),
      supabase.from("contacts").select("cnpj").eq("tenant_id", tenant_id).in("cnpj", fatia),
    ]);
    for (const a of (accsCnpj as any[]) || []) {
      const d = soDigitos(a.cnpj);
      if (d.length === 14) contaPorCnpj.set(d, a.id);
      const n = normNome(a.name);
      if (n && !contaPorNome.has(n)) contaPorNome.set(n, a.id);
    }
    for (const c of (ctsCnpj as any[]) || []) {
      const d = soDigitos(c.cnpj);
      if (d.length === 14) contatoTemCnpj.add(d);
    }
  }

  // dedup por NOME (empresa sem CNPJ cadastrado): consulta pelos nomes desta seleção.
  // Não é exato quando o nome está gravado com acento/caixa diferente — o CNPJ acima é
  // a trava confiável; esta é só uma segunda rede.
  const nomesSelecionados = Array.from(
    new Set(
      empresas
        .map((e: any) => nomeProprio((e?.nome_fantasia || e?.razao_social || "").trim()))
        .filter((n: any): n is string => !!n)
    )
  );
  for (const fatia of emFatias(nomesSelecionados)) {
    const { data: accsNome } = await supabase
      .from("accounts").select("id, name").eq("tenant_id", tenant_id).in("name", fatia);
    for (const a of (accsNome as any[]) || []) {
      const n = normNome(a.name);
      if (n && !contaPorNome.has(n)) contaPorNome.set(n, a.id);
    }
  }

  let empresasCriadas = 0;
  let contatosCriados = 0;
  let pulados = 0;
  let limiteAtingido = false;
  const vistos = new Set<string>();
  // ids do que ACABOU de ser criado — é isso que o passo a passo (Prospectar) usa
  // para rodar a descoberta de canais só no que entrou agora.
  const contatoIds: string[] = [];
  const contaIds: string[] = [];
  const nomesEmpresas: string[] = [];
  // fila de descoberta de e-mail (SMTP): cada contato com NOME de pessoa + domínio e
  // SEM e-mail vira um job. É o que dá e-mail próprio ao sócio na esteira do Radar.
  const filaEmail: { tenant_id: string; contact_id: string; name: string; domain: string }[] = [];
  const tagId = await tagRadarId(supabase, tenant_id); // marca as empresas como vindas do Radar
  const contasParaMarcar = new Set<string>();

  // Resolve os nomes dos sócios de uma empresa para virar contato:
  //  1) se a linha da busca já trouxe e.socios (base do VPS evoluída) → grátis;
  //  2) senão, enriquece por CNPJ (base + BrasilAPI) com TETO por envio, para não
  //     estourar limite/timeout das APIs públicas quando a seleção é grande.
  const MAX_ENRIQUECER = 30;
  let enriquecidos = 0;
  async function sociosDaEmpresa(e: any, cnpj: string): Promise<string[]> {
    const doRow = Array.isArray(e?.socios) ? e.socios : [];
    const limpos = doRow.map((s: any) => (nomeProprio(String(s || "")) || String(s || "")).trim()).filter(Boolean);
    if (limpos.length) return Array.from(new Set(limpos));
    if (!criarContato || enriquecidos >= MAX_ENRIQUECER) return [];
    enriquecidos++;
    try {
      const r = await enrichCnpj(cnpj);
      const nomes = (r.data?.socios || []).map((s) => (s || "").trim()).filter(Boolean);
      return Array.from(new Set(nomes));
    } catch {
      return [];
    }
  }

  for (const e of empresas) {
    const cnpj = soDigitos(e.cnpj);
    if (cnpj.length !== 14) { pulados++; continue; }
    if (vistos.has(cnpj)) { pulados++; continue; }
    vistos.add(cnpj);

    const nomeEmpresa = nomeProprio((e.nome_fantasia || e.razao_social || "").trim()) || cnpj;
    const email = (e.email || "").trim().toLowerCase() || null;
    // domínio só quando é o SITE da empresa (não gmail/hotmail) — é o que permite
    // raspar o site depois em busca de telefone/WhatsApp.
    const dominio = dominioCorporativo(email);

    // 2) garante a EMPRESA (por CNPJ; senão por nome; senão cria enriquecida)
    let account_id = contaPorCnpj.get(cnpj) || contaPorNome.get(normNome(nomeEmpresa)) || null;
    if (!account_id) {
      const { data: nova, error: errA } = await supabase
        .from("accounts")
        .insert({
          tenant_id,
          owner_id: user_id ?? null,
          name: nomeEmpresa,
          cnpj,
          cnae: e.cnae ? (e.cnae_descricao ? `${e.cnae} — ${e.cnae_descricao}` : e.cnae) : null,
          uf: e.uf || null,
          municipio: nomeProprio(e.municipio) || null,
          domain: dominio,
          phone: e.telefone || null,
        })
        .select("id")
        .single();
      if (errA) {
        // corrida no índice único de CNPJ (0070): busca a que acabou de existir
        const { data: ja } = await supabase.from("accounts").select("id").eq("tenant_id", tenant_id).eq("cnpj", cnpj).limit(1).maybeSingle();
        account_id = (ja as any)?.id || null;
      } else {
        account_id = (nova as any).id;
        empresasCriadas++;
        contaIds.push(account_id as string);
        if (nomesEmpresas.length < 50) nomesEmpresas.push(nomeEmpresa);
      }
      if (account_id) contaPorCnpj.set(cnpj, account_id);
    }
    if (account_id) contasParaMarcar.add(account_id); // será marcada com a tag Radar

    // 3) cria o(s) CONTATO(s) apenas no modo "empresa + contato". No padrão ("só
    //    empresa"), NÃO criamos contato — o contato real entra depois (descoberta de
    //    e-mail ou cadastro manual, quando houver uma pessoa).
    if (!criarContato) continue;
    if (contatoTemCnpj.has(cnpj)) { pulados++; continue; }
    if (contatosCriados >= budgetContatos) { limiteAtingido = true; continue; }

    // um contato POR SÓCIO; se a empresa não tiver sócio identificado, cai no antigo
    // (um contato com o nome da empresa) — nunca fica sem contato nenhum.
    const socios = await sociosDaEmpresa(e, cnpj);
    const nomes = socios.length ? socios : [nomeEmpresa];
    const companyNome = nomeProprio(e.razao_social || e.nome_fantasia) || null;
    let criouAlgum = false;

    for (const nome of nomes) {
      if (contatosCriados >= budgetContatos) { limiteAtingido = true; break; }
      // o e-mail e o telefone são DA EMPRESA (não da pessoa): só o primeiro contato os
      // carrega — assim não duplicamos o mesmo e-mail corporativo em todos os sócios,
      // e só uma verificação de WhatsApp é enfileirada por empresa.
      const primeiro = !criouAlgum;
      const emailContato = primeiro ? email : null;
      const { data: novoContato, error: errC } = await supabase.from("contacts").insert({
        tenant_id,
        assigned_to: user_id ?? null,
        name: nome,
        company: companyNome,
        account_id,
        cnpj,
        email: emailContato,
        phone: primeiro ? (e.telefone || null) : null,
        company_domain: dominio,
        origin: socios.length ? "Radar (sócio)" : "Radar",
        status: "novo",
        // ESTEIRA AUTOMÁTICA: telefone da Receita (só no 1º) → fila de verificação de
        // WhatsApp; domínio corporativo (em todos) → fila de captura no site do sócio.
        wa_status: primeiro && e.telefone ? "queued" : null,
        web_capture: dominio ? "queued" : null,
      }).select("id").single();
      if (!errC && novoContato) {
        criouAlgum = true;
        contatosCriados++;
        contatoIds.push((novoContato as any).id as string);
        // sem e-mail + domínio + nome de pessoa → entra na descoberta de e-mail (SMTP)
        if (!emailContato && dominio && !pareceEmpresa(nome)) {
          filaEmail.push({ tenant_id, contact_id: (novoContato as any).id, name: nome, domain: dominio });
        }
      }
    }
    if (criouAlgum) contatoTemCnpj.add(cnpj);
  }

  // marca todas as empresas tocadas com a tag "Radar"
  if (tagId && contasParaMarcar.size) {
    const rows = Array.from(contasParaMarcar).map((account_id) => ({ tenant_id, account_id, tag_id: tagId }));
    await supabase.from("account_tags").upsert(rows, { onConflict: "account_id,tag_id", ignoreDuplicates: true });
  }

  // enfileira a descoberta de e-mail dos sócios (o cron /email-discovery drena de
  // hora em hora). Falha aqui não derruba o envio — os contatos já foram criados.
  // UPSERT, não insert: edq_contact_idx é UNIQUE em contact_id, então um contato que
  // já passou pela fila faria o lote inteiro estourar num insert simples.
  if (filaEmail.length) {
    await supabase
      .from("email_discovery_queue")
      .upsert(
        filaEmail.map((j) => ({ ...j, status: "pending", attempts: 0, result: null, last_error: null, processed_at: null })),
        { onConflict: "contact_id" }
      );
  }

  await logAction(supabase, {
    tenant_id,
    user_id,
    action: "radar_import",
    entity: "account",
    qtd: empresasCriadas,
    detail:
      `Gravou ${empresasCriadas} empresa(s) e ${contatosCriados} contato(s) a partir do Radar` +
      (pulados ? `; ${pulados} pulada(s) por já existirem` : "") +
      (limiteAtingido ? "; parou no limite do plano" : "") +
      ".",
    meta: { empresas: nomesEmpresas, contatosCriados, pulados, limiteAtingido, modo },
  });

  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  return { ok: true, empresasCriadas, contatosCriados, pulados, limiteAtingido, contatoIds, contaIds };
}
