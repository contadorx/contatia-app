import "server-only";
import { janelaDoTenant, dentroDaJanela, proximaAbertura, type JanelaEnvio } from "@/lib/janelaEnvio";
import { diaISO } from "@/lib/datas";

// ============================================================
// OS FREIOS DA FILA AUTOMÁTICA DE WHATSAPP
//
// Este arquivo não envia nada. Ele responde a uma pergunta só — "pode sair uma
// mensagem agora?" — e é o único lugar onde essa resposta é decidida.
//
// Existe porque automatizar disparo de WhatsApp é a função de maior risco do sistema, e
// aqui há UM chip: quando ele cair, caem junto as conversas ativas e a linha do negócio.
// Não há plano B. Então cada freio abaixo é a diferença entre uma fila que trabalha e um
// número perdido.
//
// AS CINCO PORTAS, todas obrigatórias:
//   1. `tenants.fila_wa_automatica` — o workspace pediu. Nasce false (0117).
//   2. `whatsapp_accounts.aquecido` — marcado À MÃO. É o aceite consciente: o app não
//      mede aquecimento, e quem marca está dizendo "eu sei o que estou ligando".
//   3. chip não pausado — 3 falhas seguidas e ele se pausa sozinho.
//   4. dentro da janela — e aqui a regra é MAIS DURA que a do e-mail (ver abaixo).
//   5. `fila_wa_proximo_em` — o jitter. A porta que realmente protege.
//
// A JANELA NÃO PODE SER "SEMPRE". No e-mail, janela desligada significa "pode a
// qualquer hora", e isso é defensável: e-mail às 3h fica na caixa até de manhã. No
// WhatsApp ele APITA no celular de alguém às 3h — e prospecção que apita de madrugada é
// lida como robô pelo destinatário antes de qualquer filtro. Por isso, quando o
// workspace não configurou janela, esta fila NÃO herda "sempre": cai num horário
// comercial conservador. É o único lugar do app onde desligar a janela deixa o freio
// MAIS apertado, e é de propósito.
// ============================================================

/** Horário comercial de segurança para quando o workspace não configurou janela. */
const JANELA_PADRAO_WA: JanelaEnvio = { ligado: true, inicio: 9, fim: 18, dias: [1, 2, 3, 4, 5] };

// Intervalo entre dois disparos automáticos. Sorteado a cada envio: o que denuncia um
// robô não é a velocidade, é a REGULARIDADE. Trinta em trinta segundos, cravado, é um
// padrão; irregular, é gente trabalhando.
//
// A ESPEC PEDIA 90s–7min E AQUI ESTÁ 4–14min. Não é excesso de zelo: aqueles números
// foram escritos para chips de FRIO, dedicados e descartáveis — "quando cair, cai o
// chip". Aqui o disparo sai do número PRINCIPAL, o único que existe, e o cálculo muda
// de figura.
//
// A conta que decide: com 90s–7min (média ~4min) o cap de 40 do dia se esgota em pouco
// mais de 2 horas, e 40 mensagens numa manhã é exatamente o formato que o outro lado
// reconhece. Com 4–14min (média 9min) as mesmas 40 se espalham por ~6 horas, que é a
// forma de um dia de trabalho. Mesmo volume, silhueta diferente — e é a silhueta que
// está sendo lida.
export const JITTER_MIN_MS = 240_000;   // 4 min
export const JITTER_MAX_MS = 840_000;   // 14 min

// Três falhas seguidas e o chip para. Melhor perder um dia de fila do que o número.
export const FALHAS_PARA_PAUSAR = 3;

export function proximoIntervaloMs(): number {
  return JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS + 1));
}

export type ChipFila = {
  id: string;
  evolution_url: string;
  api_key: string;
  instance: string;
  daily_cap: number | null;
  papel: string | null;
  aquecido: boolean | null;
  falhas_seguidas: number | null;
  pausado_em: string | null;
  pausa_motivo: string | null;
};

