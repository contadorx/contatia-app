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
  socios?: string[];
};

function onlyDigits(s: string) {
  return (s || "").replace(/\D/g, "");
}

// Enriquece um CNPJ. Provider padrão: BrasilAPI (grátis). Configurável por env
// CNPJ_PROVIDER_URL (deve conter {cnpj}) para plugar CNPJ.ws/ReceitaWS depois.
export async function enrichCnpj(cnpjRaw: string): Promise<{ data?: CnpjData; error?: string }> {
  const cnpj = onlyDigits(cnpjRaw);
  if (cnpj.length !== 14) return { error: "CNPJ inválido." };

  const custom = process.env.CNPJ_PROVIDER_URL; // ex.: https://.../{cnpj}
  const url = custom ? custom.replace("{cnpj}", cnpj) : `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`;

  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      if (res.status === 429) return { error: "Limite da API de CNPJ atingido. Tente em instantes." };
      return { error: `API CNPJ ${res.status}.` };
    }
    const j: any = await res.json();

    // Mapeamento tolerante (BrasilAPI e variantes)
    const cnaePrincipal = j.cnae_fiscal || j.cnae_fiscal_principal?.codigo || j.atividade_principal?.[0]?.code;
    const cnaeDesc = j.cnae_fiscal_descricao || j.cnae_fiscal_principal?.descricao || j.atividade_principal?.[0]?.text;
    const socios = Array.isArray(j.qsa)
      ? j.qsa.map((s: any) => s.nome_socio || s.nome || s.nome_representante).filter(Boolean)
      : [];

    const data: CnpjData = {
      razao_social: j.razao_social || j.nome || undefined,
      nome_fantasia: j.nome_fantasia || j.fantasia || undefined,
      cnae: cnaePrincipal ? String(cnaePrincipal) : undefined,
      cnae_descricao: cnaeDesc || undefined,
      uf: j.uf || undefined,
      municipio: j.municipio || undefined,
      situacao: j.descricao_situacao_cadastral || j.situacao || undefined,
      porte: j.porte || j.descricao_porte || undefined,
      email: j.email || undefined,
      telefone: j.ddd_telefone_1 || j.telefone || undefined,
      socios,
    };
    return { data };
  } catch (e: any) {
    return { error: e?.message || "Falha ao consultar CNPJ." };
  }
}

export { onlyDigits };
