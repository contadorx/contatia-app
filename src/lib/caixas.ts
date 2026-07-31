import "server-only";

// Resolve a CAIXA de e-mail de uma inscrição (enrollment), com rodízio no pool do
// produto. Ordem: override da cadência → pool do produto (sorteia entre as ativas)
// → caixa única legada do produto → null (rodízio geral no envio).
//
// O sorteio dentro do pool dá a rotação por CONTATO (todos os passos do contato
// saem da mesma caixa = sender consistente); contatos diferentes caem em caixas
// diferentes. Os limites diários/aquecimento continuam sendo respeitados no envio.
export async function resolveEmailBox(db: any, _tenantId: string, sequenceId: string): Promise<string | null> {
  const { data: seq } = await db
    .from("sequences")
    .select("product_id, email_account_id")
    .eq("id", sequenceId)
    .maybeSingle();

  // 1) override explícito da cadência
  const seqBox = ((seq as any)?.email_account_id as string) || null;
  if (seqBox) return seqBox;

  const productId = ((seq as any)?.product_id as string) || null;
  if (!productId) return null;

  // 2) pool do produto — só as caixas ATIVAS entram no rodízio
  const { data: pool } = await db
    .from("product_email_accounts")
    .select("email_account_id")
    .eq("product_id", productId);
  let ids = ((pool as any[]) || []).map((r) => r.email_account_id).filter(Boolean);
  if (ids.length) {
    const { data: ativas } = await db.from("email_accounts").select("id").in("id", ids).eq("is_active", true);
    ids = ((ativas as any[]) || []).map((a) => a.id);
    if (ids.length) return ids[Math.floor(Math.random() * ids.length)];
  }

  // 3) caixa única legada do produto (0064)
  const { data: prod } = await db.from("products").select("email_account_id").eq("id", productId).maybeSingle();
  return ((prod as any)?.email_account_id as string) || null;
}

// ============================================================
// POOL de caixas — a MESMA regra do resolveEmailBox, resolvida UMA vez
//
// resolveEmailBox() faz até 4 consultas e sorteia uma caixa. Chamá-lo por contato numa
// inscrição de 300 pessoas são ~1.200 idas ao banco só para escolher remetente.
//
// Aqui as consultas acontecem uma vez e devolvemos os CANDIDATOS; quem sorteia é o
// chamador, por contato. Isso preserva o comportamento que importa — contatos
// diferentes caem em caixas diferentes, e todos os passos de UM contato saem da mesma
// caixa (sender consistente) — sem pagar o preço por contato.
// ============================================================
export async function poolDeCaixas(db: any, _tenantId: string, sequenceId: string): Promise<string[]> {
  const { data: seq } = await db
    .from("sequences")
    .select("product_id, email_account_id")
    .eq("id", sequenceId)
    .maybeSingle();

  // 1) override explícito da cadência — candidato único
  const seqBox = ((seq as any)?.email_account_id as string) || null;
  if (seqBox) return [seqBox];

  const productId = ((seq as any)?.product_id as string) || null;
  if (!productId) return [];

  // 2) pool do produto — só as ATIVAS entram no rodízio
  const { data: pool } = await db
    .from("product_email_accounts")
    .select("email_account_id")
    .eq("product_id", productId);
  const ids = ((pool as any[]) || []).map((r) => r.email_account_id).filter(Boolean);
  if (ids.length) {
    const { data: ativas } = await db.from("email_accounts").select("id").in("id", ids).eq("is_active", true);
    const vivas = ((ativas as any[]) || []).map((a) => a.id);
    if (vivas.length) return vivas;
  }

  // 3) caixa única legada do produto (0064)
  const { data: prod } = await db.from("products").select("email_account_id").eq("id", productId).maybeSingle();
  const legada = ((prod as any)?.email_account_id as string) || null;
  return legada ? [legada] : [];
}

