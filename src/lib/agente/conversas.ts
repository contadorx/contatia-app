import "server-only";
import { diaISO } from "@/lib/datas";

// ============================================================
// O ESTADO DA CONVERSA — quem conduz, há quanto tempo, e com que orçamento
//
// `whatsapp_messages` guarda MENSAGENS; esta camada guarda a CONVERSA. Toda mensagem
// que entra ou sai passa por `tocarConversa`, e é ela que mantém a linha de
// `agent_conversas` viva: última mensagem, contador do dia, follow-ups sem resposta.
//
// SERVER-ONLY, ADMIN CLIENT, TENANT EXPLÍCITO EM TODA QUERY. O admin client não tem
// RLS — o `.eq("tenant_id", …)` aqui não é zelo, é a única fronteira que existe. Sem
// ele, o webhook de um workspace escreveria na conversa de outro. Mesma lição do
// `envioEmail.ts` (v68).
//
// O QUE ESTA CAMADA NÃO FAZ: decidir. Nada aqui responde, agenda ou fecha nada. É
// contabilidade de estado — o motor do F2 vai LER daqui antes de agir.
// ============================================================

export type StatusConversa = "agente" | "humano" | "sombra" | "pausada" | "encerrada";
export type Direcao = "in" | "out";

export type Conversa = {
  id: string;
  status: StatusConversa;
  contact_id: string | null;
  msgs_hoje: number;
  msgs_hoje_em: string | null;
  followups_sem_resposta: number;
  desfecho: string | null;
  ultima_resposta_em: string | null;
};

const CAMPOS =
  "id, status, contact_id, msgs_hoje, msgs_hoje_em, followups_sem_resposta, desfecho, ultima_resposta_em";

function acharQuery(admin: any, tenantId: string, phone: string, accountId: string | null) {
  const q = admin.from("agent_conversas").select(CAMPOS).eq("tenant_id", tenantId).eq("phone", phone);
  return accountId ? q.eq("account_id", accountId) : q.is("account_id", null);
}

/**
 * Quantas mensagens NOSSAS já saíram nesta conversa HOJE.
 *
 * O contador só vale acompanhado da data: `msgs_hoje = 5` de ontem não é um orçamento
 * gasto, é um número velho. Ler por aqui (e não pelo campo cru) é o que impede o teto
 * `max_msgs_dia_por_conversa` de virar um limite vitalício que mata a conversa no
 * sexto balão de todos os tempos.
 */
export function msgsHoje(c: { msgs_hoje: number; msgs_hoje_em: string | null } | null): number {
  if (!c) return 0;
  return c.msgs_hoje_em === diaISO() ? c.msgs_hoje || 0 : 0;
}

/**
 * Registra que uma mensagem entrou ou saiu, criando a conversa se ainda não existir.
 *
 * Devolve o estado ANTES do toque (o que o motor precisa para decidir) ou null se algo
 * falhou. Nunca lança: uma falha de contabilidade não pode derrubar o webhook e fazer
 * a Evolution reentregar a mensagem.
 */
