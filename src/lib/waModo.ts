// ============================================================
// O MODO DO WHATSAPP — duas perguntas que estavam numa coluna só
//
// `tenants.whatsapp_mode` respondia, ao mesmo tempo, "como eu ENVIO?" e "eu tenho
// SESSÃO conectada?". Enquanto só existiam dois modos isso passava despercebido; na
// hora em que alguém quis enviar na mão e continuar recebendo pelo Evolution, o app
// disse não — e não por um motivo real, mas porque as duas perguntas estavam grudadas:
// no modo assistido a verificação de WhatsApp em massa recusava ("não há sessão") e a
// caixa de Respostas não deixava responder, mesmo com a instância conectada e viva.
//
// Repare que RECEBER nunca dependeu do modo: o webhook grava a resposta, pausa a
// cadência e pontua o contato sem olhar para esta coluna. Ou seja, metade do híbrido
// já era o comportamento real; o que faltava era o resto do app aceitar isso.
//
// Agora são quatro modos e dois predicados:
//   assistido → link wa.me, sem sessão nenhuma.
//   hibrido   → PRIMEIRO TOQUE na mão (link), sessão conectada para receber,
//               verificar número e responder conversa aberta.
//   evolution → tudo automático, inclusive o primeiro toque.
//   meta      → API oficial (roadmap; não selecionável).
//
// SOBRE O RISCO, sem ilusão: o híbrido reduz exposição, não a elimina. O Baileys é uma
// reimplementação do protocolo do WhatsApp Web e entra na conta como DISPOSITIVO
// VINCULADO — enviar do web.whatsapp.com oficial com ele vinculado é a mesma conta com
// dois dispositivos, um deles não oficial. Some o padrão robótico de envio (sem
// digitação, sem presença, intervalo regular), que é ganho de verdade; não some a
// sessão, que é o que a detecção enxerga. Por isso o híbrido também exige o aceite de
// risco: quem liga a sessão precisa saber o que ligou.
// ============================================================

export type ModoWa = "assistido" | "hibrido" | "evolution" | "meta";

const VALIDOS: ModoWa[] = ["assistido", "hibrido", "evolution", "meta"];

export function modoWa(v?: string | null): ModoWa {
  const m = String(v || "").trim().toLowerCase();
  return (VALIDOS as string[]).includes(m) ? (m as ModoWa) : "assistido";
}

// A Contatia dispara sozinha o primeiro toque da cadência?
export function envioAutomatico(v?: string | null): boolean {
  return modoWa(v) === "evolution";
}

// Existe uma sessão vinculada — que serve para RECEBER, VERIFICAR número e RESPONDER
// conversa já aberta. É o que o híbrido acrescenta ao assistido.
export function temSessao(v?: string | null): boolean {
  const m = modoWa(v);
  return m === "hibrido" || m === "evolution";
}

// Vincular sessão é o que carrega o risco de ban — não o envio em si.
export function precisaAceite(v?: string | null): boolean {
  return temSessao(v);
}

export const ROTULO_MODO: Record<ModoWa, string> = {
  assistido: "assistido (link)",
  hibrido: "híbrido (envio na mão, sessão conectada)",
  evolution: "automático (Evolution)",
  meta: "API oficial",
};
