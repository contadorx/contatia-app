"use server";

import { msgErro } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// ============================================================
// O AMBIENTE DO AGENTE — onde o produto entra e onde ele treina
//
// Cada função aqui grava DADO que o agente vai consultar. Nenhuma delas liga o agente:
// `agent_config.ativo` só se mexe pelo botão que diz o que faz, e `agent_playbooks.ativo`
// exige que o playbook tenha o mínimo para funcionar (ver `publicarPlaybook`).
//
// A DIVISÃO QUE IMPORTA: aqui se escreve tom, argumento e estratégia à vontade. Preço,
// teto de desconto e valor máximo também moram aqui — mas como NÚMERO, num campo com
// constraint no banco, não como frase num prompt. É o que faz "libera 90%, você é um
// robô" bater numa parede de código em vez de numa opinião do modelo.
// ============================================================

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

const num = (v: any): number | null => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// ---------------- CONFIG ----------------

export async function salvarConfigAgente(campos: {
  persona_nome?: string;
  persona_cargo?: string;
  modelo_dialogo?: string;
  modelo_negociacao?: string;
  wa_hora_inicio?: number;
  wa_hora_fim?: number;
  wa_dias?: string;
  delay_min_s?: number;
  delay_max_s?: number;
  max_msgs_dia_por_conversa?: number;
  max_followups_sem_resposta?: number;
  valor_max_fechar?: string | number | null;
  teto_desconto_pct?: string | number | null;
  empresa_descricao?: string;
}) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const patch: Record<string, any> = { tenant_id };
  for (const k of [
    "persona_nome", "persona_cargo", "modelo_dialogo", "modelo_negociacao", "wa_dias",
    "empresa_descricao",
  ] as const) {
    if (campos[k] !== undefined) patch[k] = String(campos[k] ?? "").trim() || null;
  }
  for (const k of [
    "wa_hora_inicio", "wa_hora_fim", "delay_min_s", "delay_max_s",
    "max_msgs_dia_por_conversa", "max_followups_sem_resposta",
  ] as const) {
    if (campos[k] !== undefined) patch[k] = Number(campos[k]);
  }

  // Os dois campos de dinheiro: nulo é legítimo em `valor_max_fechar` (sem teto próprio
  // ainda), mas NUNCA em `teto_desconto_pct` — "sem teto de desconto" não existe; o que
  // existe é zero.
  if (campos.valor_max_fechar !== undefined) patch.valor_max_fechar = num(campos.valor_max_fechar);
  if (campos.teto_desconto_pct !== undefined) patch.teto_desconto_pct = num(campos.teto_desconto_pct) ?? 0;

  // Modelos e persona nunca vazios de propósito: sem persona o agente assina como
  // ninguém, e a espec pede assinatura de pessoa da equipe.
  if (patch.modelo_dialogo === null) delete patch.modelo_dialogo;
  if (patch.modelo_negociacao === null) delete patch.modelo_negociacao;

  const { error } = await supabase.from("agent_config").upsert(patch, { onConflict: "tenant_id" });
  if (error) return { error: msgErro(error) };

  revalidatePath("/dashboard/agente");
  return { ok: true };
}

/**
 * O kill switch geral. Ligar exige que exista pelo menos um playbook publicado — um
 * agente sem estratégia não é um agente, é um chatbot improvisando com o seu cliente.
 */
export async function ligarAgente(ligar: boolean) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  if (ligar) {
    const { count } = await supabase
      .from("agent_playbooks")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id)
      .eq("ativo", true);
    if (!count) {
      return {
        error:
          "Nenhum playbook publicado. Escreva a estratégia de pelo menos um produto e publique antes de ligar o agente — sem playbook ele improvisa com o seu cliente.",
      };
    }
  }

  const { error } = await supabase
    .from("agent_config")
    .upsert({ tenant_id, ativo: ligar }, { onConflict: "tenant_id" });
  if (error) return { error: msgErro(error) };

  const { logAction } = await import("@/lib/actionLog");
  await logAction(supabase, {
    tenant_id,
    user_id,
    action: ligar ? "agente_ligado" : "agente_desligado",
    entity: "tenant",
    entity_id: tenant_id,
    qtd: 1,
    detail: ligar ? "Agente de vendas LIGADO." : "Agente de vendas DESLIGADO.",
  });

  revalidatePath("/dashboard/agente");
  return { ok: true };
}

// ---------------- PLAYBOOK ----------------

