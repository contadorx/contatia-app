"use server";

import { msgErro } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ehDesfecho, type Desfecho } from "@/lib/agente/desfechos";

// ============================================================
// OS BOTÕES DE OPERAÇÃO DA CONVERSA
//
// Não são fases de um fluxo — são controles, e existem para o dia em que o agente
// estiver errado. A espec pede três; aqui estão os que fazem sentido ANTES do motor
// existir (F1): assumir, devolver, encerrar com desfecho.
//
// `agente` e `sombra` não aparecem: não há motor para receber a conversa, e um botão
// que promete condução automática e não entrega é pior que botão nenhum. Eles entram
// no F2, junto com quem os cumpre.
// ============================================================

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

/** Esta conversa é minha. O agente (quando existir) cala nela na hora. */
export async function assumirConversa(id: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { error } = await supabase
    .from("agent_conversas")
    .update({ status: "humano", assumida_por: user_id || null, assumida_em: new Date().toISOString() })
    .eq("tenant_id", tenant_id)
    .eq("id", id);
  if (error) return { error: msgErro(error) };

  revalidatePath("/dashboard/conversas");
  return { ok: true };
}

/**
 * Saí de cima dela.
 *
 * Vai para `pausada`, não para `agente`: enquanto não há motor, "devolver" só pode
 * significar "não estou mais conduzindo". Devolver para um robô que não existe deixaria
 * o lead sem ninguém — e a tela mentindo que alguém cuida.
 */
export async function devolverConversa(id: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { error } = await supabase
    .from("agent_conversas")
    .update({ status: "pausada", assumida_por: null, assumida_em: null })
    .eq("tenant_id", tenant_id)
    .eq("id", id);
  if (error) return { error: msgErro(error) };

  revalidatePath("/dashboard/conversas");
  return { ok: true };
}

/**
 * Acabou — e por quê.
 *
 * O desfecho não é enfeite de relatório: é a matéria-prima do aprendizado (F5). Won e
 * reunião viram candidatos a exemplo; recusa e opt-out viram anti-padrão. Registrar
 * isso desde o F1 é o que faz o destilador ter história para ler quando chegar, em vez
 * de começar do zero.
 */
export async function encerrarConversa(id: string, desfecho: Desfecho) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  // A validação é em CÓDIGO, não em confiança no que a tela mandou — a mesma regra
  // que a 0116 repete como check constraint no banco.
  if (!ehDesfecho(desfecho)) return { error: "Desfecho inválido." };

  const { error } = await supabase
    .from("agent_conversas")
    .update({ status: "encerrada", desfecho })
    .eq("tenant_id", tenant_id)
    .eq("id", id);
  if (error) return { error: msgErro(error) };

  revalidatePath("/dashboard/conversas");
  return { ok: true };
}

/**
 * Reabre uma conversa encerrada, na mão.
 *
 * O desfecho FICA. Ele aconteceu — a reunião foi marcada, a recusa foi dita —, e
 * apagá-lo porque a conversa voltou seria reescrever o histórico. É a mesma regra que
 * o webhook aplica quando o lead volta a escrever sozinho.
 */
export async function reabrirConversa(id: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { error } = await supabase
    .from("agent_conversas")
    .update({ status: "humano", assumida_por: user_id || null, assumida_em: new Date().toISOString() })
    .eq("tenant_id", tenant_id)
    .eq("id", id);
  if (error) return { error: msgErro(error) };

  revalidatePath("/dashboard/conversas");
  return { ok: true };
}
