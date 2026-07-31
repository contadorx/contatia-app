// ============================================================
// CNPJ ALFANUMÉRICO — normalizar, validar e formatar
//
// O QUE MUDOU NA REGRA (vale desde julho/2026):
//   • As 12 primeiras posições passaram a aceitar LETRAS: 8 da raiz + 4 do
//     estabelecimento. Ex.: 12.ABC.345/01DE-35
//   • As 2 últimas continuam sendo dígitos verificadores, sempre NUMÉRICOS.
//   • O cálculo do DV é o mesmo módulo 11 de sempre, com uma conversão antes:
//     o valor de cada caractere é o seu código ASCII menos 48. Assim "0" continua
//     valendo 0 ("0" é 48), "9" vale 9, e "A" passa a valer 17 ("A" é 65).
//   • Por causa dessa equivalência, TODO CNPJ numérico antigo continua válido pela
//     mesma conta — não existe "dois algoritmos", existe um só.
//
// POR QUE ESTE ARQUIVO PRECISOU EXISTIR:
// o app inteiro tratava CNPJ com `replace(/\D/g, "")`. Num CNPJ com letra isso APAGA
// as letras, o resultado fica com menos de 14 caracteres e o valor é descartado como
// inválido — em silêncio. Era o caso em ~20 lugares (importação, Radar, dedup de
// empresa, enriquecimento, cobrança).
//
// Sem "server-only" de propósito: a validação também roda no navegador, para avisar
// antes de enviar.
// ============================================================

// Só o que pode aparecer num CNPJ: dígitos e letras maiúsculas. Acentos, minúsculas e
// pontuação saem. Minúscula vira maiúscula ANTES, senão "a" (97) daria valor 49 e o
// dígito verificador sairia errado.
export function normalizarCnpj(raw: string | null | undefined): string {
  return (raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// Valor de um caractere no cálculo do DV: ASCII − 48.
const valorDe = (ch: string) => ch.charCodeAt(0) - 48;

// Módulo 11 com pesos 2..9 cíclicos, da direita para a esquerda.
function digito(base: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += valorDe(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

// Estrutura correta? 14 posições, as 12 primeiras alfanuméricas e as 2 últimas numéricas.
export function cnpjFormatoOk(raw: string | null | undefined): boolean {
  const v = normalizarCnpj(raw);
  return /^[0-9A-Z]{12}[0-9]{2}$/.test(v);
}

// Estrutura + dígitos verificadores.
export function cnpjValido(raw: string | null | undefined): boolean {
  const v = normalizarCnpj(raw);
  if (!cnpjFormatoOk(v)) return false;
  // Repetição total ("00000000000000") passa no módulo 11 mas não existe na Receita.
  if (/^(.)\1{13}$/.test(v)) return false;
  const base = v.slice(0, 12);
  const dv1 = digito(base);
  const dv2 = digito(base + String(dv1));
  return v.slice(12) === `${dv1}${dv2}`;
}

export function ehCnpjAlfanumerico(raw: string | null | undefined): boolean {
  const v = normalizarCnpj(raw);
  return cnpjFormatoOk(v) && /[A-Z]/.test(v);
}

// XX.XXX.XXX/XXXX-XX — a máscara é a mesma do formato antigo.
export function formatarCnpj(raw: string | null | undefined): string {
  const v = normalizarCnpj(raw);
  if (v.length !== 14) return (raw || "").trim();
  return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
}

// Chave de comparação/dedup: devolve "" quando NÃO é um CNPJ completo.
// Deliberadamente NÃO exige dígito verificador correto — base importada de planilha
// costuma ter DV errado por erro de digitação, e recusar aí faria a empresa perder o
// vínculo. Quem quiser recusar de fato usa cnpjValido().
export function chaveCnpj(raw: string | null | undefined): string {
  const v = normalizarCnpj(raw);
  return cnpjFormatoOk(v) ? v : "";
}

// A base da Receita no VPS (dump oficial) só tem CNPJ numérico: os alfanuméricos são
// emitidos a partir de julho/2026 e ainda não entram no arquivo mensal. Esta função diz
// se vale a pena consultar lá — evita uma ida à rede que voltaria vazia de qualquer jeito.
export function consultavelNaBaseReceita(raw: string | null | undefined): boolean {
  const v = normalizarCnpj(raw);
  return /^[0-9]{14}$/.test(v);
}