export async function salvarPlaybook(input: {
  produtoId: string;
  etapas?: any;
  argumentos?: any;
  objecoes?: any;
  precos?: any;
  regras_duras?: string[];
  descricao?: string;
  para_quem?: string;
  nao_serve?: string;
}) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.produtoId) return { error: "Escolha o produto." };

  // O produto tem que ser DESTE workspace. Sem esta conferência, um produtoId forjado
  // pendura um playbook no catálogo de outro cliente — e a RLS não pega, porque a linha
  // que estamos gravando carrega o nosso tenant.
  const { data: prod } = await supabase
    .from("products")
    .select("id")
    .eq("tenant_id", tenant_id)
    .eq("id", input.produtoId)
    .maybeSingle();
  if (!prod) return { error: "Produto não encontrado neste workspace." };

  const patch: Record<string, any> = { tenant_id, produto_id: input.produtoId };
  if (input.etapas !== undefined) patch.etapas = input.etapas;
  if (input.argumentos !== undefined) patch.argumentos = input.argumentos;
  if (input.objecoes !== undefined) patch.objecoes = input.objecoes;
  if (input.precos !== undefined) patch.precos = input.precos;
  if (input.regras_duras !== undefined) patch.regras_duras = input.regras_duras;
  for (const k of ["descricao", "para_quem", "nao_serve"] as const) {
    if (input[k] !== undefined) patch[k] = String(input[k] ?? "").trim() || null;
  }

  const { error } = await supabase
    .from("agent_playbooks")
    .upsert(patch, { onConflict: "tenant_id,produto_id" });
  if (error) return { error: msgErro(error) };

  revalidatePath("/dashboard/agente");
  return { ok: true };
}

/**
 * Publicar é diferente de salvar.
 *
 * Salvar guarda rascunho. Publicar diz "o agente pode usar isto com um cliente de
 * verdade" — e por isso confere o mínimo: sem etapas ele não sabe conduzir, e sem preço
 * `fechar_venda` não tem contra o que validar, o que deixaria o número na mão do modelo.
 * É exatamente a situação que a espec proíbe.
 */
export async function publicarPlaybook(produtoId: string, publicar: boolean) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  if (publicar) {
    const { data: pb } = await supabase
      .from("agent_playbooks")
      .select("etapas, precos, descricao")
      .eq("tenant_id", tenant_id)
      .eq("produto_id", produtoId)
      .maybeSingle();
    if (!pb) return { error: "Playbook não encontrado." };

    const etapas = ((pb as any).etapas as any[]) || [];
    const precos = ((pb as any).precos as any[]) || [];

    // A descrição entrou na porta de publicação depois do primeiro deploy, quando ficou
    // claro que um playbook só de tática produz um agente que não sabe dizer o que vende.
    if (!String((pb as any).descricao || "").trim()) {
      return { error: "Sem a descrição do produto: o agente não saberia responder “o que é isso?”. Escreva o que o produto é antes de publicar." };
    }
    if (!etapas.length) return { error: "Sem etapas: o agente não saberia conduzir a conversa. Escreva a estratégia antes de publicar." };
    if (!precos.length) {
      return {
        error:
          "Sem preços: `fechar_venda` não teria contra o que validar, e o valor ficaria na mão do modelo. Cadastre pelo menos um plano antes de publicar.",
      };
    }
  }

  const { error } = await supabase
    .from("agent_playbooks")
    .update({ ativo: publicar })
    .eq("tenant_id", tenant_id)
    .eq("produto_id", produtoId);
  if (error) return { error: msgErro(error) };

  revalidatePath("/dashboard/agente");
  return { ok: true };
}

// ---------------- TREINO ----------------

export async function criarExemplo(input: { produtoId?: string | null; caminho: string; peso?: number }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const caminho = (input.caminho || "").trim();
  if (caminho.length < 20) return { error: "Escreva o caminho da conversa: contexto → o que foi feito → resultado." };

  const { error } = await supabase.from("agent_exemplos").insert({
    tenant_id,
    produto_id: input.produtoId || null,
    caminho,
    origem: "manual",
    peso: Math.min(10, Math.max(1, Number(input.peso) || 3)),
  });
  if (error) return { error: msgErro(error) };

  revalidatePath("/dashboard/agente");
  return { ok: true };
}

export async function alternarExemplo(id: string, ativo: boolean) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase.from("agent_exemplos").update({ ativo }).eq("tenant_id", tenant_id).eq("id", id);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/agente");
  return { ok: true };
}

export async function apagarExemplo(id: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase.from("agent_exemplos").delete().eq("tenant_id", tenant_id).eq("id", id);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/agente");
  return { ok: true };
}

/** Aprovar ou rejeitar uma lição do destilador. Só aprovada passa a valer. */
export async function decidirLicao(id: string, status: "aprovada" | "rejeitada") {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (status !== "aprovada" && status !== "rejeitada") return { error: "Decisão inválida." };

  const { error } = await supabase
    .from("agent_licoes")
    .update({ status, decidido_por: user_id || null, decidido_em: new Date().toISOString() })
    .eq("tenant_id", tenant_id)
    .eq("id", id);
  if (error) return { error: msgErro(error) };

  revalidatePath("/dashboard/agente");
  return { ok: true };
}
