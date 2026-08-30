import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { avaliarGatilhos } from "@/lib/agente/gatilhos";
import { montarSystem, montarMensagens, type ContextoTurno } from "@/lib/agente/prompt";
import { FERRAMENTAS, executar, type Ambiente } from "@/lib/agente/ferramentas";
import { esperaAntesDeResponder, tempoDigitando, quebrarEmBaloes, dormir } from "@/lib/agente/humanizar";
import { valoresNoTexto, dentroDaJanelaAgente, proximaAberturaAgente, type Janela } from "@/lib/agente/travas";
import { tocarConversa } from "@/lib/agente/conversas";

// ============================================================
// O MOTOR — um turno, uma ação
//
// Isto NÃO é um loop agêntico solto. A espec pede "UMA ação por turno", e a diferença
// não é estilística: um loop que decide sozinho quantas vezes agir pode mandar cinco
// mensagens seguidas para um lead enquanto ninguém olha. Aqui o modelo é chamado com
// `tool_choice` forçado, devolve exatamente uma ferramenta, ela é VALIDADA em código, e
// as ferramentas que mandam mensagem FECHAM o turno.
//
// As que não mandam (consultar_playbook, atualizar_ficha) devolvem resultado e o modelo
// segue — com teto de iterações, para uma consulta em círculo não virar conta aberta.
//
// A ORDEM DO TURNO, e cada passo existe por um motivo:
//   1. gatilho barato (regex) — opt-out e pedido de humano nem chegam ao modelo
//   2. janela — fora dela o turno é ADIADO, não perdido
//   3. contexto (playbook, exemplos, ficha, agenda livre)
//   4. modelo → uma ferramenta → validação → ação
//   5. registro em agent_decisoes, sempre, inclusive quando falha
// ============================================================

const MAX_ITERACOES = 4;
const MAX_TOKENS = 1500;

export type ResultadoTurno = {
  agiu: boolean;
  ferramenta?: string;
  saida?: string;
  motivo?: string;
  erro?: string;
  adiadoPara?: string;
  tokensIn?: number;
  tokensOut?: number;
  modelo?: string;
  ms: number;
};

/** Horários livres dos próximos dias úteis, para o modelo só poder oferecer o que existe. */
export function horariosLivres(janela: Janela, agora: Date, ocupados: string[], quantos = 6): string[] {
  const marcados = new Set(
    ocupados.map((o) => {
      const d = new Date(o);
      return Number.isNaN(d.getTime()) ? "" : `${d.toISOString().slice(0, 13)}`;
    })
  );
  const livres: string[] = [];
  // Começa amanhã: oferecer "hoje às 15h" numa conversa que ainda está começando é
  // apressado, e quase sempre o horário já passou quando ele responde.
  for (let dia = 1; dia <= 10 && livres.length < quantos; dia++) {
    for (let h = janela.inicio; h < janela.fim && livres.length < quantos; h++) {
      const d = new Date(agora.getTime() + dia * 86400_000);
      const slot = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h + 3, 0, 0));
      if (!dentroDaJanelaAgente(janela, slot)) continue;
      if (slot.getTime() <= agora.getTime()) continue;
      if (marcados.has(slot.toISOString().slice(0, 13))) continue;
      livres.push(slot.toISOString());
    }
  }
  return livres;
}

/**
 * Processa UM turno de UMA conversa.
 *
 * `enviarReal` é injetado para o motor poder ser exercitado ponta a ponta sem que uma
 * única mensagem saia — é o que torna o modo sombra e os testes possíveis com o mesmo
 * caminho de código, em vez de dois caminhos que divergem.
 */
