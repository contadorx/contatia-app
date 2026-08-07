import "server-only";

// ============================================================
// QUEM DECIDE O PASSO CONDICIONAL, E QUANDO
//
// A condição não pode ser resolvida na inscrição ("ele abriu o e-mail?" ainda não tem
// resposta) nem só no clique de enviar — se ficasse para o envio, a tarefa apareceria
// na fila do dia, contaria no "246 toques de hoje", e sumiria na hora de mandar. O
// número do dia mentiria todo dia.
//
// Então são dois momentos, de propósito:
//
//   1. O CRON, uma vez por hora: pega as tarefas que vencem HOJE com condição, avalia,
//      e PULA (status 'skipped') as que não bateram, registrando o motivo. A fila do
//      dia já nasce limpa.
//   2. O ENVIO, por garantia: reavalia a tarefa individual antes de mandar. É a rede
//      contra a janela entre o cron e o clique — e contra o operador que envia uma
//      tarefa de amanhã pela ficha.
//
// Pular é melhor que deixar pendente: tarefa que não pode sair e não sai do caminho é
// a que entope a fila e faz o operador perder a confiança no número do dia.
// ============================================================

import { avaliarCondicao, rotuloCondicao, type Condicao } from "@/lib/condicoes";
import { diaISO } from "@/lib/datas";

export async function resolverCondicoesDoDia(
  admin: any,
  opts?: { tenantId?: string | null; teto?: number }
): Promise<{ avaliadas: number; puladas: number; erro?: string }> {
  const hoje = diaISO();
  const teto = opts?.teto ?? 500;

  let q = admin
    .from("tasks")
    .select("id, tenant_id, contact_id, enrollment_id, condicao, contacts(*)")
    .eq("status", "pending")
    .lte("due_date", hoje)
    .not("condicao", "is", null)
    .limit(teto);
  if (opts?.tenantId) q = q.eq("tenant_id", opts.tenantId);

  const { data, error } = await q;
  // A coluna nasce na 0113: sem ela, não há passo condicional nenhum para resolver.
  if (error) {
    const code = String((error as any)?.code || "");
    if (code === "PGRST204" || code === "42703") return { avaliadas: 0, puladas: 0 };
    return { avaliadas: 0, puladas: 0, erro: (error as any)?.message };
  }

  const tarefas = ((data as any[]) || []);
  let puladas = 0;

  for (const t of tarefas) {
    const cond = t.condicao as Condicao;
    const r = await avaliarCondicao(admin, cond, {
      contactId: t.contact_id,
      enrollmentId: t.enrollment_id,
      contato: t.contacts || {},
    });
    if (r.ok) continue;

    // `.eq("status","pending")`: se o operador enviou nesse meio-tempo, quem chegou
    // primeiro vence — nunca "pular" algo que já saiu.
    const { data: pulada } = await admin
      .from("tasks")
      .update({ status: "skipped" })
      .eq("id", t.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!pulada) continue;
    puladas++;

    if (t.contact_id) {
      // o registro explica o buraco na sequência: sem ele, o operador abre a ficha,
      // vê um passo que não aconteceu e não tem como saber por quê.
      await admin.from("events").insert({
        tenant_id: t.tenant_id || opts?.tenantId || null,
        contact_id: t.contact_id,
        type: "note",
        meta: {
          text: `Toque pulado pela condição do passo (${rotuloCondicao(cond)}): ${r.motivo}.`,
          origem: "condicao",
        },
      } as any);
    }
  }

  return { avaliadas: tarefas.length, puladas };
}
