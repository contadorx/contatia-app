import "server-only";

// ============================================================
// Geração de CSV — um lugar só, para os arquivos saírem todos iguais.
//
// Decisões que existem por causa do Excel em português, não por capricho:
//
//  • SEPARADOR ";" — o Excel pt-BR usa vírgula como separador DECIMAL, então um CSV
//    com vírgula abre tudo numa coluna só. Com ";" ele abre certo no clique duplo.
//  • BOM (﻿) no começo — sem ele, o Excel lê o arquivo como Latin-1 e "José" vira
//    "JosÃ©". Três bytes que evitam a reclamação clássica de acento quebrado.
//  • CRLF entre linhas — é o que a especificação do CSV manda e o que o Excel espera.
//  • Célula que começa com = + - @ ganha um apóstrofo na frente. Sem isso, um contato
//    chamado "=cmd|..." vira FÓRMULA ao abrir a planilha (CSV injection). O apóstrofo
//    força texto e some da exibição.
// ============================================================

export function celulaCsv(v: any): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // neutraliza fórmula
  s = s.replace(/\r?\n/g, " ").trim();               // quebra de linha destrói a coluna
  if (/[";]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function montarCsv(cabecalho: string[], linhas: (any[])[]): string {
  const corpo = linhas.map((l) => l.map(celulaCsv).join(";"));
  return "﻿" + [cabecalho.join(";"), ...corpo].join("\r\n");
}

// data/hora no formato que a planilha entende sem briga
export function dataCsv(iso: any): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}