const CAMPOS_CHIP =
  "id, evolution_url, api_key, instance, daily_cap, papel, aquecido, falhas_seguidas, pausado_em, pausa_motivo";

export type Veredito =
  | { pode: true; chip: ChipFila; folga: number; usadosHoje: number; janela: JanelaEnvio }
  | { pode: false; motivo: string; volta?: string | null; chip?: ChipFila | null };

/**
 * Pode sair uma mensagem automática agora, e por qual chip?
 *
 * TENANT EXPLÍCITO EM TODA QUERY: o chamador é o cron, com admin client e sem RLS. Sem
 * o `.eq("tenant_id", …)` daqui, a fila de um workspace sairia pelo número de outro —
 * e no WhatsApp isso é irreversível, porque a mensagem chega.
 */
export async function podeEnviarAgora(
  admin: any,
  tenantId: string,
  agora: Date = new Date()
): Promise<Veredito> {
  // ---- porta 4: janela (lida antes de tudo que custa) ----
  const { data: t } = await admin
    .from("tenants")
    .select("envio_horario_on, envio_hora_inicio, envio_hora_fim, envio_dias, fila_wa_proximo_em, whatsapp_mode")
    .eq("id", tenantId)
    .maybeSingle();

  const configurada = janelaDoTenant(t);
  const janela = configurada.ligado ? configurada : JANELA_PADRAO_WA;

  if (!dentroDaJanela(janela, agora)) {
    const abre = proximaAbertura(janela, agora);
    return { pode: false, motivo: "fora do horário", volta: abre ? abre.toISOString() : null };
  }

  // ---- porta 5: jitter ----
  // Antes de escolher chip ou contar mensagens: se ainda não é hora, nada disso importa.
  const proximo = (t as any)?.fila_wa_proximo_em;
  if (proximo && new Date(proximo).getTime() > agora.getTime()) {
    return { pode: false, motivo: "aguardando o intervalo entre envios", volta: proximo };
  }

  // ---- porta 2 e 3: o chip ----
  const { data: chips, error } = await admin
    .from("whatsapp_accounts")
    .select(CAMPOS_CHIP)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) return { pode: false, motivo: `chips indisponíveis: ${(error as any).message}` };

  const lista = ((chips as any[]) || []) as ChipFila[];
  if (!lista.length) return { pode: false, motivo: "nenhum número de WhatsApp ativo" };

  const liberados = lista.filter((c) => !c.pausado_em);
  if (!liberados.length) {
    return { pode: false, motivo: `chip pausado: ${lista[0].pausa_motivo || "falhas seguidas"}`, chip: lista[0] };
  }

  // PREFERE O CHIP DE FRIO. Com vários números, o primeiro toque sai do descartável e o
  // principal fica de fora — que é a regra inteira do papel. Com um número só, esta
  // linha não muda nada: sobra o que existe.
  const ordem = { frio: 0, conversa: 1, principal: 2 } as Record<string, number>;
  const escolhido = [...liberados].sort(
    (a, b) => (ordem[a.papel || "principal"] ?? 2) - (ordem[b.papel || "principal"] ?? 2)
  )[0];

  if (!escolhido.aquecido) {
    return {
      pode: false,
      motivo:
        "o número ainda não está marcado como aquecido — marque em Config → Canais depois de 2 a 4 semanas de uso real",
      chip: escolhido,
    };
  }

  // ---- cap diário ----
  // Conta pelos EVENTOS do dia, a mesma fonte que o envio manual usa: assim o clique e a
  // fila dividem o mesmo teto em vez de terem 40 cada um. O dia é o de Brasília.
  const inicioDoDia = new Date(`${diaISO(agora)}T00:00:00-03:00`).toISOString();
  const { count } = await admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("type", "whatsapp_sent")
    .gte("created_at", inicioDoDia);

  const usadosHoje = count ?? 0;
  const cap = escolhido.daily_cap ?? 40;
  const folga = cap - usadosHoje;
  if (folga <= 0) {
    return { pode: false, motivo: `limite diário do número atingido (${cap})`, chip: escolhido };
  }

  return { pode: true, chip: escolhido, folga, usadosHoje, janela };
}

