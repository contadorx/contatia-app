// ============================================================
// TELEFONE BRASILEIRO — o que dá para saber SEM perguntar a ninguém
//
// Antes de gastar uma verificação (e um pedido ao WhatsApp, que é o que mais chama
// atenção da Meta) dá para separar três casos só olhando o número:
//   · fixo      → local de 8 dígitos começando em 2, 3, 4 ou 5. NUNCA terá WhatsApp.
//   · celular   → local de 9 dígitos começando em 9 (ou 8 dígitos começando em 6-9,
//                 formato antigo que ainda aparece em base velha).
//   · ilegível  → curto, longo demais, ou com DDD que não existe.
//
// A distinção importa para a REVISÃO: "não tem WhatsApp" é conclusão diferente de
// "isso é um telefone fixo". No primeiro caso vale tentar de novo mais tarde ou achar
// o celular da pessoa; no segundo, o número está certo e simplesmente não serve para
// este canal — o que falta é outro número, e insistir na verificação é desperdício.
//
// Este módulo é neutro de propósito (não é `server-only`): a fila de hoje é componente
// de cliente e precisa da mesma resposta que o servidor usa.
// ============================================================

export function digitosTelefone(v?: string | null): string {
  return String(v || "").replace(/\D/g, "");
}

// Devolve { ddd, local } de um número BR, ou null se não der para ler com segurança.
function partesBR(v?: string | null): { ddd: string; local: string } | null {
  let d = digitosTelefone(v);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = d.slice(0, 2);
  if (Number(ddd) < 11 || Number(ddd) > 99) return null;
  return { ddd, local: d.slice(2) };
}

export function ehFixoBR(v?: string | null): boolean {
  const p = partesBR(v);
  if (!p) return false;
  return p.local.length === 8 && /^[2-5]/.test(p.local);
}

export function ehCelularBR(v?: string | null): boolean {
  const p = partesBR(v);
  if (!p) return false;
  if (p.local.length === 9) return p.local.startsWith("9");
  return p.local.length === 8 && /^[6-9]/.test(p.local);
}

// Rótulo curto para a tela — só quando ele acrescenta alguma coisa.
export function tipoTelefone(v?: string | null): "fixo" | "celular" | "ilegivel" {
  if (ehFixoBR(v)) return "fixo";
  if (ehCelularBR(v)) return "celular";
  return "ilegivel";
}
