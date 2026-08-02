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
  // Sócios (nomes) quando a base/API já os traz no resultado da busca. Opcional:
  // se a API do VPS ainda não expõe sócios, fica indefinido e o app enriquece por CNPJ.
  socios?: string[] | null;
};

export type FiltroReceita = {
  atividade?: string;
  cnae?: string[];
  // uf/porte SINGLE continuam existindo por COMPATIBILIDADE: a API v2 no VPS só
  // entende um valor. Quando o operador marca vários, mandamos `ufs`/`portes`
  // (arrays, entendidos pela v3) E o primeiro valor em `uf`/`porte` — assim uma
  // API antiga devolve um resultado mais estreito em vez de quebrar.
  uf?: string;
  ufs?: string[];
  municipio?: string;
  porte?: "ME" | "EPP" | "Demais";
  portes?: string[];
  matriz?: boolean;
  com_email?: boolean;
  email_corporativo?: boolean;
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

// fetch com timeout REAL (aborta a conexão). Antes o AbortController não era ligado
// ao fetch, então o "timeout" não cancelava nada e uma base travada penduraria a ação.
function fetchTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

// ============================================================
// BUG QUE ESTAVA AQUI: o nome do erro de timeout
//
// O código testava `e.name === "AbortError"` para dizer "Base demorou a responder".
// Só que `AbortSignal.timeout()` NÃO rejeita com AbortError — rejeita com
// **TimeoutError**. (AbortError é o que o AbortController.abort() produz.)
//
// Resultado: TODO timeout caía no `else` e virava "Base indisponível." — a mensagem que
// significa "a conexão nem se estabeleceu". Passamos horas procurando um servidor
// caído, um certificado vencido e um nginx com problema, quando o servidor estava de pé
// e a consulta é que demorava demais. A mensagem errada custou mais que o bug.
//
// É a segunda vez neste projeto que um teste de NOME/CÓDIGO de erro erra o alvo (a
// primeira foi PGRST204 vs 42703, que sumiu com 257 envios). A lição repetida: não
// depender de um identificador exato quando dá para verificar o comportamento.
// ============================================================
function msgFalha(e: any): string {
  const nome = String(e?.name || "");
  const txt = String(e?.message || "");
  if (/timeout|abort/i.test(nome) || /timeout|aborted/i.test(txt)) {
    return "A base demorou demais e eu cancelei a busca. Escolha um município (ou um estado) para reduzir o volume.";
  }
  return "Base indisponível (não consegui nem abrir a conexão com o servidor da base).";
}

// Autocomplete de atividade (texto → lista de CNAEs com descrição).
export async function buscarAtividades(q: string): Promise<{ atividades: { cnae: string; descricao: string }[]; error?: string }> {
  const { url, token } = cfg();
  if (!url || !token) return { atividades: [], error: "Base da Receita não configurada." };
  if ((q || "").trim().length < 3) return { atividades: [] };
  try {
    const res = await fetchTimeout(
      `${url}/atividades?q=${encodeURIComponent(q.trim())}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      10_000
    );
    if (!res.ok) return { atividades: [], error: `Base respondeu ${res.status}` };
    const j = await res.json();
    return { atividades: Array.isArray(j.atividades) ? j.atividades : [] };
  } catch (e: any) {
    return { atividades: [], error: msgFalha(e) };
  }
}

// Busca UMA empresa pelo CNPJ completo (14 dígitos) — usado na busca por CNPJ.
export async function buscarEmpresaPorCnpj(cnpj: string): Promise<{ empresa: EmpresaReceita | null; error?: string }> {
  const { url, token } = cfg();
  if (!url || !token) return { empresa: null, error: "Base da Receita não configurada." };
  const d = (cnpj || "").replace(/\D/g, "");
  if (d.length !== 14) return { empresa: null, error: "CNPJ deve ter 14 dígitos." };
  try {
    const res = await fetchTimeout(
      `${url}/empresa/${d}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      10_000
    );
    if (res.status === 404) return { empresa: null };
    if (!res.ok) return { empresa: null, error: `Base respondeu ${res.status}` };
    const j = await res.json();
    return { empresa: j as EmpresaReceita };
  } catch (e: any) {
    return { empresa: null, error: msgFalha(e) };
  }
}

// Busca empresas ativas por filtros. Retorna a página + total (se contar=true) + os CNAEs que casaram.
// `multi` = a API do VPS confirmou que entende listas de UF/porte (v3). Se vier false
// e o operador marcou vários, a tela avisa que só o primeiro valor foi considerado.
export async function buscarEmpresas(
  f: FiltroReceita,
  timeoutMs = 25_000
): Promise<{ rows: EmpresaReceita[]; total: number | null; atividades: { cnae: string; descricao: string }[]; multi?: boolean; error?: string }> {
  const { url, token } = cfg();
  if (!url || !token) return { rows: [], total: null, atividades: [], error: "Base da Receita não configurada." };
  try {
    const res = await fetchTimeout(
      `${url}/buscar`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(f),
        cache: "no-store",
      },
      timeoutMs
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { rows: [], total: null, atividades: [], error: j?.error || `Base respondeu ${res.status}` };
    return {
      rows: Array.isArray(j.rows) ? j.rows : [],
      total: typeof j.total === "number" ? j.total : null,
      atividades: Array.isArray(j.atividades) ? j.atividades : [],
      multi: j?.multi === true,
    };
  } catch (e: any) {
    return { rows: [], total: null, atividades: [], error: msgFalha(e) };
  }
}
