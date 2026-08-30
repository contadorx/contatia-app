import "server-only";
import { scoreEvent } from "@/lib/scoring";

// ============================================================
// O MOTOR DE ENVIO DE UM TOQUE DE WHATSAPP — um só, para os dois caminhos
//
// Nasceu de dentro de `sendWhatsAppTask`. Precisou sair de lá por um motivo que o
// próprio arquivo já explicava para o e-mail: `task-actions.ts` é "use server", então
// toda função exportada dali vira uma server action chamável pelo navegador. O cron não
// pode importar de lá, e duplicar o motor seria pior — *"dois envios com regras que
// divergem no primeiro conserto feito só de um lado"*.
//
// A regra de negócio é IDÊNTICA nos dois caminhos: mesmas portas, mesmo cap diário,
// mesmo tratamento de "não tem WhatsApp", mesmo registro. Um parâmetro muda, e é o que
// importa: `automatico`.
//
// POR QUE `automatico` NÃO PAUSA O AGENTE: quando uma PESSOA escreve, o agente cala
// naquela conversa — duas vozes no mesmo fio é o pior resultado possível para quem lê.
// Mas a fila disparando um toque de cadência não é uma pessoa escrevendo. Se ela
// também pausasse, cada toque automático desligaria o agente da conversa que ele
// deveria conduzir — a fila sabotaria o agente sem ninguém entender por quê.
// ============================================================

export type ResultadoEnvioWa = {
  ok?: true;
  error?: string;
  semWhatsapp?: boolean;
  pulado?: boolean;
  phone?: string;
  contactId?: string | null;
};

