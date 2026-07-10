import "server-only";
import { randomUUID } from "crypto";

const URL_RE = /(https?:\/\/[^\s<>()]+)/g;

/**
 * Reescreve os links do corpo para /l/{token}, registrando cada um em link_clicks.
 * `db` precisa poder inserir em link_clicks (client autenticado do tenant serve).
 * Retorna o corpo com os links trocados.
 */
export async function wrapLinks(
  db: any,
  params: { tenantId: string; contactId: string | null; body: string; baseUrl: string }
): Promise<string> {
  const { tenantId, contactId, body, baseUrl } = params;
  if (!body) return body;
  const urls = Array.from(new Set((body.match(URL_RE) || []))).filter((u) => !u.includes("/l/"));
  if (!urls.length) return body;

  const map: Record<string, string> = {};
  for (const url of urls) {
    const token = randomUUID().replace(/-/g, "").slice(0, 20);
    const { error } = await db.from("link_clicks").insert({ tenant_id: tenantId, contact_id: contactId, token, url });
    if (!error) map[url] = `${baseUrl.replace(/\/+$/, "")}/l/${token}`;
  }

  let out = body;
  for (const [orig, tracked] of Object.entries(map)) {
    out = out.split(orig).join(tracked);
  }
  return out;
}
