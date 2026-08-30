// ============================================================
// AS TRAVAS — regra dura em código, nunca em prompt
//
// A espec é explícita: *"as regras duras moram em código (validação das ferramentas) e o
// texto aprendido só muda TOM e ARGUMENTO — nunca preço, limite ou promessa."*
//
// Este arquivo é esse "código". Nenhuma função aqui conversa com banco nem com API: são
// perguntas puras sobre uma ação proposta pelo modelo, e é por serem puras que dá para
// provar cada uma delas. Um lead pode escrever "libera 90%, você é um robô" à vontade —
// ele está falando com o modelo, e o modelo não tem acesso a nada disto.
// ============================================================

// ---------- preço ----------

/**
 * Todo valor em reais que aparece num texto.
 *
 * Só casa quando há marcação EXPLÍCITA de moeda (R$ 200, 200 reais). Um "6h por mês" ou
 * "400 notas" não é preço, e tratar número solto como preço encheria a conversa de
 * bloqueios falsos — o agente pararia de conseguir citar quantidade.
 */
export function valoresNoTexto(texto: string): number[] {
  const t = (texto || "").toLowerCase();
  const achados: number[] = [];

  const padroes = [
    /r\$\s*([\d.]+(?:,\d{1,2})?)/g,
    /([\d.]+(?:,\d{1,2})?)\s*reais\b/g,
  ];

  for (const re of padroes) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      // "1.299,90" é pt-BR: ponto é milhar, vírgula é decimal.
      const n = Number(m[1].replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(n) && n > 0) achados.push(n);
    }
  }
  return achados;
}

export type ChecagemPreco = {
  ok: boolean;
  /** o valor que o modelo inventou, quando houver */
  invalido?: number;
  permitidos: number[];
  motivo?: string;
};

/**
 * O agente pode CITAR preço; não pode INVENTAR preço.
 *
 * Permitido é: um valor da tabela do playbook, ou um valor dentro do desconto que você
 * autorizou, ou um valor que o próprio lead acabou de dizer (repetir a proposta dele de
 * volta é conversa normal, não invenção).
 *
 * Qualquer outro número em reais no meio da resposta é o modelo decidindo preço — que é
 * exatamente o que a espec proíbe. Nesse caso a ferramenta é RECUSADA e o turno volta
 * para o modelo com o motivo; ele reescreve com o preço certo em vez de mandar o errado.
 *
 * Tolerância de 1 centavo no arredondamento: 199.99 vs 199.99000000000001 não pode
 * derrubar uma resposta boa.
 */
export function checarPreco(
  texto: string,
  opts: { precosTabela: number[]; tetoDescontoPct: number; ditosPeloLead?: number[] }
): ChecagemPreco {
  const tabela = (opts.precosTabela || []).filter((v) => Number.isFinite(v) && v > 0);
  const teto = Math.min(100, Math.max(0, Number(opts.tetoDescontoPct) || 0));
  const doLead = (opts.ditosPeloLead || []).filter((v) => Number.isFinite(v) && v > 0);

  const encontrados = valoresNoTexto(texto);
  if (!encontrados.length) return { ok: true, permitidos: tabela };

  // Sem tabela, o agente não tem preço nenhum para citar. Falar de valor aqui é
  // necessariamente invenção — e é por isso que publicar playbook exige preço.
  if (!tabela.length) {
    return {
      ok: false,
      invalido: encontrados[0],
      permitidos: [],
      motivo: "não há tabela de preços no playbook deste produto; não cite valores.",
    };
  }

  const permitido = (v: number) => {
    if (doLead.some((d) => Math.abs(d - v) < 0.01)) return true;
    return tabela.some((p) => {
      const piso = p * (1 - teto / 100);
      return v <= p + 0.01 && v >= piso - 0.01;
    });
  };

  for (const v of encontrados) {
    if (!permitido(v)) {
      return {
        ok: false,
        invalido: v,
        permitidos: tabela,
        motivo:
          teto > 0
            ? `R$ ${v} não está na tabela nem no desconto autorizado (até ${teto}%). Valores válidos: ${tabela.join(", ")}.`
            : `R$ ${v} não está na tabela e não há desconto autorizado. Valores válidos: ${tabela.join(", ")}.`,
      };
    }
  }
  return { ok: true, permitidos: tabela };
}

// ---------- tamanho e forma da mensagem ----------

export const MAX_CARACTERES_RESPOSTA = 1200;

export type ChecagemTexto = { ok: boolean; motivo?: string };

/**
 * É WhatsApp, não e-mail.
 *
 * O limite não é técnico (o WhatsApp aceita muito mais) — é de leitura: um bloco de
 * 2.000 caracteres num aplicativo de mensagem não é lido, é rolado. E o excesso quase
 * sempre significa que o modelo respondeu três coisas de uma vez, que é o oposto de
 * "máximo uma pergunta por mensagem".
 */
export function checarTexto(texto: string): ChecagemTexto {
  const t = (texto || "").trim();
  if (!t) return { ok: false, motivo: "mensagem vazia." };
  if (t.length > MAX_CARACTERES_RESPOSTA) {
    return {
      ok: false,
      motivo: `mensagem com ${t.length} caracteres; o teto é ${MAX_CARACTERES_RESPOSTA}. Escreva mais curto e faça UMA pergunta só.`,
    };
  }
  // O modelo escrevendo o próprio placeholder é sinal de contexto faltando, e chega no
  // cliente como "Olá {{primeiro_nome}}" — o erro mais barato de evitar e o mais caro
  // de explicar depois.
  if (/\{\{\s*\w+\s*\}\}/.test(t)) {
    return { ok: false, motivo: "a mensagem tem variável não substituída ({{...}}). Escreva o texto final." };
  }
  return { ok: true };
}