export async function tocarConversa(
  admin: any,
  input: {
    tenantId: string;
    phone: string;
    accountId?: string | null;
    contactId?: string | null;
    direcao: Direcao;
    quando?: string;
    // Mensagem de central automática ("Bem-vindo ao atendimento da X"). Ela EXISTE — o
    // relógio da conversa anda — mas não é o lead falando: não zera a régua de
    // follow-up nem reabre conversa encerrada. Mesma leitura que o webhook já faz para
    // não pontuar nem pausar cadência por causa do robô do outro lado.
    automatica?: boolean;
  }
): Promise<Conversa | null> {
  const tenantId = input.tenantId;
  const phone = (input.phone || "").trim();
  if (!tenantId || !phone) return null;

  const accountId = input.accountId || null;
  const quando = input.quando || new Date().toISOString();
  const hoje = diaISO();

  try {
    let { data: atual } = await acharQuery(admin, tenantId, phone, accountId).maybeSingle();

    // ---------- não existe: nasce agora ----------
    if (!atual) {
      const { data: criada, error } = await admin
        .from("agent_conversas")
        .insert({
          tenant_id: tenantId,
          account_id: accountId,
          contact_id: input.contactId || null,
          phone,
          // 'humano' e não 'agente': ver o comentário da 0116. Conversa não é entregue
          // a um robô por efeito colateral de uma mensagem chegar.
          status: "humano",
          ultima_msg_em: quando,
          ultima_msg_direcao: input.direcao,
          msgs_hoje: input.direcao === "out" ? 1 : 0,
          msgs_hoje_em: input.direcao === "out" ? hoje : null,
          followups_sem_resposta: input.direcao === "out" ? 1 : 0,
          ultima_resposta_em: input.direcao === "in" && !input.automatica ? quando : null,
        })
        .select(CAMPOS)
        .single();

      if (!error && criada) {
        // devolve o estado ANTES: uma conversa que acabou de nascer estava zerada
        return { ...(criada as Conversa), msgs_hoje: 0, msgs_hoje_em: null, followups_sem_resposta: 0, ultima_resposta_em: null };
      }

      // CORRIDA: duas mensagens do mesmo número chegando juntas. O índice único da
      // 0116 barrou a segunda — o certo é reler a linha que a primeira criou, não
      // desistir (desistir perderia a contagem de uma mensagem real).
      const { data: relida } = await acharQuery(admin, tenantId, phone, accountId).maybeSingle();
      if (!relida) return null;
      atual = relida;
    }

    const antes = atual as Conversa;
    const gastoHoje = msgsHoje(antes);

    const patch: Record<string, any> = {
      ultima_msg_em: quando,
      ultima_msg_direcao: input.direcao,
    };

    // Número desconhecido que virou contato depois: a conversa NÃO recomeça, só passa
    // a saber de quem é. Só preenche — nunca reescreve um vínculo já existente.
    if (input.contactId && !antes.contact_id) patch.contact_id = input.contactId;

    // Chip identificado depois (a linha nasceu sem account_id): mesma ideia.
    if (accountId) patch.account_id = accountId;

    if (input.direcao === "out") {
      // Sai mensagem nossa: gasta orçamento do dia e conta como mais um follow-up
      // desde a última resposta dele.
      patch.msgs_hoje = gastoHoje + 1;
      patch.msgs_hoje_em = hoje;
      patch.followups_sem_resposta = (antes.followups_sem_resposta || 0) + 1;
    } else if (!input.automatica) {
      // O lead falou de verdade. O silêncio acabou — a régua de follow-up zera.
      patch.followups_sem_resposta = 0;
      patch.ultima_resposta_em = quando;

      // PORTA ABERTA: `encerrar` fecha a conversa sem fechar a porta. Se ele voltar a
      // escrever, a conversa volta para o colo de um humano. `desfecho` fica como
      // estava: a venda (ou a recusa) aconteceu de verdade, e apagar isso seria
      // reescrever o histórico só porque houve uma mensagem nova.
      if (antes.status === "encerrada") patch.status = "humano";
    }
    // Central automática: cai aqui e só o relógio de `ultima_msg_em` anda. Zerar a
    // régua por causa de um "recebemos sua mensagem" faria o sistema achar que o lead
    // respondeu — e é justamente esse engano que o webhook já evita no score.

    await admin.from("agent_conversas").update(patch).eq("tenant_id", tenantId).eq("id", antes.id);

    return { ...antes, msgs_hoje: gastoHoje, msgs_hoje_em: gastoHoje ? hoje : null };
  } catch {
    // Contabilidade não derruba o webhook: a mensagem já foi gravada em
    // `whatsapp_messages`, que é o que não pode se perder.
    return null;
  }
}

/**
 * Alguém do time falou nesta conversa pela mão — o agente cala na hora.
 *
 * É o "sua mensagem manual também pausa" da espec, e vale mesmo quando ninguém apertou
 * "Assumir": responder por cima do robô e ele continuar respondendo é o pior resultado
 * possível para o lead, que vê duas vozes no mesmo fio.
 *
 * Não mexe em conversa `encerrada` — ali a resposta manual é um epílogo, não uma
 * retomada de condução.
 */
export async function assumirPorMensagemManual(
  admin: any,
  input: { tenantId: string; phone: string; accountId?: string | null; userId?: string | null }
): Promise<void> {
  const tenantId = input.tenantId;
  const phone = (input.phone || "").trim();
  if (!tenantId || !phone) return;

  try {
    const { data: c } = await acharQuery(admin, tenantId, phone, input.accountId || null).maybeSingle();
    if (!c) return;
    const atual = (c as Conversa).status;
    if (atual === "humano" || atual === "encerrada") return;

    await admin
      .from("agent_conversas")
      .update({
        status: "humano",
        assumida_por: input.userId || null,
        assumida_em: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", (c as Conversa).id);
  } catch {
    /* nunca bloqueia o envio */
  }
}
