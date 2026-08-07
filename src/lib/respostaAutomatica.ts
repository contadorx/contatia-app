// ============================================================
// RESPOSTA AUTOMÁTICA NÃO É RESPOSTA
//
// Metade dos escritórios tem central automática no WhatsApp. O que volta em segundos é
// "Olá! Bem-vindo(a) ao atendimento automático da X", "Agradecemos seu contato",
// "Digite 1 para…". Para o Contatia isso estava valendo como RESPOSTA, e o estrago é
// duplo:
//
//   1. o contato ganha 30 pontos e vira "quente" — o painel enche de gente que não
//      leu nada, e a fila prioriza quem não deveria estar na frente;
//   2. pior: a cadência é PAUSADA (status 'replied') e os toques seguintes são
//      cancelados. Ou seja, o robô do outro lado desliga a prospecção sozinho, e o
//      lead nunca mais é tocado. Silenciosamente.
//
// O segundo é o caro. Perder pontuação é ruído; perder a sequência inteira é perder o
// lead — e não aparece em lugar nenhum, porque para o sistema aquilo "foi respondido".
//
// COMO DECIDIMOS. Nenhum sinal isolado basta, então são três famílias somadas:
//   FORTE  — frases que só existem em automação ("mensagem automática", "não responda
//            esta mensagem", "atendimento automático", "protocolo de atendimento").
//   MÉDIO  — boas-vindas e agradecimento de recebimento ("bem-vindo(a) a", "agradecemos
//            seu contato", "em breve retornaremos", "fora do horário de atendimento").
//   MENU   — a cara de URA: "digite 1", "escolha uma opção", linhas numeradas.
//
// Um sinal FORTE decide sozinho. MÉDIO precisa de companhia (outro médio, um menu, ou
// ter chegado em segundos). O texto sozinho nunca é prova, e é por isso que a decisão
// é conservadora: na dúvida, é RESPOSTA HUMANA. Errar para o lado de "é gente" custa
// uma revisão sua; errar para o outro lado joga fora um lead que respondeu de verdade.
// ============================================================

const FORTE = [
  /mensagem\s+autom[áa]tica/i,
  /resposta\s+autom[áa]tica/i,
  /atendimento\s+autom[áa]tico/i,
  /n[ãa]o\s+responda\s+(a\s+)?est[ae]\s+mensagem/i,
  /esta\s+[ée]\s+uma\s+mensagem\s+gerada/i,
  /protocolo\s+(de\s+)?atendimento/i,
  /seu\s+protocolo\s+[ée]/i,
  /assistente\s+virtual/i,
  /\bchatbot\b/i,
  /aguarde,?\s+voc[êe]\s+ser[áa]\s+atendido/i,
];

const MEDIO = [
  // "Bem-vindo (a) ContadorX" (sem o "ao") também conta — a saudação de central quase
  // nunca vem gramaticalmente redondinha
  /bem[\s-]?vind[oa]s?\b/i,
  /agradecemos\s+(o\s+)?seu\s+contato/i,
  /agradece\s+o\s+seu\s+contato/i,
  /obrigado\s+por\s+entrar\s+em\s+contato/i,
  /em\s+breve\s+(voc[êe]\s+)?(ser[áa]|iremos|vamos|retornaremos)/i,
  /retornaremos\s+(o\s+)?(seu\s+)?contato/i,
  /assim\s+que\s+poss[íi]vel\s+(um|nossa|nosso)/i,
  /hor[áa]rio\s+(de\s+)?atendimento/i,
  /\bretornaremos\b/i,
  // primeira resposta que já empurra rede social é peça de marketing, não conversa
  /siga[\s-]?nos/i,
  /nossas?\s+redes\s+sociais/i,
  /fora\s+do\s+(nosso\s+)?hor[áa]rio/i,
  /para\s+agilizar\s+(o\s+)?seu?\s+atendimento/i,
  /informe\s+(os\s+)?(seguintes\s+)?dados/i,
  /envie\s+as\s+seguintes\s+informa[çc][õo]es/i,
  /seu\s+atendimento\s+ser[áa]\s+iniciado/i,
];

const MENU = [
  /digite\s+\d/i,
  /escolha\s+(uma\s+)?op[çc][ãa]o/i,
  /selecione\s+(uma\s+)?op[çc][ãa]o/i,
  /responda\s+com\s+o\s+n[úu]mero/i,
];

// Três ou mais linhas começando com "1)", "2 -", "3." é menu, mesmo sem a palavra.
function pareceListaNumerada(texto: string): boolean {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim());
  const numeradas = linhas.filter((l) => /^\(?\d\s*[).:\-–]/.test(l)).length;
  return numeradas >= 3;
}

export type VeredictoAuto = {
  automatica: boolean;
  motivo: string | null;
  /** o que pesou, para a tela poder explicar em vez de só decidir */
  sinais: string[];
};

export function pareceRespostaAutomatica(
  texto?: string | null,
  opts?: { segundosDepoisDoEnvio?: number | null }
): VeredictoAuto {
  const t = String(texto || "").replace(/\s+/g, " ").trim();
  if (!t) return { automatica: false, motivo: null, sinais: [] };

  const sinais: string[] = [];
  const forte = FORTE.find((r) => r.test(t));
  if (forte) sinais.push("frase de automação");

  const medios = MEDIO.filter((r) => r.test(t)).length;
  if (medios) sinais.push(medios > 1 ? `${medios} frases de recebimento` : "frase de recebimento");

  const menu = MENU.some((r) => r.test(t)) || pareceListaNumerada(String(texto || ""));
  if (menu) sinais.push("menu de opções");

  // resposta em segundos é o sinal mais honesto que existe: ninguém lê, decide e
  // escreve em 20 segundos. Sozinho não basta (tem gente rápida), mas soma.
  const rapida = typeof opts?.segundosDepoisDoEnvio === "number" && opts.segundosDepoisDoEnvio <= 90;
  if (rapida) sinais.push("chegou em segundos");

  if (forte) return { automatica: true, motivo: "frase que só existe em automação", sinais };
  // menu de opções decide sozinho: "Digite 1 para Fiscal / 2 para Contábil" não é
  // coisa que uma pessoa escreve respondendo a um primeiro contato.
  if (menu) return { automatica: true, motivo: "menu de opções (central de atendimento)", sinais };
  if (medios >= 2) return { automatica: true, motivo: "duas frases típicas de recebimento automático", sinais };
  if (medios >= 1 && menu) return { automatica: true, motivo: "boas-vindas com menu de opções", sinais };
  if (medios >= 1 && rapida) return { automatica: true, motivo: "boas-vindas chegando em segundos", sinais };
  if (menu && rapida) return { automatica: true, motivo: "menu de opções chegando em segundos", sinais };

  return { automatica: false, motivo: null, sinais };
}
