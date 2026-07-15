import "server-only";

export type CnpjData = {
  razao_social?: string;
  nome_fantasia?: string;
  cnae?: string;
  cnae_descricao?: string;
  uf?: string;
  municipio?: string;
  situacao?: string;
  porte?: string;
  email?: string;
  telefone?: string;
  telefone2?: string;
  bairro?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  socios?: string[];
  capital_social?: number;
  natureza_juridica?: string;
  abertura?: string;
};

function onlyDigits(s: string) {
  return (s || "").replace(/\D/g, "");
}

// User-Agent explícito: a BrasilAPI fica atrás de Cloudflare, que responde 403 a
// requisições sem User-Agent. Um UA identificável resolve.
const UA = "Contatia/1.0 (+https://contatia.com.br)";

// Mapeia a resposta da NOSSA base (rota /empresa) para o CnpjData.
function mapBase(e: any): CnpjData {
  return {
    razao_social: e.razao_social || undefined,
    nome_fantasia: e.nome_fantasia || undefined,
    cnae: e.cnae || undefined,
    cnae_descricao: e.cnae_descricao || undefined,
    uf: e.uf || undefined,
    municipio: e.municipio || undefined,
    situacao: e.situacao ? String(e.situacao).toUpperCase() : undefined,
    porte: e.porte || undefined,
    email: e.email || undefined,
    telefone: e.telefone || undefined,
    telefone2: e.telefone2 || undefined,
    bairro: e.bairro || undefined,
    cep: e.cep || undefined,
    abertura: e.data_inicio || undefined,
  };
}

// Mapeia um provedor externo (BrasilAPI / ReceitaWS — shapes tolerantes) para CnpjData.
// É aqui que entram os campos que a nossa base não tem: rua/número/complemento,
// sócios, capital social e natureza jurídica.
function mapExterno(j: any): CnpjData {
  const cnaePrincipal = j.cnae_fiscal || j.cnae_fiscal_principal?.codigo || j.atividade_principal?.[0]?.code;
  const cnaeDesc = j.cnae_fiscal_descricao || j.cnae_fiscal_principal?.descricao || j.atividade_principal?.[0]?.text;
  const socios = Array.isArray(j.qsa)
    ? j.qsa.map((s: any) => s.nome_socio || s.nome || s.nome_representante).filter(Boolean)
    : [];
  const capital = typeof j.capital_social === "number" ? j.capital_social : undefined;
  return {
    razao_social: j.razao_social || j.nome || undefined,
    nome_fantasia: j.nome_fantasia || j.fantasia || undefined,
    cnae: cnaePrincipal ? String(cnaePrincipal) : undefined,
    cnae_descricao: cnaeDesc || undefined,
    uf: j.uf || undefined,
    municipio: j.municipio || undefined,
    situacao: j.descricao_situacao_cadastral || j.situacao || undefined,
    porte: j.descricao_porte || j.porte || undefined,
    email: j.email || undefined,
    telefone: j.ddd_telefone_1 || j.telefone || undefined,
    telefone2: j.ddd_telefone_2 || undefined,
    bairro: j.bairro || undefined,
    cep: j.cep ? String(j.cep).replace(/\D/g, "") : undefined,
    logradouro: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(" ").trim() || undefined,
    numero: j.numero || undefined,
    complemento: j.complemento || undefined,
    socios,
    capital_social: capital,
    natureza_juridica: j.natureza_juridica || undefined,
    abertura: j.data_inicio_atividade || j.abertura || undefined,
  };
}

