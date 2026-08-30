import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import {
  checarTexto, checarPreco, checarCapDiario, checarReuniao, filtrarFicha,
  valoresNoTexto, type Janela,
} from "@/lib/agente/travas";

// ============================================================
// AS FERRAMENTAS DO AGENTE — uma ação por turno
//
// Cada ferramenta tem duas metades que precisam ser lidas juntas:
//
//   · a DEFINIÇÃO, que o modelo vê. É persuasão: explica quando usar.
//   · o EXECUTOR, que roda depois. É garantia: valida antes de agir.
//
// A definição pode ser ignorada pelo modelo; o executor não. Por isso toda regra que
// custa dinheiro ou é irreversível aparece nos dois lugares — dizer e depois conferir.
//
// QUANDO O EXECUTOR RECUSA, o turno NÃO morre: a recusa volta ao modelo como resultado
// da ferramenta, com o motivo em português, e ele tenta de novo. É a diferença entre
// "o agente errou o preço e mandou" e "o agente tentou errar o preço e foi corrigido
// antes de qualquer coisa sair" — e o segundo caso fica registrado em agent_decisoes.
// ============================================================

export type ResultadoFerramenta = {
  ok: boolean;
  /** o que volta para o modelo como tool_result */
  paraOModelo: string;
  /** o que efetivamente aconteceu, para o log e para a tela */
  saida?: string;
  /** encerra o turno? responder/encerrar/opt-out encerram; consultar_playbook não. */
  fecha: boolean;
  /** mudanças a aplicar na conversa */
  patchConversa?: Record<string, any>;
};

export type Ambiente = {
  admin: any;
  tenantId: string;
  conversaId: string;
  contactId: string | null;
  phone: string;
  accountId: string | null;
  cfg: {
    maxMsgsDia: number;
    tetoDescontoPct: number;
    janela: Janela;
  };
  msgsHoje: number;
  precosTabela: number[];
  playbook: { objecoes: { objecao: string; resposta: string }[]; argumentos: string[]; precos: { plano: string; valor: number }[] } | null;
  /** valores que o lead citou neste turno — repetir a proposta dele não é inventar preço */
  valoresDoLead: number[];
  agora: Date;
  /** manda a mensagem de verdade (injetado para o motor poder ser testado sem enviar nada) */
  enviar: (texto: string) => Promise<{ ok?: boolean; error?: string }>;
};

// ============================================================
// DEFINIÇÕES
// ============================================================
export const FERRAMENTAS: Anthropic.Tool[] = [
  {
    name: "responder",
    description:
      "Manda uma mensagem para o lead no WhatsApp. Use para conduzir a conversa: perguntar, explicar, responder objeção. " +
      "Mensagem curta (1 a 3 frases) e no máximo UMA pergunta. Só cite preços que estejam na tabela do playbook — " +
      "valores fora da tabela são recusados automaticamente e você terá que reescrever.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "A mensagem, já pronta para enviar. Sem placeholders, sem assinatura." },
        motivo: { type: "string", description: "Em uma frase, por que esta é a próxima jogada certa." },
      },
      required: ["texto", "motivo"],
    },
  },
  {
    name: "consultar_playbook",
    description:
      "Consulta o playbook antes de responder: preço de um plano, argumento para um tema, ou a resposta-modelo de uma objeção. " +
      "Use SEMPRE que for falar de valores. Esta ferramenta não manda mensagem nenhuma — depois dela você ainda precisa responder.",
    input_schema: {
      type: "object",
      properties: {
        tema: { type: "string", description: "O que você quer saber. Ex: 'preço', 'já tenho contador', 'prazo'." },
      },
      required: ["tema"],
    },
  },
  {
    name: "agendar_reuniao",
    description:
      "Marca a reunião, depois que o lead concordou com um horário. Use SOMENTE um dos horários livres listados no contexto — " +
      "qualquer outro é recusado. Se ele sugerir horário que não está na lista, responda oferecendo os que estão.",
    input_schema: {
      type: "object",
      properties: {
        quando: { type: "string", description: "Data e hora em ISO 8601, exatamente como aparece na lista de horários livres." },
        titulo: { type: "string", description: "Título curto da reunião." },
        motivo: { type: "string", description: "Por que agora." },
      },
      required: ["quando", "titulo", "motivo"],
    },
  },
  {
    name: "atualizar_ficha",
    description:
      "Guarda o que você descobriu sobre o contato (cargo, empresa, e-mail, observação). Não manda mensagem — " +
      "depois de atualizar você ainda precisa responder.",
    input_schema: {
      type: "object",
      properties: {
        campos: {
          type: "object",
          description: "Só os campos permitidos listados no contexto. Qualquer outro é ignorado.",
          additionalProperties: true,
        },
        motivo: { type: "string" },
      },
      required: ["campos", "motivo"],
    },
  },
  {
    name: "transferir_humano",
    description:
      "Passa a conversa para uma pessoa do time e para de responder. Use quando: o lead quer FECHAR (você não fecha), " +
      "quando pede desconto além do que você pode dar, quando pede falar com alguém, ou quando a conversa saiu do que você sabe.",
    input_schema: {
      type: "object",
      properties: { motivo: { type: "string", description: "O que a pessoa precisa saber para assumir." } },
      required: ["motivo"],
    },
  },
  {
    name: "marcar_opt_out",
    description:
      "O lead pediu para não receber mais. Tira ele de todas as automações, definitivamente. Irreversível — " +
      "use só quando o pedido for claro, nunca por desinteresse momentâneo ('vou pensar' NÃO é opt-out).",
    input_schema: {
      type: "object",
      properties: { motivo: { type: "string" } },
      required: ["motivo"],
    },
  },
  {
    name: "encerrar",
    description:
      "Fecha a conversa com porta aberta. Use quando o assunto acabou, quando o lead sumiu depois dos follow-ups, " +
      "ou quando ele recusou com clareza. Manda uma última mensagem cordial e para.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "A mensagem de despedida, curta e sem cobrança." },
        desfecho: { type: "string", enum: ["reuniao", "venda", "recusa", "silencio", "opt_out"], description: "Como terminou." },
        motivo: { type: "string" },
      },
      required: ["texto", "desfecho", "motivo"],
    },
  },
];

