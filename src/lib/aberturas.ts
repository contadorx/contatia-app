import "server-only";
import { randomUUID } from "crypto";

// ============================================================
// PIXEL DE ABERTURA — e o que ele honestamente mede
//
// Antes desta entrega, `email_opened` era um tipo de evento que NINGUÉM gravava: o
// score pontuava, a ficha tinha rótulo, o "engajou agora" filtrava por ele — e nenhuma
// linha de código o produzia. Isto aqui é o sistema que faltava.
//
// COMO FUNCIONA: uma imagem de 1x1 pixel no fim do corpo do e-mail, apontando para
// /o/{token}. Quando o cliente de e-mail carrega a imagem, a rota conta a abertura.
//
// O QUE ISSO NÃO É — e por que a tela precisa dizer isso:
//
//  · O Apple Mail (Proteção de Privacidade, ligada por padrão desde 2021) BAIXA todas
//    as imagens assim que o e-mail chega, mesmo que ninguém abra. Isso vira "aberto"
//    sem ninguém ter aberto. Numa base brasileira com muito iPhone, é bastante ruído.
//  · O Gmail serve as imagens pelo proxy dele. A abertura é real, mas o horário e a
//    contagem de re-aberturas ficam distorcidos pelo cache.
//  · Quem lê com imagens desligadas (comum em cliente corporativo) NUNCA aparece como
//    aberto, mesmo tendo lido e até respondido.
//
// Conclusão prática, que está escrita na tela do relatório: abertura serve para
// COMPARAR assuntos entre si (A/B), não como número absoluto. Clique e resposta são
// sinais fortes; abertura é sinal fraco.
//
// Por isso o corpo em TEXTO PURO não recebe pixel: seria transformar um e-mail limpo
// em HTML só para medir mal.
// ============================================================

export type AtribuicaoEnvio = {
  tenantId: string;
  contactId: string | null;
  enrollmentId?: string | null;
  sequenceId?: string | null;
  taskId?: string | null;
  stepPosition?: number | null;
};

/**
 * Cria a linha de rastreio e devolve a tag <img> para colar no fim do corpo.
 * Devolve "" quando não dá para rastrear — e nunca lança: rastreio jamais pode
 * impedir um envio.
 */
export async function tagDePixel(
  db: any,
  at: AtribuicaoEnvio,
  baseUrl: string
): Promise<string> {
  if (!baseUrl) return "";
  try {
    const token = randomUUID().replace(/-/g, "").slice(0, 24);
    const linha: Record<string, any> = {
      tenant_id: at.tenantId,
      token,
      contact_id: at.contactId ?? null,
      enrollment_id: at.enrollmentId ?? null,
      sequence_id: at.sequenceId ?? null,
      task_id: at.taskId ?? null,
      step_position: at.stepPosition ?? null,
    };
    const { error } = await db.from("email_opens").insert(linha);
    if (error) return "";   // tabela ainda não existe (migration 0108) → segue sem pixel
    const src = `${baseUrl.replace(/\/+$/, "")}/o/${token}`;
    // alt vazio + aria-hidden: leitores de tela ignoram; display:block evita o
    // espaço fantasma que alguns clientes desenham abaixo de imagens inline.
    return `<img src="${src}" width="1" height="1" alt="" aria-hidden="true" style="display:block;width:1px;height:1px;border:0;opacity:0" />`;
  } catch {
    return "";
  }
}
