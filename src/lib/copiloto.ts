import "server-only";

// ============================================================
// COPILOTO DE RESPOSTA — rascunho, nunca envio
//
// A regra que decide o desenho inteiro: a IA NÃO responde ninguém. Ela escreve um
// rascunho na caixa de texto, e quem manda continua sendo a pessoa. Isso não é
// preciosismo — é o que separa uma ferramenta que ajuda de uma que constrange:
// resposta automática erra tom, promete o que não foi combinado, e responde no lugar
// de alguém que talvez quisesse dizer outra coisa. Aqui a IA custa um clique e
// devolve algo para EDITAR.
//
// O QUE ELA PRECISA LER PARA NÃO ESCREVER GENÉRICO — e é isto que dá o trabalho:
//   · a conversa: as últimas mensagens dos dois lados, na ordem;
//   · o que JÁ FOI ENVIADO na cadência (os toques), para não repetir argumento nem
//     "reapresentar" quem já foi apresentado três vezes;
//   · o sinal de engajamento (abriu, clicou, abriu a proposta) — responder a quem
//     clicou no preço é diferente de responder a quem só abriu;
//   · quem é o lead (nome, empresa, cargo, atividade) e de que produto se trata;
//   · o contexto do negócio que o próprio operador já escreveu para a IA de cadência
//     (mercado, produto, ICP, tom, provas) — reaproveitado, não perguntado de novo.
//
// O QUE ELA NÃO PODE FAZER, e está no prompt como regra dura: inventar preço, prazo,
// desconto, política ou funcionalidade. Numa venda, uma promessa inventada não é um
// texto ruim — é um problema comercial que sobra para o humano resolver depois.
// ============================================================

export type MensagemConversa = { de: "lead" | "voce"; texto: string; quando?: string | null };

export type ContextoResposta = {
  canal: "whatsapp" | "email";
  lead: { nome?: string | null; empresa?: string | null; cargo?: string | null; atividade?: string | null };
  produto?: string | null;
  cadencia?: string | null;
  toquesEnviados: { canal: string; titulo?: string | null; texto?: string | null; quando?: string | null }[];
  sinais: string[];                 // "abriu o e-mail 2x", "clicou no link ...", "abriu a proposta"
  conversa: MensagemConversa[];
  negocio?: string | null;          // contexto do workspace (o mesmo da IA de cadência)
  assinatura?: string | null;
  instrucao?: string | null;        // o que o operador quer dizer, em uma linha
};

const REGRAS = [
  "REGRAS (todas obrigatórias):",
  "- Português do Brasil, tom humano e direto, como uma pessoa escreve para outra no trabalho.",
  "- NUNCA invente preço, prazo, desconto, política, número de clientes, prova ou funcionalidade. Se a resposta depender de um dado que não está no contexto, escreva a frase de um jeito que o humano possa completar, ou faça a pergunta.",
  "- Não repita o que já foi enviado nos toques anteriores; leia-os e siga a conversa de onde ela parou.",
  "- Uma ideia por mensagem e UM próximo passo claro no fim (uma pergunta, ou uma proposta de conversa com dia/horário sugerido de forma aberta).",
  "- Nada de 'espero que esteja bem', 'venho por meio desta', emoji em excesso, exclamação em excesso, ou elogio vazio.",
  "- Se o lead recusou, agradeça, não insista e ofereça deixar a porta aberta. Se pediu para não receber mais, confirme que vai parar — sem negociar.",
  "- Não assine: a assinatura entra depois, automaticamente.",
  "- Devolva SOMENTE o texto da mensagem, sem aspas, sem título, sem comentários seus.",
];

const REGRAS_WHATSAPP = [
  "- WhatsApp: no máximo 3 frases curtas. Sem saudação formal se a conversa já está em andamento. Sem assunto.",
];
const REGRAS_EMAIL = [
  "- E-mail: 2 a 5 frases, parágrafos curtos, sem markdown. Comece pelo nome da pessoa quando fizer sentido.",
];

export function montarPrompt(ctx: ContextoResposta): { system: string; pergunta: string } {
  const system = [
    "Você é um profissional de vendas B2B brasileiro, experiente, escrevendo a resposta de UMA conversa real.",
    "Seu trabalho é rascunhar a resposta que o vendedor vai revisar e enviar — não é fechar negócio sozinho.",
    ...REGRAS,
    ...(ctx.canal === "whatsapp" ? REGRAS_WHATSAPP : REGRAS_EMAIL),
  ].join("\n");

  const partes: string[] = [];

  if (ctx.negocio?.trim()) partes.push(`CONTEXTO DO NEGÓCIO (quem está vendendo):\n${ctx.negocio.trim().slice(0, 2000)}`);
  if (ctx.produto) partes.push(`PRODUTO EM QUESTÃO: ${ctx.produto}`);
  if (ctx.cadencia) partes.push(`CADÊNCIA DE ORIGEM: ${ctx.cadencia}`);

  const l = ctx.lead;
  partes.push(
    "LEAD:\n" +
      [
        l.nome ? `- nome: ${l.nome}` : null,
        l.empresa ? `- empresa: ${l.empresa}` : null,
        l.cargo ? `- cargo: ${l.cargo}` : null,
        l.atividade ? `- atividade da empresa: ${l.atividade}` : null,
      ].filter(Boolean).join("\n")
  );

  if (ctx.toquesEnviados.length) {
    partes.push(
      "O QUE JÁ FOI ENVIADO PARA ELE (não repita):\n" +
        ctx.toquesEnviados
          .slice(-6)
          .map((t, i) => `${i + 1}. [${t.canal}${t.quando ? ` · ${t.quando}` : ""}] ${(t.titulo ? t.titulo + " — " : "") + (t.texto || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400)}`)
          .join("\n")
    );
  }

  if (ctx.sinais.length) {
    partes.push(`SINAIS DESTE LEAD:\n- ${ctx.sinais.join("\n- ")}`);
  }

  partes.push(
    "CONVERSA (mais antiga primeiro):\n" +
      ctx.conversa
        .slice(-12)
        .map((m) => `${m.de === "lead" ? "LEAD" : "VOCÊ"}: ${(m.texto || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 700)}`)
        .join("\n")
  );

  const ultima = [...ctx.conversa].reverse().find((m) => m.de === "lead");
  partes.push(
    ctx.instrucao?.trim()
      ? `O VENDEDOR QUER DIZER ISTO (siga a intenção, melhore a forma):\n${ctx.instrucao.trim().slice(0, 500)}`
      : ultima
      ? "Escreva a resposta à ÚLTIMA mensagem do lead."
      : "Escreva uma mensagem de retomada — o lead ainda não respondeu nada nesta conversa."
  );

  return { system, pergunta: partes.join("\n\n") };
}

// Limpeza do que a IA devolve: modelo às vezes embrulha em aspas ou explica antes.
// Sem isso o rascunho chega na caixa com lixo que o operador teria de apagar à mão.
export function limparRascunho(t: string): string {
  let s = String(t || "").trim();
  s = s.replace(/^```[a-z]*\s*/i, "").replace(/```$/i, "").trim();
  s = s.replace(/^(rascunho|resposta|sugestão)\s*:\s*/i, "").trim();
  if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s;
}
