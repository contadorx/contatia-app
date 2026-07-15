// ============================================================
// Cliente da API da Base da Receita (roda no VPS).
//
// Configuração (variáveis de ambiente na Vercel):
//   RECEITA_API_URL   = https://receita.contatia.com.br
//   RECEITA_API_TOKEN = o mesmo token do .env do servidor
//
// A base NÃO é o Supabase — é o Postgres da Receita atrás da API. Só o servidor
// (Server Actions/rotas) fala com ela; o token nunca vai pro navegador.
// ============================================================

export type EmpresaReceita = {
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnae: string | null;
  cnae_descricao: string | null;
  uf: string | null;
  municipio: string | null;
  bairro: string | null;
  cep: string | null;
  telefone: string | null;
  telefone2: string | null;
  email: string | null;
  porte: string | null;
  matriz: boolean;
};

export type FiltroReceita = {
  atividade?: string;
  cnae?: string[];
  uf?: string;
  municipio?: string;
  porte?: "ME" | "EPP" | "Demais";
  matriz?: boolean;
  com_email?: boolean;
  com_telefone?: boolean;
  termo?: string;
  limit?: number;
  offset?: number;
  contar?: boolean;
};

export function receitaConfigurada(): boolean {
  return !!(process.env.RECEITA_API_URL && process.env.RECEITA_API_TOKEN);
}

function cfg() {
  const url = (process.env.RECEITA_API_URL || "").replace(/\/+$/, "");
  const token = process.env.RECEITA_API_TOKEN || "";
  return { url, token };
}

async function comTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await p;
  } finally {
    clearTimeout(t);
  }
}

// Autocomplete de atividade (texto → lista de CNAEs com descrição).
export async function buscarAtividades(q: string): Promise<{ atividades: { cnae: string; descricao: string }[]; error?: string }> {
  const { url, token } = cfg();
  if (!url || !token) return { atividades: [], error: "Base da Receita não configurada." };
  if ((q || "").trim().length < 3) return { atividades: [] };
  try {
    const res = await comTimeout(
      fetch(`${url}/atividades?q=${encodeURIComponent(q.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }),
      10_000
    );
    if (!res.ok) return { atividades: [], error: `Base respondeu ${res.status}` };
    const j = await res.json();
    return { atividades: Array.isArray(j.atividades) ? j.atividades : [] };
  } catch (e: any) {
    return { atividades: [], error: e?.name === "AbortError" ? "Base demorou a responder." : "Base indisponível." };
  }
}

// Busca empresas ativas por filtros. Retorna a página + total (se contar=true) + os CNAEs que casaram.
export async function buscarEmpresas(
  f: FiltroReceita
): Promise<{ rows: EmpresaReceita[]; total: number | null; atividades: { cnae: string; descricao: string }[]; error?: string }> {
  const { url, token } = cfg();
  if (!url || !token) return { rows: [], total: null, atividades: [], error: "Base da Receita não configurada." };
  try {
    const res = await comTimeout(
      fetch(`${url}/buscar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(f),
        cache: "no-store",
      }),
      25_000
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { rows: [], total: null, atividades: [], error: j?.error || `Base respondeu ${res.status}` };
    return {
      rows: Array.isArray(j.rows) ? j.rows : [],
      total: typeof j.total === "number" ? j.total : null,
      atividades: Array.isArray(j.atividades) ? j.atividades : [],
    };
  } catch (e: any) {
    return { rows: [], total: null, atividades: [], error: e?.name === "AbortError" ? "Base demorou a responder." : "Base indisponível." };
  }
}
