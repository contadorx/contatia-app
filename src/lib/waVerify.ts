import "server-only";
import { checkWhatsappNumbers, brVariants, normalizePhone, type WaAccount } from "@/lib/whatsapp";

// ============================================================
// VERIFICAÇÃO DE WHATSAPP EM MASSA (núcleo)
//
// Recebe uma lista de contatos, monta as variantes brasileiras (com/sem o 9º
// dígito) de TODOS eles, pergunta ao Evolution numa ÚNICA chamada quais existem,
// e devolve o status por contato. NÃO escreve no banco — quem chama grava (a ação
// ou o cron), para reaproveitar o mesmo núcleo nos dois lugares.
// ============================================================

export type WaContact = { id: string; phone: string | null };
export type WaResult = { id: string; status: "valid" | "invalid"; number: string | null };

export async function verifyContactsBatch(acc: WaAccount, contacts: WaContact[]): Promise<WaResult[]> {
  const contactVariants = new Map<string, string[]>();
  const allNumbers = new Set<string>();

  for (const c of contacts) {
    const norm = normalizePhone(c.phone || "");
    const vs = norm ? brVariants(norm) : [];
    contactVariants.set(c.id, vs);
    for (const v of vs) allNumbers.add(v);
  }

  const nums = Array.from(allNumbers);
  const checked = nums.length ? await checkWhatsappNumbers(acc, nums) : [];

  // mapa número(dígitos) -> existe?
  const existsByNum = new Map<string, boolean>();
  for (const r of checked) if (r.number) existsByNum.set(r.number, r.exists);

  return contacts.map((c) => {
    const vs = contactVariants.get(c.id) || [];
    const hit = vs.find((v) => existsByNum.get(v));
    return { id: c.id, status: hit ? "valid" : "invalid", number: hit || null };
  });
}
