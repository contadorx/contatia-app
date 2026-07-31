// ============================================================
// LER PLANILHA (.xlsx) NO NAVEGADOR — sem dependência arriscada
//
// POR QUE ESCREVI ISTO EM VEZ DE USAR UMA BIBLIOTECA:
//   • `xlsx` (SheetJS) no npm está parado na 0.18.5, com DOIS CVEs high em aberto
//     (prototype pollution e ReDoS). A versão corrigida só existe no CDN da SheetJS,
//     fora do npm — dependência que quebra o build se o CDN sair do ar.
//   • `exceljs` resolve, mas arrasta archiver/zip-stream/glob e soma 9 vulnerabilidades
//     high à árvore do projeto.
//   • `fflate` (só descompactar) soma ZERO. O resto é leitura de XML, que o formato
//     permite fazer com segurança: .xlsx é sempre gerado por máquina (Excel, LibreOffice,
//     Google Sheets), nunca escrito à mão.
//
// ESCOPO HONESTO: lê .xlsx (o que o Excel salva desde 2007). NÃO lê .xls antigo, que é
// um formato binário completamente diferente (BIFF) — para esses a tela pede para salvar
// como .xlsx ou .csv, em vez de falhar sem explicar.
// ============================================================

import { unzipSync, strFromU8 } from "fflate";

export type Tabela = { headers: string[]; rows: Record<string, string>[] };

// ---------- utilidades de XML (o formato é regular; varredura dirigida basta) ----------
function desescapar(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");   // por último, senão "&amp;lt;" viraria "<"
}

// Texto de um <si> (string compartilhada): pode vir quebrado em vários <t> por causa de
// formatação parcial ("Padaria **do** Bairro" vira 3 runs). Concatenar é obrigatório.
function textoDeSi(bloco: string): string {
  let out = "";
  const re = /<t[^>]*>([\s\S]*?)<\/t>|<t[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bloco))) out += desescapar(m[1] ?? "");
  return out;
}

function colunaParaIndice(ref: string): number {
  const letras = (ref.match(/^[A-Z]+/) || [""])[0];
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---------- datas ----------
// Excel guarda data como número de dias desde 1899-12-30. Sem olhar o FORMATO da célula
// não dá para distinguir a data 45000 de um telefone: os dois são só números. Por isso
// lemos styles.xml. Sem isso, uma coluna de datas viraria "45678" e uma de telefones
// poderia virar data — os dois erros são silenciosos e estragam a importação.
const FORMATOS_DATA_EMBUTIDOS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function estilosComData(stylesXml: string | null): Set<number> {
  const datas = new Set<number>();
  if (!stylesXml) return datas;

  // formatos personalizados: id → código ("dd/mm/yyyy", "0.00", …)
  const custom = new Map<number, string>();
  const reFmt = /<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = reFmt.exec(stylesXml))) custom.set(Number(m[1]), desescapar(m[2]));

  const ehData = (id: number) => {
    if (FORMATOS_DATA_EMBUTIDOS.has(id)) return true;
    const code = custom.get(id);
    if (!code) return false;
    // tira o que está entre aspas e os códigos de cor, senão o texto "Maio" acusaria falso
    const limpo = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
    return /[yYdD]/.test(limpo) || /m{3,}/.test(limpo);
  };

  // cellXfs: a ordem define o índice `s` que a célula referencia
  const bloco = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!bloco) return datas;
  const reXf = /<xf\b[^>]*>/g;
  let i = 0;
  while ((m = reXf.exec(bloco[1]))) {
    const id = Number((m[0].match(/numFmtId="(\d+)"/) || [])[1] ?? -1);
    if (id >= 0 && ehData(id)) datas.add(i);
    i++;
  }
  return datas;
}