export async function enviarTarefaWa(
  supabase: any,
  input: {
    tenantId: string;
    userId?: string | null;
    taskId: string;
    /** Instância já escolhida pelo chamador (instanciaDoUsuario no clique, ritmo no cron). */
    acc: { id: string; evolution_url: string; api_key: string; instance: string; daily_cap?: number | null };
    /** true = veio da fila, sem ninguém olhando. Ver o comentário do cabeçalho. */
    automatico?: boolean;
  }
): Promise<ResultadoEnvioWa> {
  const { tenantId, taskId, acc } = input;
  const userId = input.userId || null;

  const { data: task } = await supabase
    .from("tasks")
    .select("id, channel, generated_content, contact_id, enrollment_id, condicao, contacts(*)")
    .eq("tenant_id", tenantId)
    .eq("id", taskId)
    .single();
  if (!task) return { error: "Tarefa não encontrada." };
  if (task.channel !== "whatsapp") return { error: "Tarefa não é de WhatsApp." };

  {
    // mesma porta do e-mail: no WhatsApp o estrago é ainda mais visível
    const { textoTemLixo, AVISO_LIXO } = await import("@/lib/nomeValido");
    if (textoTemLixo((task as any).generated_content)) return { error: AVISO_LIXO };
  }

  if ((task as any).condicao) {
    const { avaliarCondicao, rotuloCondicao } = await import("@/lib/condicoes");
    const r = await avaliarCondicao(supabase, (task as any).condicao, {
      contactId: (task as any).contact_id,
      enrollmentId: (task as any).enrollment_id,
      contato: (task as any).contacts || {},
    });
    if (!r.ok) {
      await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId).eq("status", "pending");
      return {
        error: `Passo condicional (${rotuloCondicao((task as any).condicao)}): ${r.motivo}. Toque pulado.`,
        pulado: true,
      };
    }
  }

  const phone = (task as any).contacts?.phone as string | undefined;
  if (!phone) return { error: "Contato sem telefone." };

  // ---- opt-out e bloqueio: a fila não pode furar o que o clique respeita ----
  // No clique havia uma pessoa olhando a ficha; aqui não há ninguém. Quem pediu para
  // parar não pode receber um toque porque a tarefa já estava na fila quando ele pediu.
  if ((task as any).contacts?.opted_out) {
    await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId).eq("status", "pending");
    return { error: "Contato pediu para não receber mais (opt-out). Toque pulado.", pulado: true };
  }
  {
    const { data: bloq } = await supabase
      .from("whatsapp_blocklist")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("phone", phone)
      .maybeSingle();
    if (bloq) {
      await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId).eq("status", "pending");
      return { error: "Número na lista de bloqueio. Toque pulado.", pulado: true };
    }
  }

  // ---- cap diário ----
  // meia-noite BRT (UTC-3, fixo): o servidor roda em UTC — sem isso o "dia" do cap
  // resetaria às 21h de Brasília e o número poderia enviar 2x o limite num dia real.
  // O tenant é EXPLÍCITO: no cron não há RLS para fazer esse recorte.
  const BRT_OFFSET_MS = 3 * 3600000;
  const nowBRT = new Date(Date.now() - BRT_OFFSET_MS);
  const startOfDay = new Date(
    Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate()) + BRT_OFFSET_MS
  );
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("type", "whatsapp_sent")
    .gte("created_at", startOfDay.toISOString());
  if ((count ?? 0) >= (acc.daily_cap ?? 40)) {
    return { error: "Limite diário de WhatsApp atingido (anti-ban). Tente amanhã." };
  }

  // NÃO HÁ RESERVA POR STATUS DE TAREFA AQUI, e isso é escolha.
  //
  // O reflexo seria carimbar a tarefa como "enviando" antes de chamar o Evolution. Só
  // que `tasks.status` é lido por meia dúzia de telas que conhecem três valores
  // (pending/done/skipped); um quarto valor faria o toque sumir da fila de Hoje, e uma
  // rodada que morresse no meio o deixaria invisível para sempre.
  //
  // Quem serializa é o CRON, tomando o "slot" do workspace (`fila_wa_proximo_em`) com um
  // update condicional antes de enviar. Só uma rodada ganha o slot, e como só sai uma
  // mensagem por slot, duas rodadas nunca disputam a mesma tarefa. A trava fica num
  // lugar só, e não custa um estado novo espalhado pelo app.

  const { sendText } = await import("@/lib/whatsapp");
  const res = await sendText(acc as any, phone, task.generated_content || "");

  if (res.error) {
    // "não tem WhatsApp" não é só um erro de envio: é um FATO sobre o contato, e a
    // descoberta custou uma consulta ao WhatsApp. Marcado, ele some da fila de envio e
    // aparece na lista de revisão — em vez de reaparecer amanhã com o mesmo erro.
    const { ehErroSemWhatsapp, marcarSemWhatsapp } = await import("@/lib/semWhatsapp");
    if (ehErroSemWhatsapp(res.error)) {
      const r = await marcarSemWhatsapp(supabase, {
        tenantId,
        contactId: (task as any).contact_id,
        phone,
      });
      // A tarefa fica como está: `marcarSemWhatsapp` carimba o CONTATO
      // (`wa_status='invalid'`), e é por esse carimbo que a fila automática deixa de
      // escolhê-lo — mesma marca que a verificação em massa já usa.
      return {
        error:
          res.error +
          (r.ok
            ? r.motivo === "fixo"
              ? " Marquei o contato como sem WhatsApp (o número é fixo) — ele está em Contatos → Sem WhatsApp para você achar um celular."
              : " Marquei o contato como sem WhatsApp — ele está em Contatos → Sem WhatsApp para revisão."
            : " (não consegui marcar o contato — ele vai reaparecer nesta fila)"),
        semWhatsapp: true,
        phone,
        contactId: (task as any).contact_id || null,
      };
    }
    // Falha de transporte: a tarefa continua `pending` e tenta de novo na próxima
    // janela. Quem decide se o problema é o chip (e não o contato) é `registrarFalha`,
    // no ritmo — três seguidas e o número se pausa.
    return { error: res.error, phone, contactId: (task as any).contact_id || null };
  }

  await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", taskId);

  await scoreEvent(supabase, { tenant_id: tenantId, contact_id: (task as any).contact_id, type: "task_done", user_id: userId });
  // pelo scoreEvent, e não por insert direto: é ele que sabe gravar o autor e que
  // tolera a coluna user_id ainda não existir (0106 não aplicada).
  await scoreEvent(supabase, { tenant_id: tenantId, contact_id: (task as any).contact_id, type: "whatsapp_sent", user_id: userId });

  // guarda a mensagem enviada na conversa (para a caixa de Respostas mostrar os dois lados)
  await supabase.from("whatsapp_messages").insert({
    tenant_id: tenantId,
    account_id: acc.id,
    contact_id: (task as any).contact_id,
    phone,
    direction: "out",
    text: task.generated_content || "",
  });

  // Estado da conversa (0116): o toque gasta o orçamento do dia e conta como follow-up.
  const { tocarConversa, assumirPorMensagemManual } = await import("@/lib/agente/conversas");
  await tocarConversa(supabase, {
    tenantId,
    accountId: acc.id,
    contactId: (task as any).contact_id,
    phone,
    direcao: "out",
  });
  // Só o toque HUMANO cala o agente — ver o cabeçalho.
  if (!input.automatico) {
    await assumirPorMensagemManual(supabase, { tenantId, accountId: acc.id, phone, userId });
  }

  return { ok: true, phone, contactId: (task as any).contact_id || null };
}
