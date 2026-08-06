import "server-only";

// ============================================================
// "ESTE NÚMERO NÃO TEM WHATSAPP" PRECISA VIRAR MARCA, NÃO SÓ MENSAGEM
//
// O envio já sabia disso: `sendText` verifica com e sem o 9º dígito e devolve um erro
// claro. Só que o erro morria na tela. Consequências, todas vividas no disparo de hoje:
//
//   · a tarefa continuava pendente e reaparecia amanhã, com o mesmo erro;
//   · o contato seguia igual aos outros na lista — nada distinguia quem tem WhatsApp
//     de quem já se provou que não tem;
//   · a descoberta (uma consulta ao WhatsApp, que é justamente o pedido que mais
//     chama atenção da Meta) era jogada fora e refeita no próximo envio;
//   · e não havia lista nenhuma para trabalhar: "quem eu preciso caçar o celular?"
//     não tinha resposta em lugar nenhum do app.
//
// Marcar resolve os quatro. `wa_status='invalid'` é o MESMO valor que a verificação em
// massa grava, então a visão "Sem WhatsApp", o selo da lista e o "Completar canais" já
// enxergam sem precisar aprender nada novo.
//
// A nota no histórico existe para a revisão ter contexto: daqui a uma semana, "sem
// WhatsApp" sozinho não diz se foi verificado, quando, e em qual número.
// ============================================================

import { ehFixoBR } from "@/lib/telefone";

export type MotivoSemWa = "sem_conta" | "fixo";

export async function marcarSemWhatsapp(
  supabase: any,
  args: { tenantId: string; contactId?: string | null; phone?: string | null; motivo?: MotivoSemWa }
): Promise<{ ok: boolean; motivo: MotivoSemWa }> {
  const motivo: MotivoSemWa = args.motivo || (ehFixoBR(args.phone) ? "fixo" : "sem_conta");
  if (!args.contactId) return { ok: false, motivo };

  const { error } = await supabase
    .from("contacts")
    .update({ wa_status: "invalid", wa_checked_at: new Date().toISOString() })
    .eq("id", args.contactId);

  // Não engolir o erro: se a marca não entrou, a tarefa vai reaparecer amanhã com o
  // mesmo erro e ninguém vai entender por quê. Quem chama decide o que dizer.
  if (error) return { ok: false, motivo };

  const texto =
    motivo === "fixo"
      ? `WhatsApp: ${args.phone || "o número do contato"} é um telefone FIXO — não existe conta de WhatsApp para ele. Para usar este canal, o contato precisa de um celular.`
      : `WhatsApp: ${args.phone || "o número do contato"} não tem conta de WhatsApp (verificado com e sem o 9º dígito). O número pode estar errado ou a pessoa usa outro.`;

  await supabase.from("events").insert({
    tenant_id: args.tenantId,
    contact_id: args.contactId,
    type: "note",
    meta: { text: texto, origem: "envio", wa_motivo: motivo },
  } as any);

  return { ok: true, motivo };
}

// O erro do Evolution/`sendText` que significa "esse número não tem conta". Fica aqui
// para o teste ser um só — espalhado, um dia uma das cópias deixa de casar e a marca
// para de acontecer em silêncio.
export function ehErroSemWhatsapp(erro?: string | null): boolean {
  return /não tem WhatsApp/i.test(String(erro || ""));
}
