// ============================================================
// QUAL VERSÃO ESTÁ NO AR
//
// Hoje perdemos tempo duas vezes com a mesma pergunta sem resposta: no VPS, um
// `server.js` anterior estava rodando e só descobrimos porque a linha "multi-filtro v3
// ativo" tinha sumido do log; no app, um conserto foi testado contra o build antigo e
// o sintoma parecia idêntico ao do bug já corrigido.
//
// Nos dois casos o custo não foi o bug — foi não saber, em segundos, se o que está
// rodando é o que a gente acha que está. O VPS já tinha esse carimbo por acaso. O app
// não tinha nenhum.
//
// COMO USAR: este número muda a cada zip entregue. Ele aparece no rodapé do menu
// lateral. Se a tela mostra um número e a entrega diz outro, o build é velho — e isso
// se resolve olhando, não deduzindo pelo texto de uma mensagem.
// ============================================================
export const VERSAO_APP = "2026.08.04-18";

// O que entrou nesta versão — some do bundle do cliente se ninguém importar, e serve
// de histórico curto para responder "isto já está no ar?".
export const VERSAO_NOTAS = "URGENTE: cron so le IMAP de 5 em 5min; reguas reservam antes de enviar (fim do reenvio) · caixa de cadencia fecha";
