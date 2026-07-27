// ============================================================
// Tradutor de erros CRUS (Supabase/Postgres, provedores externos) para linguagem
// do usuário. Use SOMENTE em erros técnicos (ex.: error.message de uma query) —
// nunca em mensagens que já são amigáveis (essas você retorna direto).
//
// Regra: reconhece o padrão → devolve texto claro; se parecer técnico e não bater,
// devolve um fallback genérico (nunca mostra SQL/stack ao usuário).
// ============================================================
export function msgErro(e: any, fallback = "Algo deu errado. Tente de novo em instantes."): string {
  if (!e) return fallback;
  const code = String(e?.code || "");
  const raw = String(e?.message || e || "").trim();
  const m = raw.toLowerCase();

  // --- Postgres / PostgREST ---
  if (code === "23505" || /duplicate key|already exists|unique constraint/.test(m)) return "Esse registro já existe.";
  if (code === "23503" || /foreign key/.test(m)) return "Não dá para concluir: há dados vinculados a este item.";
  if (code === "23502" || /not-null|null value in column/.test(m)) return "Faltou preencher um campo obrigatório.";
  if (code === "23514" || /check constraint/.test(m)) return "Um dos valores informados não é válido.";
  if (code === "22P02" || code === "22007" || /invalid input syntax|invalid.*date/.test(m)) return "Um dos valores está num formato inválido.";
  if (code === "42501" || /permission denied|row-level security|violates row-level/.test(m)) return "Você não tem permissão para fazer isso.";
  if (code === "PGRST301" || /jwt|not authenticated|auth session|session.*(expired|missing)|invalid.*token|refresh.*token/.test(m))
    return "Sua sessão expirou. Recarregue a página e tente de novo.";

  // --- rede / disponibilidade ---
  if (/fetch failed|network|econnrefused|enotfound|eai_again|timeout|etimedout|socket hang|aborterror|failed to fetch/.test(m))
    return "Sem conexão no momento. Tente de novo em instantes.";
  if (code === "429" || /rate limit|too many requests|\b429\b/.test(m)) return "Muitas tentativas seguidas. Espere um instante e tente de novo.";

  // --- provedores externos ---
  if (/evolution\s*\d{3}|whatsapp/.test(m)) return "O WhatsApp não respondeu agora. Tente de novo em instantes.";
  if (/brevo|smtp|imap/.test(m)) return "O serviço de e-mail não respondeu agora. Tente de novo em instantes.";

  // --- parece técnico (SQL/stack/infra) → não mostra cru ---
  if (/(relation |column |syntax error|constraint|pgrst|supabase|violates|undefined |cannot read|null value|stack|econn|parse)/.test(m))
    return fallback;

  // frase curta e legível (pode já ser amigável) → deixa passar; senão, fallback
  if (raw && raw.length <= 140 && !/[{}\[\]<>]/.test(raw) && !/\bat\b.*\(/.test(raw)) return raw;
  return fallback;
}
