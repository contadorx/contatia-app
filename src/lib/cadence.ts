// Helpers do motor de cadência.

export type Channel = "email" | "whatsapp" | "call" | "linkedin";

export const channelLabel: Record<Channel, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  call: "Ligação",
  linkedin: "LinkedIn",
};

type ContactLike = {
  name?: string | null;
  email?: string | null;
  company?: string | null;
  phone?: string | null;
};

// Substitui variáveis {{...}} pelos campos do contato.
export function renderTemplate(text: string | null | undefined, c: ContactLike): string {
  if (!text) return "";
  const first = (c.name || "").trim().split(/\s+/)[0] || "";
  return text
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, first)
    .replace(/\{\{\s*nome\s*\}\}/gi, c.name || "")
    .replace(/\{\{\s*empresa\s*\}\}/gi, c.company || "")
    .replace(/\{\{\s*email\s*\}\}/gi, c.email || "");
}

// Monta link do WhatsApp com a mensagem pré-preenchida.
// Retorna string vazia se não houver número válido (o chamador some com o botão).
export function waLink(phone: string | null | undefined, text: string): string {
  let digits = (phone || "").replace(/\D/g, "");
  // remove zeros à esquerda (ex.: 0 antes do DDD)
  digits = digits.replace(/^0+/, "");
  if (!digits) return "";
  // DDI Brasil quando vier só com DDD+numero (10 ou 11 dígitos)
  if (digits.length <= 11) digits = "55" + digits;
  // número precisa ter DDI+DDD+numero (12 ou 13 dígitos no BR); senão é inválido
  if (digits.length < 12) return "";
  // api.whatsapp.com/send é mais confiável que wa.me em desktop e apps embutidos
  return `https://api.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(text)}`;
}

// Soma dias a uma data e devolve YYYY-MM-DD.
export function addDaysISO(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
