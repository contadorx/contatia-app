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
  role_title?: string | null;
  cnpj?: string | null;
  custom?: Record<string, any> | null;
};

// Variáveis disponíveis nos templates (para exibir na UI). O rapport personaliza
// POR CONTATO via substituição de texto — sem custo de IA por mensagem.
export const TEMPLATE_VARS: { k: string; desc: string }[] = [
  { k: "primeiro_nome", desc: "primeiro nome do contato" },
  { k: "nome", desc: "nome completo" },
  { k: "empresa", desc: "empresa" },
  { k: "cargo", desc: "cargo do contato" },
  { k: "cidade", desc: "cidade (Receita)" },
  { k: "uf", desc: "UF (Receita)" },
  { k: "cnae", desc: "atividade/CNAE (Receita)" },
  { k: "porte", desc: "porte (Receita)" },
  { k: "interesses", desc: "rapport: interesses/assuntos" },
  { k: "contexto", desc: "rapport: contexto da última conversa" },
  { k: "como_conheceu", desc: "rapport: como conheceu" },
];

// Substitui variáveis {{...}} pelos campos do contato (inclui rapport e dados da Receita).
export function renderTemplate(text: string | null | undefined, c: ContactLike): string {
  if (!text) return "";
  const first = (c.name || "").trim().split(/\s+/)[0] || "";
  const cu = (c.custom || {}) as Record<string, any>;
  const rp = (cu.rapport || {}) as Record<string, any>;
  const map: Record<string, string> = {
    primeiro_nome: first,
    nome: c.name || "",
    empresa: c.company || "",
    email: c.email || "",
    telefone: c.phone || "",
    cargo: c.role_title || "",
    cnpj: c.cnpj || "",
    cnae: cu.cnae_descricao || cu.cnae || "",
    cidade: cu.municipio || "",
    uf: cu.uf || "",
    porte: cu.porte || "",
    linkedin: cu.linkedin || "",
    como_conheceu: rp.como_conheceu || "",
    interesses: rp.interesses || "",
    contexto: rp.contexto || "",
    estilo: rp.estilo || "",
    aniversario: rp.aniversario || "",
  };
  // substitui só variáveis conhecidas; deixa desconhecidas visíveis (pega erro de digitação)
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => {
    const key = String(k).toLowerCase();
    return key in map ? map[key] : m;
  });
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