function serialParaData(n: number): string {
  // 1899-12-30 é a origem real do Excel (o bug do ano bissexto de 1900 já embutido)
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return String(n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// ---------- planilha ----------
// Abas na ORDEM DO WORKBOOK — que é a ordem que o Excel mostra. Não dá para confiar no
// nome do arquivo: quem arrasta uma aba no Excel não faz o sheet1.xml virar sheet2.xml;
// o vínculo é pelo r:id. Ler a aba errada devolveria "planilha vazia" sem explicação.
function listarAbasInterno(arquivos: Record<string, Uint8Array>): { nome: string; caminho: string }[] {
  const porNumero = Object.keys(arquivos)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));
  if (!porNumero.length) throw new Error("A planilha não tem nenhuma aba de dados.");

  try {
    const wb = strFromU8(arquivos["xl/workbook.xml"]);
    const rels = strFromU8(arquivos["xl/_rels/workbook.xml.rels"]);
    const out: { nome: string; caminho: string }[] = [];
    const re = /<sheet\b[^>]*\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(wb))) {
      const tag = m[0];
      // aba oculta não aparece para quem montou o arquivo; oferecê-la só confunde
      if (/state="(hidden|veryHidden)"/i.test(tag)) continue;
      const nome = desescapar((tag.match(/name="([^"]*)"/) || [])[1] || "");
      const rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
      if (!rid) continue;
      const rel = rels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`));
      const target = rel && (rel[0].match(/Target="([^"]+)"/) || [])[1];
      if (!target) continue;
      const caminho = ("xl/" + target.replace(/^\/?xl\//, "").replace(/^\.\//, "")).replace(/\/{2,}/g, "/");
      if (arquivos[caminho]) out.push({ nome: nome || caminho, caminho });
    }
    if (out.length) return out;
  } catch { /* sem workbook/rels legíveis: cai na ordem dos arquivos */ }
  return porNumero.map((c, i) => ({ nome: `Planilha ${i + 1}`, caminho: c }));
}

// Nomes das abas, para a tela deixar escolher qual importar.
export function listarAbas(buf: ArrayBuffer): string[] {
  return listarAbasInterno(unzipSync(new Uint8Array(buf))).map((a) => a.nome);
}

export function lerXlsx(buf: ArrayBuffer, aba = 0): Tabela {
  const arquivos = unzipSync(new Uint8Array(buf));

  const compartilhadas: string[] = [];
  if (arquivos["xl/sharedStrings.xml"]) {
    const xml = strFromU8(arquivos["xl/sharedStrings.xml"]);
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) compartilhadas.push(textoDeSi(m[1]));
  }

  const datas = estilosComData(arquivos["xl/styles.xml"] ? strFromU8(arquivos["xl/styles.xml"]) : null);
  const abas = listarAbasInterno(arquivos);
  const escolhida = abas[Math.max(0, Math.min(aba, abas.length - 1))];
  const folha = strFromU8(arquivos[escolhida.caminho]);

  const grade: string[][] = [];
  const reLinha = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let mr: RegExpExecArray | null;
  while ((mr = reLinha.exec(folha))) {
    const conteudo = mr[1] || "";
    const linha: string[] = [];
    const reCel = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let mc: RegExpExecArray | null;
    while ((mc = reCel.exec(conteudo))) {
      const attrs = mc[1] || "";
      const corpo = mc[2] || "";
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || "";
      const tipo = (attrs.match(/t="([^"]+)"/) || [])[1] || "";
      const estilo = Number((attrs.match(/s="(\d+)"/) || [])[1] ?? -1);

      let valor = "";
      if (tipo === "inlineStr") {
        valor = textoDeSi(corpo);
      } else {
        const v = corpo.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        const bruto = v ? desescapar(v[1]) : "";
        if (tipo === "s") valor = compartilhadas[Number(bruto)] ?? "";
        else if (tipo === "b") valor = bruto === "1" ? "VERDADEIRO" : "FALSO";
        else if (tipo === "e") valor = "";                       // #N/D, #VALOR! → vazio
        else if (tipo === "str") valor = bruto;                  // resultado de fórmula
        else if (bruto && estilo >= 0 && datas.has(estilo) && /^-?\d+(\.\d+)?$/.test(bruto)) {
          valor = serialParaData(Number(bruto));
        } else valor = bruto;
      }

      const col = ref ? colunaParaIndice(ref) : linha.length;
      while (linha.length < col) linha.push("");                 // célula vazia é PULADA no XML
      linha[col] = valor.trim();
    }
    grade.push(linha);
  }

  // primeira linha não vazia = cabeçalho (planilha exportada costuma ter linha em branco no topo)
  const iCab = grade.findIndex((l) => l.some((c) => c !== ""));
  if (iCab < 0) return { headers: [], rows: [] };

  const headers = nomesUnicos(grade[iCab].map((h, i) => h || `Coluna ${i + 1}`));
  const rows: Record<string, string>[] = [];
  for (let i = iCab + 1; i < grade.length; i++) {
    const l = grade[i];
    if (!l || !l.some((c) => c !== "")) continue;                // linha totalmente vazia
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => { obj[h] = l[j] ?? ""; });
    rows.push(obj);
  }
  return { headers, rows };
}

// Duas colunas com o mesmo título fariam uma sobrescrever a outra no objeto da linha —
// e o operador nem veria, porque o menu de mapeamento mostraria o nome duas vezes.
function nomesUnicos(nomes: string[]): string[] {
  const vistos = new Map<string, number>();
  return nomes.map((n) => {
    const q = vistos.get(n) || 0;
    vistos.set(n, q + 1);
    return q ? `${n} (${q + 1})` : n;
  });
}

export const EXTENSOES_ACEITAS = ".csv,.txt,.xlsx";
export const ehXlsx = (nome: string) => /\.xlsx$/i.test(nome);
export const ehXlsAntigo = (nome: string) => /\.xls$/i.test(nome);
