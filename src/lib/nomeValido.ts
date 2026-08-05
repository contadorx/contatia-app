// ============================================================
// NADA SAI COM LIXO NO LUGAR DO NOME
//
// Hoje o Radar criou contatos chamados literalmente "[object Object]": a API do VPS
// passou a devolver o sócio como objeto e o app no ar ainda fazia String(socio). Isso
// seria só uma feiura na lista — mas esses contatos entraram em cadência, e a
// mensagem saiu para gente de verdade começando com "Oi, [object Object]".
//
// Consertar a origem (feito na 2026.08.04-27) resolve o caso conhecido. Este módulo
// existe para o próximo: seja qual for a origem — importação de CSV torta, API que
// muda de formato, campo nulo virando a string "undefined" —, o app não pode ter
// nenhum caminho que entregue isso ao destinatário.
//
// A regra é simples e vale nos dois momentos:
//   · ao MONTAR o texto → nome quebrado vira vazio, e o modelo usa a saudação neutra;
//   · ao ENVIAR → se o texto JÁ contém a marca (tarefas antigas foram materializadas
//     com ela dentro), o envio é RECUSADO com o motivo na tela.
//
// A segunda parte é a que importa. A primeira sozinha não protege o que já está
// gravado, e era isso que estava saindo.
// ============================================================

// Valores que aparecem quando algo deu errado no caminho e ninguém percebeu.
const LIXO = new Set(["[object object]", "object object", "undefined", "null", "nan", "[object]", "{}"]);

/** O nome é inutilizável? (vazio conta como inutilizável para efeito de saudação) */
export function nomeQuebrado(nome?: string | null): boolean {
  const n = String(nome ?? "").trim().toLowerCase();
  if (!n) return true;
  if (LIXO.has(n)) return true;
  // "[object Object] Silva" e variações: se começa com a marca, está quebrado
  if (n.startsWith("[object")) return true;
  return false;
}

/** O nome, ou vazio quando é lixo. Para uso no render dos modelos. */
export function nomeUsavel(nome?: string | null): string {
  return nomeQuebrado(nome) ? "" : String(nome).trim();
}

/**
 * O texto já pronto contém lixo de renderização?
 *
 * Verificado no ENVIO, e não só no render, porque as tarefas de cadência guardam o
 * texto materializado: quem foi criado com o defeito carrega "[object Object]" dentro
 * do corpo, e nenhum conserto no render alcança isso.
 */
export function textoTemLixo(texto?: string | null): boolean {
  const t = String(texto ?? "");
  return /\[object\s+object\]|\bundefined\b|\bNaN\b/i.test(t);
}

/** Mensagem única para os pontos de envio — o operador precisa saber o que fazer. */
export const AVISO_LIXO =
  "Esta mensagem tem um erro de preenchimento (aparece \"[object Object]\" ou \"undefined\" no texto). " +
  "Não enviei para não sair assim para o destinatário. Corrija o nome do contato e a mensagem, ou " +
  "remova-o da cadência.";