// ============================================================
// EXECUÇÃO
// ============================================================

const recusa = (motivo: string): ResultadoFerramenta => ({
  ok: false,
  paraOModelo: `RECUSADO: ${motivo} Corrija e chame a ferramenta de novo.`,
  fecha: false,
});

/** Valida uma mensagem antes de qualquer coisa sair. Usada por `responder` e `encerrar`. */
function validarMensagem(amb: Ambiente, texto: string): string | null {
  const forma = checarTexto(texto);
  if (!forma.ok) return forma.motivo!;

  const preco = checarPreco(texto, {
    precosTabela: amb.precosTabela,
    tetoDescontoPct: amb.cfg.tetoDescontoPct,
    ditosPeloLead: amb.valoresDoLead,
  });
  if (!preco.ok) return preco.motivo!;

  return null;
}

export async function executar(
  nome: string,
  args: any,
  amb: Ambiente
): Promise<ResultadoFerramenta> {
  switch (nome) {
    // ----------------------------------------------------------
    case "responder": {
      const texto = String(args?.texto ?? "");

      const cap = checarCapDiario(amb.msgsHoje, amb.cfg.maxMsgsDia);
      if (!cap.ok) {
        // Não é recusa para o modelo tentar de novo — é fim de turno. Insistir aqui só
        // gastaria tokens para bater no mesmo teto.
        return { ok: false, paraOModelo: cap.motivo!, fecha: true, saida: `(não enviado: ${cap.motivo})` };
      }

      const erro = validarMensagem(amb, texto);
      if (erro) return recusa(erro);

      const r = await amb.enviar(texto);
      if (r.error) {
        return { ok: false, paraOModelo: `Falha ao enviar: ${r.error}`, fecha: true, saida: `(falha: ${r.error})` };
      }
      return { ok: true, paraOModelo: "Mensagem enviada.", saida: texto, fecha: true };
    }

    // ----------------------------------------------------------
    case "consultar_playbook": {
      const tema = String(args?.tema ?? "").toLowerCase().trim();
      if (!amb.playbook) return { ok: true, paraOModelo: "Não há playbook para este contato. Não fale de preço.", fecha: false };

      const partes: string[] = [];
      const p = amb.playbook;

      if (p.precos.length && /pre[çc]o|valor|plano|quanto|custa|mensalidade/.test(tema)) {
        partes.push("Tabela: " + p.precos.map((x) => `${x.plano} R$ ${x.valor}`).join(" · "));
        partes.push(
          amb.cfg.tetoDescontoPct > 0
            ? `Desconto autorizado: até ${amb.cfg.tetoDescontoPct}%.`
            : "Sem desconto autorizado."
        );
      }
      const obj = p.objecoes.filter((o) => tema && (o.objecao.toLowerCase().includes(tema) || tema.includes(o.objecao.toLowerCase())));
      for (const o of obj.slice(0, 3)) partes.push(`Objeção "${o.objecao}": ${o.resposta}`);

      if (!partes.length) {
        // Sem correspondência, devolve o material geral em vez de "não achei": o modelo
        // pediu ajuda e voltar de mãos vazias o empurra para improvisar.
        if (p.argumentos.length) partes.push("Argumentos: " + p.argumentos.slice(0, 5).join(" · "));
        if (p.precos.length) partes.push("Tabela: " + p.precos.map((x) => `${x.plano} R$ ${x.valor}`).join(" · "));
      }
      return { ok: true, paraOModelo: partes.join("\n") || "Playbook sem conteúdo para este tema.", fecha: false };
    }

    // ----------------------------------------------------------
    case "agendar_reuniao": {
      const quando = String(args?.quando ?? "");
      const titulo = String(args?.titulo ?? "Reunião").slice(0, 120);

      const { data: existentes } = await amb.admin
        .from("meetings")
        .select("datetime")
        .eq("tenant_id", amb.tenantId)
        .gte("datetime", amb.agora.toISOString())
        .neq("status", "cancelada");

      const check = checarReuniao(quando, {
        janela: amb.cfg.janela,
        agora: amb.agora,
        ocupados: ((existentes as any[]) || []).map((m) => m.datetime),
      });
      if (!check.ok) return recusa(check.motivo!);

      const { error } = await amb.admin.from("meetings").insert({
        tenant_id: amb.tenantId,
        contact_id: amb.contactId,
        title: titulo,
        datetime: check.quando!.toISOString(),
        duration_min: 30,
        status: "agendada",
        source: "agente",
      });
      if (error) return recusa(`não consegui gravar a reunião (${error.message}).`);

      return {
        ok: true,
        paraOModelo: `Reunião marcada para ${check.quando!.toISOString()}. Agora confirme com ele numa mensagem curta.`,
        saida: `Reunião marcada: ${titulo} em ${check.quando!.toISOString()}`,
        fecha: false,
        patchConversa: { etapa_atual: "reuniao_marcada", desfecho: "reuniao" },
      };
    }

    // ----------------------------------------------------------
    case "atualizar_ficha": {
      if (!amb.contactId) return recusa("este número ainda não é um contato cadastrado.");
      const { ok, limpo, recusados } = filtrarFicha(args?.campos || {});
      if (!ok) return recusa(`nenhum campo permitido. Recusados: ${recusados.join(", ") || "nenhum campo enviado"}.`);

      const { error } = await amb.admin.from("contacts").update(limpo).eq("tenant_id", amb.tenantId).eq("id", amb.contactId);
      if (error) return recusa(`não consegui gravar (${error.message}).`);

      return {
        ok: true,
        paraOModelo: `Ficha atualizada: ${Object.keys(limpo).join(", ")}.${recusados.length ? ` Ignorados: ${recusados.join(", ")}.` : ""} Agora responda ao lead.`,
        saida: `Ficha: ${JSON.stringify(limpo)}`,
        fecha: false,
      };
    }

    // ----------------------------------------------------------
    case "transferir_humano": {
      const motivo = String(args?.motivo ?? "").slice(0, 500);
      await amb.admin.from("events").insert({
        tenant_id: amb.tenantId,
        contact_id: amb.contactId,
        type: "note",
        meta: { text: `Agente transferiu a conversa para um humano: ${motivo}`, origem: "agente" },
      });
      return {
        ok: true,
        paraOModelo: "Conversa transferida.",
        saida: `Transferida para humano: ${motivo}`,
        fecha: true,
        patchConversa: { status: "humano", assumida_em: new Date().toISOString() },
      };
    }

    // ----------------------------------------------------------
    case "marcar_opt_out": {
      const motivo = String(args?.motivo ?? "").slice(0, 500);
      if (amb.contactId) {
        await amb.admin.from("contacts").update({ opted_out: true }).eq("tenant_id", amb.tenantId).eq("id", amb.contactId);
        // Cancela o que ainda estava agendado: opt-out que não para a cadência não é
        // opt-out, é uma promessa que o sistema quebra na semana seguinte.
        const { data: enrs } = await amb.admin
          .from("enrollments").select("id").eq("tenant_id", amb.tenantId).eq("contact_id", amb.contactId).eq("status", "active");
        for (const e of ((enrs as any[]) || [])) {
          await amb.admin.from("enrollments").update({ status: "stopped" }).eq("id", e.id);
          await amb.admin.from("tasks").update({ status: "skipped" }).eq("enrollment_id", e.id).eq("status", "pending");
        }
      }
      await amb.admin.from("whatsapp_blocklist")
        .upsert({ tenant_id: amb.tenantId, phone: amb.phone }, { onConflict: "tenant_id,phone", ignoreDuplicates: true });

      return {
        ok: true,
        paraOModelo: "Opt-out registrado. Não mande mais nada.",
        saida: `Opt-out: ${motivo}`,
        fecha: true,
        patchConversa: { status: "encerrada", desfecho: "opt_out", due_at: null },
      };
    }

    // ----------------------------------------------------------
    case "encerrar": {
      const texto = String(args?.texto ?? "");
      const desfecho = String(args?.desfecho ?? "silencio");
      const validos = ["reuniao", "venda", "recusa", "silencio", "opt_out"];
      if (!validos.includes(desfecho)) return recusa(`desfecho "${desfecho}" não existe. Use um de: ${validos.join(", ")}.`);

      // A despedida passa pelas mesmas travas: última mensagem também é mensagem, e é
      // justamente na despedida que um modelo tenta um "última chance por R$ 99".
      if (texto.trim()) {
        const erro = validarMensagem(amb, texto);
        if (erro) return recusa(erro);
        const cap = checarCapDiario(amb.msgsHoje, amb.cfg.maxMsgsDia);
        if (cap.ok) await amb.enviar(texto);
      }

      return {
        ok: true,
        paraOModelo: "Conversa encerrada.",
        saida: `Encerrada (${desfecho})${texto ? `: ${texto}` : ""}`,
        fecha: true,
        patchConversa: { status: "encerrada", desfecho, due_at: null },
      };
    }

    default:
      return recusa(`ferramenta "${nome}" não existe.`);
  }
}

export { valoresNoTexto };