export async function processarTurno(
  admin: any,
  input: {
    conversaId: string;
    tenantId: string;
    agora?: Date;
    /** null = modo sombra: rascunha e registra, não envia */
    enviarReal:
      | ((texto: string) => Promise<{ ok?: boolean; error?: string }>)
      | null;
    /** injetável para teste; em produção é a API de verdade */
    chamarModelo?: (params: Anthropic.MessageCreateParams) => Promise<Anthropic.Message>;
    dormirMs?: (ms: number) => Promise<void>;
    presenca?: (ms: number) => Promise<void>;
  }
): Promise<ResultadoTurno> {
  const t0 = Date.now();
  const agora = input.agora || new Date();
  const dorme = input.dormirMs || dormir;

  const registrar = async (linha: Record<string, any>) => {
    try {
      await admin.from("agent_decisoes").insert({ tenant_id: input.tenantId, conversa_id: input.conversaId, ...linha });
    } catch { /* log que falha não pode derrubar o turno */ }
  };

  // ---------- 1. carregar tudo ----------
  const { data: conv } = await admin
    .from("agent_conversas")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.conversaId)
    .maybeSingle();
  if (!conv) return { agiu: false, erro: "conversa não encontrada", ms: Date.now() - t0 };

  const { data: cfg } = await admin.from("agent_config").select("*").eq("tenant_id", input.tenantId).maybeSingle();
  if (!cfg?.ativo) return { agiu: false, erro: "agente desligado", ms: Date.now() - t0 };

  const sombra = conv.status === "sombra" || !input.enviarReal;
  if (conv.status !== "agente" && conv.status !== "sombra") {
    return { agiu: false, erro: `conversa em status "${conv.status}" — o agente não conduz`, ms: Date.now() - t0 };
  }

  const janela: Janela = {
    inicio: Number(cfg.wa_hora_inicio ?? 9),
    fim: Number(cfg.wa_hora_fim ?? 18),
    dias: String(cfg.wa_dias ?? "1,2,3,4,5").split(",").map((d: string) => Number(d.trim())).filter((d: number) => d >= 0 && d <= 6),
  };

  // ---------- 2. janela: adiar, nunca responder de madrugada ----------
  if (!dentroDaJanelaAgente(janela, agora)) {
    const abre = proximaAberturaAgente(janela, agora);
    // some minutos sorteados para a fila não estourar toda às 9h00 cravadas
    const comJitter = new Date(abre.getTime() + Math.floor(Math.random() * 15 * 60_000));
    await admin.from("agent_conversas")
      .update({ due_at: comJitter.toISOString(), lock_em: null, lock_por: null })
      .eq("tenant_id", input.tenantId).eq("id", input.conversaId);
    return { agiu: false, adiadoPara: comJitter.toISOString(), ms: Date.now() - t0 };
  }

  // contato, mensagens, playbook, exemplos
  const [{ data: contato }, { data: msgs }] = await Promise.all([
    conv.contact_id
      ? admin.from("contacts").select("id, name, company, role_title, cnpj, custom, notes").eq("tenant_id", input.tenantId).eq("id", conv.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("whatsapp_messages")
      .select("direction, text, created_at")
      .eq("tenant_id", input.tenantId)
      .eq(conv.contact_id ? "contact_id" : "phone", conv.contact_id || conv.phone)
      .order("created_at", { ascending: false })
      .limit(14),
  ]);

  const historico = (((msgs as any[]) || []).slice().reverse())
    .map((m) => ({ de: m.direction === "in" ? ("lead" as const) : ("nos" as const), texto: m.text || "" }))
    .filter((m) => m.texto);

  const ultimaDoLead = [...historico].reverse().find((m) => m.de === "lead")?.texto || "";

  // ---------- 3. gatilhos: o modelo nem vê ----------
  const disparo = avaliarGatilhos(ultimaDoLead);
  if (disparo) {
    const amb = await montarAmbiente(admin, input, conv, cfg, janela, agora, ultimaDoLead, sombra);
    const nome = disparo.gatilho === "opt_out" ? "marcar_opt_out" : "transferir_humano";
    const r = await executar(nome, { motivo: disparo.motivo }, amb);
    await aplicarPatch(admin, input, r.patchConversa, true);
    await registrar({
      contact_id: conv.contact_id, entrada: ultimaDoLead, ferramenta: `gatilho:${nome}`,
      argumentos: { gatilho: disparo.gatilho }, saida: r.saida, motivo: disparo.motivo,
      tokens_in: 0, tokens_out: 0, ms: Date.now() - t0,
    });
    return { agiu: true, ferramenta: nome, saida: r.saida, motivo: disparo.motivo, ms: Date.now() - t0 };
  }

  // ---------- 4. contexto e modelo ----------
  const { data: pbRow } = conv.contact_id
    ? await admin.from("agent_playbooks").select("*, products(name)").eq("tenant_id", input.tenantId).eq("ativo", true).limit(1).maybeSingle()
    : { data: null };

  const { data: exemplos } = await admin
    .from("agent_exemplos").select("caminho, peso")
    .eq("tenant_id", input.tenantId).eq("ativo", true)
    .order("peso", { ascending: false }).limit(3);

  const { data: reunioes } = await admin
    .from("meetings").select("datetime").eq("tenant_id", input.tenantId)
    .gte("datetime", agora.toISOString()).neq("status", "cancelada");
  const ocupados = ((reunioes as any[]) || []).map((m) => m.datetime);

  const precos = ((pbRow?.precos as any[]) || []).map((p: any) => ({ plano: String(p?.plano ?? ""), valor: Number(p?.valor) || 0 }));

  const ctx: ContextoTurno = {
    persona: { nome: cfg.persona_nome || "Ana", cargo: cfg.persona_cargo || "" },
    contato: {
      nome: (contato as any)?.name || conv.phone,
      empresa: (contato as any)?.company || null,
      cargo: (contato as any)?.role_title || null,
      cidade: ((contato as any)?.custom || {})?.cidade || null,
      cnae: ((contato as any)?.custom || {})?.cnae || null,
    },
    conversa: {
      etapa: conv.etapa_atual, objetivo: conv.objetivo, resumo: conv.resumo_rolante,
      msgsHoje: conv.msgs_hoje_em === agora.toISOString().slice(0, 10) ? conv.msgs_hoje || 0 : 0,
      maxMsgsDia: Number(cfg.max_msgs_dia_por_conversa ?? 6),
      followups: conv.followups_sem_resposta || 0,
      maxFollowups: Number(cfg.max_followups_sem_resposta ?? 3),
    },
    playbook: pbRow
      ? {
          produto: (pbRow as any).products?.name || "produto",
          etapas: ((pbRow as any).etapas || []).map(String),
          argumentos: ((pbRow as any).argumentos || []).map(String),
          objecoes: ((pbRow as any).objecoes || []).map((o: any) => ({ objecao: String(o?.objecao ?? ""), resposta: String(o?.resposta ?? "") })),
          precos,
          regrasDuras: ((pbRow as any).regras_duras || []).map(String),
        }
      : null,
    exemplos: ((exemplos as any[]) || []).map((e) => ({ caminho: e.caminho, peso: e.peso })),
    horariosLivres: horariosLivres(janela, agora, ocupados),
    tetoDescontoPct: Number(cfg.teto_desconto_pct ?? 0),
    ultimasMensagens: historico,
  };

  const amb = await montarAmbiente(admin, input, conv, cfg, janela, agora, ultimaDoLead, sombra);

  // Negociação sobe de modelo. A conta que justifica: um turno a mais no modelo forte
  // custa centavos; perder um fechamento por uma resposta fraca custa a venda.
  const negociando = /pre[çc]o|valor|quanto|desconto|contrat|fech|proposta|plano/i.test(ultimaDoLead);
  const modelo = negociando ? (cfg.modelo_negociacao || "claude-sonnet-5") : (cfg.modelo_dialogo || "claude-haiku-4-5");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const chamar = input.chamarModelo || ((p: Anthropic.MessageCreateParams) => client.messages.create(p) as Promise<Anthropic.Message>);

  const mensagens: Anthropic.MessageParam[] = montarMensagens(ctx) as Anthropic.MessageParam[];
  const system = montarSystem(ctx);

  let tokensIn = 0, tokensOut = 0;
  let ultimaFerramenta = "", ultimoMotivo = "", ultimaSaida = "";

  try {
    for (let i = 0; i < MAX_ITERACOES; i++) {
      const resp = await chamar({
        model: modelo,
        max_tokens: MAX_TOKENS,
        system,
        messages: mensagens,
        tools: FERRAMENTAS,
        // Força UMA ferramenta e só uma: sem isto o modelo pode responder em texto solto
        // (que não chega a lugar nenhum) ou pedir duas ações no mesmo turno.
        tool_choice: { type: "any", disable_parallel_tool_use: true },
      });

      tokensIn += resp.usage?.input_tokens || 0;
      tokensOut += resp.usage?.output_tokens || 0;

      const uso = resp.content.find((b: any) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
      if (!uso) {
        ultimoMotivo = "modelo não chamou ferramenta";
        break;
      }

      ultimaFerramenta = uso.name;
      ultimoMotivo = String((uso.input as any)?.motivo ?? "");

      const r = await executar(uso.name, uso.input, amb);
      if (r.saida) ultimaSaida = r.saida;
      await aplicarPatch(admin, input, r.patchConversa, r.fecha);

      if (r.fecha) {
        await registrar({
          contact_id: conv.contact_id, entrada: ultimaDoLead, ferramenta: uso.name,
          argumentos: uso.input as any, saida: r.saida, motivo: ultimoMotivo,
          modelo, tokens_in: tokensIn, tokens_out: tokensOut, ms: Date.now() - t0,
        });
        return { agiu: r.ok, ferramenta: uso.name, saida: r.saida, motivo: ultimoMotivo, modelo, tokensIn, tokensOut, ms: Date.now() - t0 };
      }

      // não fechou: devolve o resultado e deixa o modelo continuar
      mensagens.push({ role: "assistant", content: resp.content });
      mensagens.push({ role: "user", content: [{ type: "tool_result", tool_use_id: uso.id, content: r.paraOModelo }] });
    }

    // Estourou o teto sem mandar nada. Não é erro do lead nem falha de rede — é o modelo
    // andando em círculo, e o certo é parar de gastar e deixar registrado.
    await registrar({
      contact_id: conv.contact_id, entrada: ultimaDoLead, ferramenta: ultimaFerramenta || "(nenhuma)",
      motivo: ultimoMotivo, modelo, tokens_in: tokensIn, tokens_out: tokensOut, ms: Date.now() - t0,
      erro: `turno encerrado sem enviar após ${MAX_ITERACOES} iterações`,
    });
    await admin.from("agent_conversas")
      .update({ due_at: null, lock_em: null, lock_por: null, turno_erros: (conv.turno_erros || 0) + 1 })
      .eq("tenant_id", input.tenantId).eq("id", input.conversaId);
    return { agiu: false, erro: "sem ação após o teto de iterações", modelo, tokensIn, tokensOut, ms: Date.now() - t0 };
  } catch (e: any) {
    const erro = e?.message || String(e);
    await registrar({
      contact_id: conv.contact_id, entrada: ultimaDoLead, ferramenta: ultimaFerramenta || "(erro)",
      motivo: ultimoMotivo, modelo, tokens_in: tokensIn, tokens_out: tokensOut, ms: Date.now() - t0, erro,
    });
    // A API falhou: o turno VOLTA para a fila em vez de sumir. Ninguém recebe resposta
    // pela metade, e a conversa não fica órfã.
    const erros = (conv.turno_erros || 0) + 1;
    await admin.from("agent_conversas").update(
      erros >= 3
        ? { due_at: null, lock_em: null, lock_por: null, turno_erros: erros, status: "humano" }
        : { due_at: new Date(agora.getTime() + 5 * 60_000).toISOString(), lock_em: null, lock_por: null, turno_erros: erros }
    ).eq("tenant_id", input.tenantId).eq("id", input.conversaId);
    return { agiu: false, erro, modelo, tokensIn, tokensOut, ms: Date.now() - t0 };
  }
}

// ---------- auxiliares ----------

async function aplicarPatch(admin: any, input: { tenantId: string; conversaId: string }, patch: Record<string, any> | undefined, fecha: boolean) {
  const p: Record<string, any> = { ...(patch || {}) };
  if (fecha) { p.due_at = null; p.lock_em = null; p.lock_por = null; p.turno_erros = 0; }
  if (!Object.keys(p).length) return;
  await admin.from("agent_conversas").update(p).eq("tenant_id", input.tenantId).eq("id", input.conversaId);
}

async function montarAmbiente(
  admin: any,
  input: { tenantId: string; conversaId: string; enviarReal: any; dormirMs?: (ms: number) => Promise<void>; presenca?: (ms: number) => Promise<void> },
  conv: any, cfg: any, janela: Janela, agora: Date, ultimaDoLead: string, sombra: boolean
): Promise<Ambiente> {
  const dorme = input.dormirMs || dormir;
  const hoje = agora.toISOString().slice(0, 10);
  const msgsHoje = conv.msgs_hoje_em === hoje ? conv.msgs_hoje || 0 : 0;

  const { data: pb } = await admin
    .from("agent_playbooks").select("objecoes, argumentos, precos")
    .eq("tenant_id", input.tenantId).eq("ativo", true).limit(1).maybeSingle();

  const precos = ((pb as any)?.precos || []).map((p: any) => ({ plano: String(p?.plano ?? ""), valor: Number(p?.valor) || 0 }));

  const { data: prodRow } = await admin
    .from("agent_playbooks").select("produto_id, products(name)")
    .eq("tenant_id", input.tenantId).eq("ativo", true).limit(1).maybeSingle();

  return {
    admin,
    tenantId: input.tenantId,
    conversaId: input.conversaId,
    contactId: conv.contact_id,
    phone: conv.phone,
    accountId: conv.account_id,
    cfg: {
      maxMsgsDia: Number(cfg.max_msgs_dia_por_conversa ?? 6),
      tetoDescontoPct: Number(cfg.teto_desconto_pct ?? 0),
      // null quando não configurado — e `checarValorFechamento` trata null como
      // "não fecha nada sozinho", que é o padrão seguro.
      valorMaxFechar: cfg.valor_max_fechar === null || cfg.valor_max_fechar === undefined ? null : Number(cfg.valor_max_fechar),
      janela,
    },
    propostaPendente: conv.proposta_pendente ?? null,
    propostaEm: conv.proposta_em ?? null,
    produto: { id: (prodRow as any)?.produto_id ?? null, nome: (prodRow as any)?.products?.name ?? null },
    ultimaDoLead,
    msgsHoje,
    precosTabela: precos.map((p: any) => p.valor).filter((v: number) => v > 0),
    playbook: pb
      ? {
          objecoes: ((pb as any).objecoes || []).map((o: any) => ({ objecao: String(o?.objecao ?? ""), resposta: String(o?.resposta ?? "") })),
          argumentos: ((pb as any).argumentos || []).map(String),
          precos,
        }
      : null,
    valoresDoLead: valoresNoTexto(ultimaDoLead),
    agora,

    // ---------- o envio humanizado ----------
    enviar: async (texto: string) => {
      const baloes = quebrarEmBaloes(texto);

      // MODO SOMBRA: passa por tudo — travas, quebra, registro — e não manda. É a mesma
      // estrada, sem o último metro; é isso que faz o ensaio valer para o dia real.
      if (sombra || !input.enviarReal) {
        await admin.from("agent_decisoes").insert({
          tenant_id: input.tenantId, conversa_id: input.conversaId,
          ferramenta: "sombra:responder", saida: baloes.join("\n---\n"),
          motivo: "modo sombra: rascunhado, não enviado", argumentos: { baloes: baloes.length },
        });
        return { ok: true };
      }

      await dorme(esperaAntesDeResponder(texto.length, { minS: Number(cfg.delay_min_s ?? 45), maxS: Number(cfg.delay_max_s ?? 240) }));

      for (let i = 0; i < baloes.length; i++) {
        const b = baloes[i];
        const digitando = tempoDigitando(b);
        if (input.presenca) await input.presenca(digitando);
        await dorme(digitando);

        const r = await input.enviarReal(b);
        if (r?.error) return r;

        // cada balão conta como mensagem nossa no estado da conversa
        await tocarConversa(admin, {
          tenantId: input.tenantId, accountId: conv.account_id, contactId: conv.contact_id,
          phone: conv.phone, direcao: "out",
        });
        if (i < baloes.length - 1) await dorme(600 + Math.floor(Math.random() * 900));
      }
      return { ok: true };
    },
  };
}
