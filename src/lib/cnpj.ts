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

// User-Agent explícito: a BrasilAPI fica atrás de Cloudflare, que responde 403 a
// requisições sem User-Agent (causa do CON-06). Um UA identificável resolve.
const UA = "Contatia/1.0 (+https://contatia.com.br)";

// Converte o JSON de um provedor (BrasilAPI ou ReceitaWS — shapes tolerantes) no
// nosso CnpjData. Ambos trazem campos parecidos ou mapeáveis.
function mapCnpj(j: any): CnpjData {
  const cnaePrincipal = j.cnae_fiscal || j.cnae_fiscal_principal?.codigo || j.atividade_principal?.[0]?.code;
  const cnaeDesc = j.cnae_fiscal_descricao || j.cnae_fiscal_principal?.descricao || j.atividade_principal?.[0]?.text;
  const socios = Array.isArray(j.qsa)
    ? j.qsa.map((s: any) => s.nome_socio || s.nome || s.nome_representante).filter(Boolean)
    : [];
  return {
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
}

// Enriquece um CNPJ. Provider padrão: BrasilAPI (grátis), com fallback automático
// para a ReceitaWS quando a BrasilAPI bloqueia/limita (403/429/5xx). Configurável
// por env CNPJ_PROVIDER_URL (deve conter {cnpj}).
export async function enrichCnpj(cnpjRaw: string): Promise<{ data?: CnpjData; error?: string }> {
  const cnpj = onlyDigits(cnpjRaw);
  if (cnpj.length !== 14) return { error: "CNPJ inválido." };

  const custom = process.env.CNPJ_PROVIDER_URL; // ex.: https://.../{cnpj}
  const primary = custom ? custom.replace("{cnpj}", cnpj) : `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`;
  const fallback = custom ? null : `https://receitaws.com.br/v1/cnpj/${cnpj}`;

  const headers = { accept: "application/json", "user-agent": UA } as Record<string, string>;

  // tenta o provedor principal
  let lastStatus = 0;
  try {
    const res = await fetch(primary, { headers });
    lastStatus = res.status;
    if (res.ok) {
      const j: any = await res.json();
      if (j && (j.razao_social || j.nome || j.cnpj)) return { data: mapCnpj(j) };
    }
  } catch { /* cai no fallback */ }

  // fallback (ReceitaWS) quando o principal falhou por bloqueio/limite
  if (fallback) {
    try {
      const res = await fetch(fallback, { headers });
      if (res.ok) {
        const j: any = await res.json();
        // ReceitaWS sinaliza erro no corpo, não no status
        if (j && j.status !== "ERROR" && (j.nome || j.razao_social)) return { data: mapCnpj(j) };
        if (j && j.status === "ERROR") return { error: j.message || "CNPJ não encontrado." };
      } else if (res.status === 429) {
        return { error: "Limite da API de CNPJ atingido. Tente em 1 minuto." };
      }
    } catch { /* usa a mensagem do principal abaixo */ }
  }

  if (lastStatus === 429) return { error: "Limite da API de CNPJ atingido. Tente em instantes." };
  if (lastStatus === 404) return { error: "CNPJ não encontrado na base pública." };
  if (lastStatus) return { error: `API CNPJ ${lastStatus}.` };
  return { error: "Falha ao consultar CNPJ (sem resposta dos provedores)." };
}

export { onlyDigits };
