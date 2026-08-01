import "server-only";
import { randomUUID } from "crypto";

// ============================================================
// {{documento:<id>}} — a proposta dentro da cadência
//
// O PROBLEMA QUE ISSO RESOLVE. Colar o link de uma proposta no corpo de um passo de
// cadência não funcionava direito: o corpo do passo é um MODELO, um texto só para
// centenas de destinatários. O token de `document_shares` é por destinatário. Então:
//
//  · colando o link /s/{token} de alguém, TODO MUNDO recebia o link daquela pessoa —
//    e as aberturas de todos eram creditadas a ela;
//  · colando o link cru do arquivo, virava um link genérico rastreado por clique —
//    contava o clique, mas o evento `doc_opened` (15 pontos, o sinal de compra mais
//    forte do app) nunca acontecia.
//
// A saída é uma etiqueta que só é resolvida NA HORA DO ENVIO, quando o destinatário
// finalmente é conhecido: `{{documento:<uuid>}}` vira `/s/<token daquele contato>`.
//
// REAPROVEITA o link quando já existe um daquele documento para aquele contato. Um
// token novo a cada toque quebraria a contagem de aberturas por destinatário — cada
// e-mail da cadência mediria só a si mesmo, e "abriu a proposta 4 vezes" viraria quatro
// linhas de "abriu 1 vez".
// ============================================================

const TAG_RE = /\{\{\s*documento\s*:\s*([0-9a-fA-F-]{36})\s*\}\}/g;

export type AtribuicaoDoc = {
  tenantId: string;
  contactId: string | null;
  enrollmentId?: string | null;
  sequenceId?: string | null;
  taskId?: string | null;
  stepPosition?: number | null;
};

/** Há alguma etiqueta de documento neste corpo? (evita trabalho à toa no envio) */
export function temTagDocumento(body: string): boolean {
  if (!body) return false;
  TAG_RE.lastIndex = 0;
  return TAG_RE.test(body);
}

/**
 * Troca cada {{documento:<id>}} pelo link rastreado daquele contato.
 * Nunca lança. Se algo falhar, a etiqueta é removida do texto — melhor um parágrafo
 * sem link do que um e-mail com "{{documento:8f3a...}}" cru na cara do prospect.
 */
export async function expandirDocumentos(
  db: any,
  at: AtribuicaoDoc,
  body: string,
  baseUrl: string
): Promise<string> {
  if (!body || !baseUrl) return body;
  TAG_RE.lastIndex = 0;
  const ids = Array.from(new Set(Array.from(body.matchAll(TAG_RE)).map((m) => m[1])));
  if (!ids.length) return body;

  const urlPorId: Record<string, string> = {};

  for (const docId of ids) {
    try {
      // sem contato não há link por destinatário — a etiqueta simplesmente some
      if (!at.contactId) continue;

      // já existe um link deste documento para este contato? reaproveita.
      const { data: existente } = await db
        .from("document_shares")
        .select("token")
        .eq("document_id", docId)
        .eq("contact_id", at.contactId)
        .limit(1)
        .maybeSingle();

      let token = (existente as any)?.token as string | undefined;

      if (!token) {
        token = randomUUID().replace(/-/g, "");
        const base = {
          tenant_id: at.tenantId,
          document_id: docId,
          contact_id: at.contactId,
          token,
        };
        const comOrigem = {
          ...base,
          sequence_id: at.sequenceId ?? null,
          enrollment_id: at.enrollmentId ?? null,
          task_id: at.taskId ?? null,
          step_position: at.stepPosition ?? null,
        };
        // Tenta com atribuição; sem as colunas da 0109, grava sem elas. Perder a
        // atribuição é aceitável — perder o link da proposta no e-mail não é.
        let { error } = await db.from("document_shares").insert(comOrigem);
        if (error) ({ error } = await db.from("document_shares").insert(base));
        if (error) continue;
      }

      urlPorId[docId] = `${baseUrl.replace(/\/+$/, "")}/s/${token}`;
    } catch {
      /* documento problemático não derruba o envio */
    }
  }

  return body.replace(TAG_RE, (_m, id: string) => urlPorId[id] || "");
}