// Consulta os provedores externos (BrasilAPI com fallback ReceitaWS).
async function fetchExterno(cnpj: string): Promise<{ data?: CnpjData; error?: string }> {
  const custom = process.env.CNPJ_PROVIDER_URL; // ex.: https://.../{cnpj}
  const primary = custom ? custom.replace("{cnpj}", cnpj) : `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`;
  const fallback = custom ? null : `https://receitaws.com.br/v1/cnpj/${cnpj}`;
  const headers = { accept: "application/json", "user-agent": UA } as Record<string, string>;

  let lastStatus = 0;
  try {
    const res = await fetch(primary, { headers });
    lastStatus = res.status;
    if (res.ok) {
      const j: any = await res.json();
      if (j && (j.razao_social || j.nome || j.cnpj)) return { data: mapExterno(j) };
    }
  } catch { /* cai no fallback */ }

  if (fallback) {
    try {
      const res = await fetch(fallback, { headers });
      if (res.ok) {
        const j: any = await res.json();
        if (j && j.status !== "ERROR" && (j.nome || j.razao_social)) return { data: mapExterno(j) };
        if (j && j.status === "ERROR") return { error: j.message || "CNPJ não encontrado." };
      } else if (res.status === 429) {
        return { error: "Limite da API pública de CNPJ atingido." };
      }
    } catch { /* usa a mensagem abaixo */ }
  }

  if (lastStatus === 429) return { error: "Limite da API pública de CNPJ atingido." };
  if (lastStatus === 404) return { error: "CNPJ não encontrado na base pública." };
  if (lastStatus) return { error: `API CNPJ ${lastStatus}.` };
  return { error: "Sem resposta dos provedores externos." };
}

const pref = <T,>(a: T | undefined | null, b: T | undefined | null): T | undefined =>
  (a !== undefined && a !== null && a !== ("" as any) ? a : b ?? undefined) as T | undefined;

// Enriquece um CNPJ. Fonte PRINCIPAL: a nossa base da Receita (grátis, sem limite);
// COMPLEMENTO: BrasilAPI/ReceitaWS para o que a base não guarda (rua/número/complemento,
// sócios, capital social, natureza jurídica). Se a base não estiver configurada ou não
// achar, usa só o provedor externo (comportamento antigo).
export async function enrichCnpj(cnpjRaw: string): Promise<{ data?: CnpjData; error?: string; fontes?: string[] }> {
  const cnpj = onlyDigits(cnpjRaw);
  if (cnpj.length !== 14) return { error: "CNPJ inválido." };

  const fontes: string[] = [];

  // 1) nossa base (rápida e ilimitada)
  let base: CnpjData | null = null;
  try {
    const { buscarEmpresaPorCnpj, receitaConfigurada } = await import("@/lib/receita");
    if (receitaConfigurada()) {
      const r = await buscarEmpresaPorCnpj(cnpj);
      if (r.empresa) { base = mapBase(r.empresa); fontes.push("base"); }
    }
  } catch { /* segue sem a base */ }

  // 2) provedor externo (complementa endereço/sócios/capital/natureza)
  const ext = await fetchExterno(cnpj);
  const externo = ext.data || null;
  if (externo) fontes.push("brasilapi");

  if (!base && !externo) return { error: ext.error || "Não foi possível enriquecer." };

  // merge: base ganha no núcleo; o externo preenche o que a base não tem
  const data: CnpjData = {
    razao_social: pref(base?.razao_social, externo?.razao_social),
    nome_fantasia: pref(base?.nome_fantasia, externo?.nome_fantasia),
    cnae: pref(base?.cnae, externo?.cnae),
    cnae_descricao: pref(base?.cnae_descricao, externo?.cnae_descricao),
    uf: pref(base?.uf, externo?.uf),
    municipio: pref(base?.municipio, externo?.municipio),
    situacao: pref(base?.situacao, externo?.situacao),
    porte: pref(base?.porte, externo?.porte),
    email: pref(base?.email, externo?.email),
    telefone: pref(base?.telefone, externo?.telefone),
    telefone2: pref(base?.telefone2, externo?.telefone2),
    bairro: pref(base?.bairro, externo?.bairro),
    cep: pref(base?.cep, externo?.cep),
    // só o externo costuma ter estes:
    logradouro: pref(externo?.logradouro, base?.logradouro),
    numero: pref(externo?.numero, base?.numero),
    complemento: pref(externo?.complemento, base?.complemento),
    socios: externo?.socios?.length ? externo.socios : base?.socios,
    capital_social: pref(externo?.capital_social, base?.capital_social),
    natureza_juridica: pref(externo?.natureza_juridica, base?.natureza_juridica),
    abertura: pref(externo?.abertura, base?.abertura),
  };

  return { data, fontes };
}

export { onlyDigits };
