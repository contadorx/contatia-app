import "server-only";

// ============================================================
// O AUTOPILOTO — quem responde a cadência cai no agente, sozinho
//
// Chamado do webhook, no exato ponto em que a resposta do lead já pausou a cadência.
// É o caminho que a espec chama de "autopiloto em quem responde cadência", e é o único
// lugar do sistema em que uma conversa vai para o robô SEM alguém clicar.
//
// Por isso as cinco portas abaixo. Nenhuma é zelo excessivo: cada uma corresponde a uma
// forma concreta de o autopiloto fazer estrago sem ninguém perceber.
// ============================================================

export type ResultadoAutopiloto =
  | { entregou: true; conversaId: string; cadencia: string }
  | { entregou: false; motivo: string };

export async function entregarAoAgenteSeConfigurado(
  admin: any,
  input: {
    tenantId: string;
    contactId: string;
    phone: string;
    accountId?: string | null;
    /** as inscrições que acabaram de ser marcadas como respondidas */
    enrollmentIds: string[];
    contatoOptOut?: boolean;
  }
): Promise<ResultadoAutopiloto> {
  try {
    if (!input.enrollmentIds.length) return { entregou: false, motivo: "sem cadência ativa" };

    // PORTA 1 — o contato pediu para não receber. Nada, nunca, em hipótese nenhuma.
    if (input.contatoOptOut) return { entregou: false, motivo: "contato em opt-out" };

    // PORTA 2 — alguma das cadências que ele respondeu tem autopiloto ligado?
    const { data: enrs } = await admin
      .from("enrollments")
      .select("sequence_id, sequences(id, name, agente_autopiloto)")
      .eq("tenant_id", input.tenantId)
      .in("id", input.enrollmentIds);

    const comAutopiloto = ((enrs as any[]) || []).find((e) => e?.sequences?.agente_autopiloto);
    if (!comAutopiloto) return { entregou: false, motivo: "nenhuma cadência com autopiloto" };

    // PORTA 3 — o agente está ligado? Entregar uma conversa a um agente desligado é
    // pior que não entregar: o lead responde e ninguém aparece, nem robô nem gente.
    const { data: cfg } = await admin
      .from("agent_config").select("ativo").eq("tenant_id", input.tenantId).maybeSingle();
    if (!(cfg as any)?.ativo) return { entregou: false, motivo: "agente desligado" };

    // PORTA 4 — existe playbook publicado? O motor até roda sem, mas aí ele não sabe o
    // que vende e é instruído a não falar de preço. Um lead que acabou de responder a
    // uma cadência merece o agente completo, não a versão que desconversa.
    const { count: playbooks } = await admin
      .from("agent_playbooks").select("id", { count: "exact", head: true })
      .eq("tenant_id", input.tenantId).eq("ativo", true);
    if (!playbooks) return { entregou: false, motivo: "nenhum playbook publicado" };

    // PORTA 5 — a mais sutil, e a que causaria o pior estrago.
    //
    // TODA conversa nasce com status 'humano' (0116). Então "está humano" NÃO significa
    // "alguém pegou" — significa, quase sempre, "ninguém pegou ainda". O que distingue os
    // dois é `assumida_por`: ele só é preenchido quando uma pessoa clicou em Assumir ou
    // respondeu à mão. Sem esta distinção, o autopiloto arrancaria da mão de um vendedor
    // uma conversa que ele estava conduzindo — e o lead veria duas vozes no mesmo fio.
    const q = admin
      .from("agent_conversas")
      .select("id, status, assumida_por, desfecho")
      .eq("tenant_id", input.tenantId)
      .eq("phone", input.phone);
    const { data: conv } = await (input.accountId ? q.eq("account_id", input.accountId) : q.is("account_id", null)).maybeSingle();

    if (!conv) return { entregou: false, motivo: "conversa ainda não existe" };
    if ((conv as any).assumida_por) return { entregou: false, motivo: "alguém do time assumiu esta conversa" };
    if ((conv as any).status !== "humano") return { entregou: false, motivo: `conversa em "${(conv as any).status}"` };
    if ((conv as any).desfecho === "opt_out") return { entregou: false, motivo: "conversa encerrada por opt-out" };

    await admin
      .from("agent_conversas")
      .update({
        status: "agente",
        // O turno nasce agendado. O motor confere janela comercial e delay humanizado
        // depois; o que importa aqui é que a resposta dele não espere um clique.
        due_at: new Date(Date.now() + 30_000).toISOString(),
        turno_erros: 0,
      })
      .eq("tenant_id", input.tenantId)
      .eq("id", (conv as any).id);

    // O registro existe porque isto aconteceu sem ninguém olhando. "Por que o agente
    // está falando com este lead?" precisa ter resposta.
    await admin.from("events").insert({
      tenant_id: input.tenantId,
      contact_id: input.contactId,
      type: "note",
      meta: {
        text: `Autopiloto: o lead respondeu à cadência "${comAutopiloto.sequences.name}" e a conversa passou para o agente.`,
        origem: "autopiloto",
        sequence_id: comAutopiloto.sequences.id,
      },
    });

    return { entregou: true, conversaId: (conv as any).id, cadencia: comAutopiloto.sequences.name };
  } catch (e: any) {
    // Nunca derruba o webhook: a mensagem do lead já está gravada e a cadência já foi
    // pausada, que é o que não pode se perder. O autopiloto é um bônus em cima disso.
    return { entregou: false, motivo: `erro: ${e?.message || e}` };
  }
}