/**
 * Toma o "slot" de envio do workspace — e é esta função que impede a mensagem dupla.
 *
 * O cron roda a cada minuto e um envio pode demorar (o Evolution ainda verifica o 9º
 * dígito antes de mandar). Duas rodadas sobrepostas leriam a mesma fila e mandariam o
 * MESMO toque duas vezes, para a mesma pessoa, com segundos de diferença — o jeito mais
 * rápido de o lead marcar o número como spam.
 *
 * O update é CONDICIONAL: só grava se o slot ainda estiver vencido. Como o Postgres
 * serializa o UPDATE da linha, duas rodadas simultâneas disputam e exatamente uma leva
 * `select()` com linha; a outra recebe vazio e vai embora sem enviar nada.
 *
 * O slot é tomado ANTES do envio, de propósito. Se a rodada morrer no meio, o pior caso
 * é um intervalo perdido (a fila espera mais um pouco) — nunca uma mensagem repetida.
 */
export async function tomarSlot(
  admin: any,
  tenantId: string,
  agora: Date = new Date()
): Promise<string | null> {
  const quando = new Date(agora.getTime() + proximoIntervaloMs()).toISOString();
  const { data } = await admin
    .from("tenants")
    .update({ fila_wa_proximo_em: quando })
    .eq("id", tenantId)
    .or(`fila_wa_proximo_em.is.null,fila_wa_proximo_em.lte.${agora.toISOString()}`)
    .select("id");
  return ((data as any[]) || []).length ? quando : null;
}

/** Deu certo: a contagem de falhas seguidas zera. */
export async function registrarSucesso(admin: any, tenantId: string, chipId: string): Promise<void> {
  await admin
    .from("whatsapp_accounts")
    .update({ falhas_seguidas: 0 })
    .eq("tenant_id", tenantId)
    .eq("id", chipId);
}

/**
 * Falhou: soma uma falha e, no teto, PAUSA o chip.
 *
 * Pausar não desliga o número — responder à mão continua funcionando, e as conversas
 * abertas seguem vivas. O que para é só o disparo automático, que é justamente o que
 * não tem ninguém olhando.
 *
 * "Este número não tem WhatsApp" NÃO conta: é um fato sobre o contato, não sinal de
 * saúde do chip. Contá-lo pausaria a fila por causa de uma lista mal higienizada — e
 * esconderia a falha que importa.
 */
export async function registrarFalha(
  admin: any,
  tenantId: string,
  chip: ChipFila,
  erro: string
): Promise<{ pausou: boolean; falhas: number }> {
  const { ehErroSemWhatsapp } = await import("@/lib/semWhatsapp");
  if (ehErroSemWhatsapp(erro)) return { pausou: false, falhas: chip.falhas_seguidas || 0 };

  const falhas = (chip.falhas_seguidas || 0) + 1;
  const pausou = falhas >= FALHAS_PARA_PAUSAR;

  await admin
    .from("whatsapp_accounts")
    .update({
      falhas_seguidas: falhas,
      ...(pausou
        ? {
            pausado_em: new Date().toISOString(),
            pausa_motivo: `${falhas} falhas seguidas de envio. Última: ${String(erro).slice(0, 140)}`,
          }
        : {}),
    })
    .eq("tenant_id", tenantId)
    .eq("id", chip.id);

  if (pausou) {
    // O aviso tem que existir fora do log técnico: quem liga a fila automática não fica
    // olhando o painel do cron, e um chip pausado em silêncio é uma fila que "sumiu".
    await admin.from("events").insert({
      tenant_id: tenantId,
      type: "note",
      meta: {
        text:
          `WhatsApp: a fila automática pausou o número após ${falhas} falhas seguidas. ` +
          `Verifique a conexão em Config → Canais e libere o número para voltar a enviar.`,
      },
    });
  }

  return { pausou, falhas };
}
