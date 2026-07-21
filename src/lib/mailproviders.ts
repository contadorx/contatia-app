import "server-only";
import { promises as dns } from "dns";

// Detecta o provedor de e-mail pelo domínio e devolve host/porta/SSL/IMAP prontos,
// para o usuário só precisar informar e-mail + senha. Caminho: mapa de domínios
// públicos conhecidos → consulta de MX (pega Google Workspace/M365 em domínio próprio)
// → chute pelo padrão cPanel (mail.<domínio>). "known=false" pede confirmação do usuário.

export type MailProvider = {
  provider: string;
  label: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  imap_host: string;
  hint: string;
  known: boolean;
};

type Cfg = Omit<MailProvider, "known">;

const GMAIL: Cfg = { provider: "gmail", label: "Gmail", smtp_host: "smtp.gmail.com", smtp_port: 587, smtp_secure: false, imap_host: "imap.gmail.com", hint: "Exige verificação em 2 etapas e uma SENHA DE APP (não a senha normal da conta)." };
const WORKSPACE: Cfg = { ...GMAIL, label: "Google Workspace", hint: "Use seu e-mail completo e uma SENHA DE APP do Google (exige 2 etapas)." };
const M365: Cfg = { provider: "office365", label: "Outlook / Microsoft 365", smtp_host: "smtp.office365.com", smtp_port: 587, smtp_secure: false, imap_host: "outlook.office365.com", hint: "Use seu e-mail completo. Pode exigir SMTP AUTH habilitado pelo admin." };
const YAHOO: Cfg = { provider: "yahoo", label: "Yahoo", smtp_host: "smtp.mail.yahoo.com", smtp_port: 465, smtp_secure: true, imap_host: "imap.mail.yahoo.com", hint: "Exige uma senha de app gerada na conta Yahoo." };
const ZOHO: Cfg = { provider: "zoho", label: "Zoho Mail", smtp_host: "smtp.zoho.com", smtp_port: 465, smtp_secure: true, imap_host: "imap.zoho.com", hint: "Use uma senha de app do Zoho." };
const GODADDY: Cfg = { provider: "godaddy", label: "GoDaddy", smtp_host: "smtpout.secureserver.net", smtp_port: 465, smtp_secure: true, imap_host: "imap.secureserver.net", hint: "Use a senha do seu e-mail GoDaddy." };
const TITAN: Cfg = { provider: "titan", label: "Titan Email", smtp_host: "smtp.titan.email", smtp_port: 465, smtp_secure: true, imap_host: "imap.titan.email", hint: "Use a senha do seu e-mail Titan." };
const HOSTINGER: Cfg = { provider: "hostinger", label: "Hostinger", smtp_host: "smtp.hostinger.com", smtp_port: 465, smtp_secure: true, imap_host: "imap.hostinger.com", hint: "Use a senha do seu e-mail Hostinger." };
const UOL: Cfg = { provider: "uol", label: "UOL/BOL", smtp_host: "smtps.uol.com.br", smtp_port: 465, smtp_secure: true, imap_host: "imap.uol.com.br", hint: "Use a senha do seu e-mail UOL." };

const PUBLIC: Record<string, Cfg> = {
  "gmail.com": GMAIL, "googlemail.com": GMAIL,
  "outlook.com": M365, "outlook.com.br": M365, "hotmail.com": M365, "hotmail.com.br": M365, "live.com": M365, "msn.com": M365,
  "yahoo.com": YAHOO, "yahoo.com.br": YAHOO, "ymail.com": YAHOO,
  "zoho.com": ZOHO,
  "uol.com.br": UOL, "bol.com.br": UOL,
};

function cpanel(domain: string): Cfg {
  return { provider: "custom", label: "Servidor do domínio", smtp_host: `mail.${domain}`, smtp_port: 465, smtp_secure: true, imap_host: `mail.${domain}`, hint: "Chute pelo padrão cPanel (mail.<domínio>). Confirme host/porta/senha com sua hospedagem." };
}

function fromMx(mxHost: string, domain: string): Cfg | null {
  const h = (mxHost || "").toLowerCase();
  if (/google|googlemail|aspmx\.l\.google/.test(h)) return WORKSPACE;
  if (/outlook|office365|microsoft|protection\.outlook/.test(h)) return M365;
  if (/secureserver\.net/.test(h)) return GODADDY;
  if (/zoho/.test(h)) return ZOHO;
  if (/titan|registrar-servers/.test(h)) return TITAN;
  if (/hostinger/.test(h)) return HOSTINGER;
  if (/hostgator|websitewelcome|cpanel|bluehost/.test(h)) return cpanel(domain);
  return null;
}

export async function providerFromDomain(rawDomain: string): Promise<MailProvider> {
  const domain = (rawDomain || "").toLowerCase().trim().replace(/^@/, "");
  if (!domain || !domain.includes(".")) {
    return { provider: "custom", label: "", smtp_host: "", smtp_port: 587, smtp_secure: false, imap_host: "", hint: "", known: false };
  }

  if (PUBLIC[domain]) return { ...PUBLIC[domain], known: true };

  try {
    const mx = await dns.resolveMx(domain);
    const sorted = (mx || []).sort((a, b) => a.priority - b.priority);
    for (const m of sorted) {
      const hit = fromMx(m.exchange, domain);
      if (hit) return { ...hit, known: true };
    }
  } catch {
    /* sem MX / falha de DNS — cai no chute abaixo */
  }

  return { ...cpanel(domain), known: false };
}