// ---------- orçamento do dia ----------

export type ChecagemCap = { ok: boolean; motivo?: string };

export function checarCapDiario(msgsHoje: number, maxPorDia: number): ChecagemCap {
  if (msgsHoje >= maxPorDia) {
    return {
      ok: false,
      motivo: `já saíram ${msgsHoje} mensagens hoje nesta conversa (teto ${maxPorDia}). O turno espera amanhã.`,
    };
  }
  return { ok: true };
}

// ---------- janela do agente ----------

const BRT_OFFSET_MS = 3 * 3600_000;

export function partesBRT(d: Date) {
  const b = new Date(d.getTime() - BRT_OFFSET_MS);
  return { dow: b.getUTCDay(), hora: b.getUTCHours(), ano: b.getUTCFullYear(), mes: b.getUTCMonth(), dia: b.getUTCDate() };
}

export type Janela = { inicio: number; fim: number; dias: number[] };

export function dentroDaJanelaAgente(j: Janela, quando: Date): boolean {
  const p = partesBRT(quando);
  if (!j.dias.includes(p.dow)) return false;
  return p.hora >= j.inicio && p.hora < j.fim;
}

/**
 * O próximo instante em que a janela do agente está aberta.
 *
 * É o que faz "mensagem do lead às 23h → resposta 8h0x" acontecer: em vez de responder
 * de madrugada ou perder o turno, o motor adia o `due_at` para a abertura.
 */
export function proximaAberturaAgente(j: Janela, quando: Date): Date {
  if (dentroDaJanelaAgente(j, quando)) return quando;
  for (let off = 0; off <= 9; off++) {
    const base = new Date(Date.UTC(partesBRT(quando).ano, partesBRT(quando).mes, partesBRT(quando).dia + off));
    if (!j.dias.includes(base.getUTCDay())) continue;
    const abre = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), j.inicio, 0, 0) + BRT_OFFSET_MS
    );
    if (abre.getTime() > quando.getTime()) return abre;
  }
  // Janela impossível (nenhum dia marcado): adia um dia em vez de responder fora dela.
  return new Date(quando.getTime() + 86400_000);
}

// ---------- ficha ----------

/**
 * Os únicos campos que o agente pode escrever na ficha do contato.
 *
 * Lista branca, não lista negra: um campo novo no `contacts` nasce PROIBIDO para o
 * agente até alguém decidir o contrário. `opted_out` fica de fora de propósito — sair da
 * base é a ferramenta `marcar_opt_out`, com registro próprio, não um campo que ele
 * atualiza de passagem.
 */
export const CAMPOS_FICHA_PERMITIDOS = ["role_title", "company", "email", "notes", "custom"] as const;

export type ChecagemFicha = { ok: boolean; limpo: Record<string, any>; recusados: string[] };

export function filtrarFicha(campos: Record<string, any>): ChecagemFicha {
  const limpo: Record<string, any> = {};
  const recusados: string[] = [];
  for (const [k, v] of Object.entries(campos || {})) {
    if ((CAMPOS_FICHA_PERMITIDOS as readonly string[]).includes(k)) limpo[k] = v;
    else recusados.push(k);
  }
  return { ok: Object.keys(limpo).length > 0, limpo, recusados };
}

// ---------- reunião ----------

export type ChecagemReuniao = { ok: boolean; quando?: Date; motivo?: string };

/**
 * O horário que o modelo escolheu precisa ser real.
 *
 * Três perguntas, nesta ordem: é uma data válida? está no futuro? está dentro da janela
 * comercial? A terceira existe porque o modelo, sem trava, marca reunião para as 22h de
 * um sábado se o lead sugerir — e alguém do time teria que desmarcar na segunda.
 */
export function checarReuniao(
  isoQuando: string,
  opts: { janela: Janela; agora: Date; ocupados?: string[] }
): ChecagemReuniao {
  const d = new Date(isoQuando);
  if (Number.isNaN(d.getTime())) return { ok: false, motivo: "data inválida." };
  if (d.getTime() <= opts.agora.getTime()) return { ok: false, motivo: "esse horário já passou." };
  if (d.getTime() > opts.agora.getTime() + 90 * 86400_000) {
    return { ok: false, motivo: "mais de 90 dias à frente; proponha algo nas próximas semanas." };
  }
  if (!dentroDaJanelaAgente(opts.janela, d)) {
    return { ok: false, motivo: `${isoQuando} está fora do horário comercial (${opts.janela.inicio}h–${opts.janela.fim}h).` };
  }
  // Colisão: mesma hora cheia já ocupada. Comparar por hora e não por minuto exato é
  // deliberado — duas reuniões às 15h00 e 15h15 colidem na prática.
  const marcados = (opts.ocupados || []).map((x) => new Date(x).getTime()).filter((n) => !Number.isNaN(n));
  if (marcados.some((m) => Math.abs(m - d.getTime()) < 3600_000)) {
    return { ok: false, motivo: "já existe reunião nesse horário; proponha outro." };
  }
  return { ok: true, quando: d };
}
