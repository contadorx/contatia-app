import "server-only";
import { promises as dns } from "dns";

// Verificação de e-mail SEM API paga:
// 1) sintaxe · 2) domínio descartável · 3) MX (o domínio realmente recebe e-mail).
// Não confirma a caixa individual (isso exigiria SMTP probe/serviço pago), mas elimina
// a maioria dos e-mails inválidos antes do disparo.

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "throwaway.email", "yopmail.com", "getnada.com", "trashmail.com", "sharklasers.com",
  "maildrop.cc", "dispostable.com", "fakeinbox.com", "mailnesia.com",
]);

export type EmailCheck = {
  email: string;
  valid: boolean;                 // passou em tudo (sintaxe + não descartável + MX)
  syntax: boolean;
  disposable: boolean;
  hasMx: boolean;
  reason?: string;
};

const RE = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

export async function verifyEmail(raw: string): Promise<EmailCheck> {
  const email = (raw || "").trim().toLowerCase();
  const m = email.match(RE);
  if (!m) return { email, valid: false, syntax: false, disposable: false, hasMx: false, reason: "Sintaxe inválida" };
  const domain = m[1];

  const disposable = DISPOSABLE.has(domain);
  if (disposable) return { email, valid: false, syntax: true, disposable: true, hasMx: false, reason: "Domínio descartável" };

  let hasMx = false;
  try {
    const mx = await dns.resolveMx(domain);
    hasMx = Array.isArray(mx) && mx.length > 0;
  } catch {
    hasMx = false;
  }
  if (!hasMx) {
    // fallback: alguns domínios recebem por A record sem MX
    try {
      const a = await dns.resolve(domain);
      hasMx = Array.isArray(a) && a.length > 0;
    } catch {
      hasMx = false;
    }
  }

  return {
    email,
    valid: hasMx,
    syntax: true,
    disposable: false,
    hasMx,
    reason: hasMx ? undefined : "Domínio não recebe e-mail (sem MX)",
  };
}

// Deriva palpites de e-mail do decisor a partir de nome + domínio (padrões comuns BR).
// Sem API: gera candidatos e valida o DOMÍNIO por MX (não a caixa exata).
export function guessDecisorEmails(fullName: string, domain: string): string[] {
  const parts = (fullName || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter(Boolean);
  if (!parts.length || !domain) return [];
  const first = parts[0];
  const last = parts[parts.length - 1];
  const d = domain.replace(/^@/, "");
  const set = new Set<string>([
    `${first}@${d}`,
    `${first}.${last}@${d}`,
    `${first}${last}@${d}`,
    `${first[0]}${last}@${d}`,
    `${last}@${d}`,
    `contato@${d}`,
  ]);
  return Array.from(set);
}