export function sortearCaixa(pool: string[]): string | null {
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ============================================================
// ESCOLHER A CAIXA DO ENVIO — por CAMADAS, não por folga pura
//
// O QUE ESTAVA ERRADO: a rotação pegava todas as caixas ativas e escolhia a de maior
// folga no dia. Isso ignora DE QUEM é a caixa. Consequência real observada: um gestor
// sem caixa própria enviou por uma caixa PESSOAL de outra pessoa, só porque ela era a
// mais nova e portanto a mais vazia. O destinatário veria o endereço da colega, e a
// resposta cairia na caixa dela.
//
// "Compartilhada" nunca quis dizer "use antes das outras" — quis dizer "empreste a quem
// não tiver a sua". Por isso agora existe ordem:
//
//   1. a MINHA caixa            → a marca certa, a resposta volta para mim
//   2. a caixa DO WORKSPACE     → o endereço institucional, de todos
//   3. a caixa emprestada       → último recurso, e é de outra pessoa
//
// Dentro de cada camada continua valendo a maior folga (protege a reputação do domínio).
//
// E UM SEGUNDO DEFEITO: `verified` era ignorado. Uma caixa que reprovou no teste de
// conexão continuava entrando no rodízio — e então TODO envio que caísse nela falhava.
// Era assim que uma caixa quebrada virava a remetente de todo mundo, em silêncio.
// Agora ela só é usada se não existir nenhuma caixa boa com folga.
// ============================================================
export type CaixaCandidata = {
  id: string;
  user_id?: string | null;
  is_shared?: boolean | null;
  verified?: boolean | null;
  from_email?: string | null;
  [k: string]: any;
};

export function escolherCaixa(
  caixas: CaixaCandidata[],
  folgaDe: (c: CaixaCandidata) => number,
  meuId: string | undefined
): { caixa: CaixaCandidata | null; folga: number; camada: string; usouReprovada: boolean } {
  const camadas: { nome: string; filtro: (c: CaixaCandidata) => boolean }[] = [
    { nome: "própria", filtro: (c) => !!c.user_id && c.user_id === meuId },
    { nome: "do workspace", filtro: (c) => !c.user_id },
    { nome: "emprestada", filtro: (c) => !!c.user_id && c.user_id !== meuId && !!c.is_shared },
  ];

  // Duas passadas: primeiro só as que NÃO reprovaram; se nenhuma servir, aceita as
  // reprovadas (melhor tentar e falhar com mensagem clara do que travar a fila do dia).
  for (const aceitaReprovada of [false, true]) {
    for (const camada of camadas) {
      let melhor: CaixaCandidata | null = null;
      let melhorFolga = 0;
      for (const c of caixas) {
        if (!camada.filtro(c)) continue;
        if (!aceitaReprovada && c.verified === false) continue;
        const f = folgaDe(c);
        if (f > 0 && f > melhorFolga) { melhorFolga = f; melhor = c; }
      }
      if (melhor) {
        return { caixa: melhor, folga: melhorFolga, camada: camada.nome, usouReprovada: aceitaReprovada };
      }
    }
  }
  return { caixa: null, folga: 0, camada: "", usouReprovada: false };
}

// Traduz o erro do servidor SMTP para algo acionável. O 535 é o mais comum e o mais
// mal explicado: o texto do servidor ("Incorrect authentication data") não diz que,
// em servidor cPanel/Exim — Locaweb, HostGator, KingHost, Titan —, a causa nº 1 é o
// usuário estar cadastrado sem o domínio.
export function msgSmtp(erro: any, caixa?: string | null): string {
  const m = String(erro?.message || erro || "");
  const de = caixa ? ` pela caixa ${caixa}` : "";

  if (/535|534|Invalid login|Username and Password not accepted|authentication failed|Incorrect authentication/i.test(m)) {
    return (
      `O servidor de e-mail recusou o login${de}: usuário ou senha não conferem. ` +
      `Três causas, nesta ordem de frequência: (1) o campo "usuário" precisa ser o e-mail COMPLETO ` +
      `(fulano@dominio.com.br), e não só "fulano"; (2) a senha mudou no provedor; ` +
      `(3) se for Gmail/Google Workspace com verificação em duas etapas, é preciso uma "senha de app", ` +
      `não a senha normal. Corrija em Configurações → Canais e use "Testar conexão".`
    );
  }
  if (/Application-specific password required/i.test(m)) {
    return `O Google exige uma "senha de app" para esta caixa${de} — a senha normal não funciona com verificação em duas etapas. Gere em myaccount.google.com → Segurança → Senhas de app.`;
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) {
    return `O endereço do servidor SMTP não foi encontrado${de}. Confira o campo "host" em Configurações → Canais.`;
  }
  if (/ECONNREFUSED|ETIMEDOUT|ESOCKET|Connection timeout|Greeting never received/i.test(m)) {
    return `O servidor SMTP não respondeu${de}. Costuma ser porta errada: 587 com "conexão segura" desligada, ou 465 com ela ligada.`;
  }
  if (/self.signed|certificate|SSL|TLS/i.test(m)) {
    return `O certificado do servidor SMTP não foi aceito${de}. Confira se a porta e a opção "conexão segura" combinam (587 sem / 465 com).`;
  }
  if (/550|553|relay|not permitted|Sender address rejected/i.test(m)) {
    return `O servidor recusou o remetente${de}. O endereço "de" precisa ser o mesmo da conta autenticada no provedor.`;
  }
  if (/421|450|4\.7\.|too many|rate/i.test(m)) {
    return `O servidor pediu para desacelerar${de} (limite temporário). Tente de novo em alguns minutos.`;
  }
  return `Falha no envio${de}: ${m || "erro desconhecido"}`;
}
