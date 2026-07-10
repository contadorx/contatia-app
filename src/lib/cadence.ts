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

// Monta link wa.me com a mensagem pré-preenchida.
export function waLink(phone: string | null | undefined, text: string): string {
  let digits = (phone || "").replace(/\D/g, "");
  if (digits && digits.length <= 11) digits = "55" + digits; // assume BR sem DDI
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// Soma dias a uma data e devolve YYYY-MM-DD.
export function addDaysISO(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
