import "server-only";

// ============================================================
// ENVIOS DE HOJE — quanto eu já mandei, a que horas, e quanto ainda posso
//
// A pergunta que originou isto: "a Sureya está enviando e-mails e não sabe quando
// enviou." Não era falta de tela — era falta de DADO: `events` registrava que um e-mail
// saiu, mas não quem apertou o botão. A migration 0106 acrescentou `events.user_id`.
//
// Três decisões que valem a pena registrar:
//
// 1) O DIA é o de BRASÍLIA, não o do servidor. O servidor roda em UTC; usar o dia dele
//    faria o contador zerar às 21h — e o limite anti-ban do WhatsApp seria burlado sem
//    ninguém perceber. É o mesmo cálculo que o envio já usa para o cap diário.
//
// 2) Eventos ANTIGOS não têm autor e aparecem como "sem autor". Preferi mostrar isso a
//    inventar dono: eram enviados quando a informação não existia.
//
// 3) Quem não é gestor só enxerga os próprios envios. A RLS de `events` é por workspace,
//    então o recorte por pessoa é feito aqui — e é intencional que gestor veja todos:
//    é ele quem precisa saber se alguém está passando do limite.
// ============================================================

export type LinhaEnvio = {
  quando: string;          // ISO
  tipo: "email_sent" | "whatsapp_sent";
  contato: string | null;
  caixa: string | null;    // from_email, quando for e-mail
  autor: string;           // nome de quem enviou (ou "— sem autor —")
  souEu: boolean;
};

export type ResumoEnvios = {
  meusEmails: number;
  meusWhats: number;
  ultimoMeu: string | null;      // ISO do meu envio mais recente
  totalEquipe: number;
  porPessoa: { nome: string; emails: number; whats: number; ultimo: string | null; souEu: boolean }[];
  linhas: LinhaEnvio[];          // detalhe, mais recente primeiro
  capacidade: { caixa: string; usados: number; teto: number; aquecendo: boolean }[];
  semAutoria: boolean;           // migration 0106 ainda não aplicada
};

// Meia-noite de Brasília, em UTC. Mesma conta do cap diário no envio.
export function inicioDoDiaBRT(): Date {
  const OFFSET = 3 * 3600000;
  const agoraBRT = new Date(Date.now() - OFFSET);
  return new Date(Date.UTC(agoraBRT.getUTCFullYear(), agoraBRT.getUTCMonth(), agoraBRT.getUTCDate()) + OFFSET);
}

export async function enviosDeHoje(
  supabase: any,
  opts: { tenantId: string; meuId?: string; gestor: boolean }
): Promise<ResumoEnvios> {
  const desde = inicioDoDiaBRT().toISOString();

  const vazio: ResumoEnvios = {
    meusEmails: 0, meusWhats: 0, ultimoMeu: null, totalEquipe: 0,
    porPessoa: [], linhas: [], capacidade: [], semAutoria: false,
  };

  // `select("*")` de propósito: pedir a coluna user_id explicitamente faria a tela
  // inteira quebrar enquanto a 0106 não estivesse aplicada.
  const { data: eventos, error } = await supabase
    .from("events")
    .select("*")
    .in("type", ["email_sent", "whatsapp_sent"])
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return vazio;

  const linhasBrutas = ((eventos as any[]) || []);
  const semAutoria = linhasBrutas.length > 0 && linhasBrutas.every((e) => e.user_id === undefined);

  // nomes das pessoas e das caixas, numa consulta cada
  const idsPessoas = Array.from(new Set(linhasBrutas.map((e) => e.user_id).filter(Boolean)));
  const idsCaixas = Array.from(new Set(linhasBrutas.map((e) => e.email_account_id).filter(Boolean)));
  const idsContatos = Array.from(new Set(linhasBrutas.map((e) => e.contact_id).filter(Boolean))).slice(0, 150);

  const [pessoas, caixas, contatos] = await Promise.all([
    idsPessoas.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", idsPessoas.slice(0, 150))
      : Promise.resolve({ data: [] }),
    supabase.from("email_accounts").select("id, from_email, daily_cap, created_at, warmup_stage, is_active"),
    idsContatos.length
      ? supabase.from("contacts").select("id, name").in("id", idsContatos)
      : Promise.resolve({ data: [] }),
  ]);

  const nomePessoa: Record<string, string> = {};
  for (const p of ((pessoas as any).data || [])) nomePessoa[p.id] = p.full_name || p.email || "—";
  const emailCaixa: Record<string, string> = {};
  for (const c of ((caixas as any).data || [])) emailCaixa[c.id] = c.from_email;
  const nomeContato: Record<string, string> = {};
  for (const c of ((contatos as any).data || [])) nomeContato[c.id] = c.name;

  const SEM_AUTOR = "— sem autor —";
  const visiveis = linhasBrutas.filter((e) => opts.gestor || !e.user_id || e.user_id === opts.meuId);

  const linhas: LinhaEnvio[] = visiveis.map((e) => ({
    quando: e.created_at,
    tipo: e.type,
    contato: e.contact_id ? (nomeContato[e.contact_id] || null) : null,
    caixa: e.email_account_id ? (emailCaixa[e.email_account_id] || null) : null,
    autor: e.user_id ? (nomePessoa[e.user_id] || "outro membro") : SEM_AUTOR,
    souEu: !!opts.meuId && e.user_id === opts.meuId,
  }));

  // por pessoa
  const agg = new Map<string, { nome: string; emails: number; whats: number; ultimo: string | null; souEu: boolean }>();
  for (const e of linhasBrutas) {
    const chave = e.user_id || "__sem__";
    const nome = e.user_id ? (nomePessoa[e.user_id] || "outro membro") : SEM_AUTOR;
    const a = agg.get(chave) || { nome, emails: 0, whats: 0, ultimo: null, souEu: !!opts.meuId && e.user_id === opts.meuId };
    if (e.type === "email_sent") a.emails++; else a.whats++;
    if (!a.ultimo || e.created_at > a.ultimo) a.ultimo = e.created_at;
    agg.set(chave, a);
  }

  const meus = linhasBrutas.filter((e) => opts.meuId && e.user_id === opts.meuId);

  // capacidade restante das caixas (mesmo cálculo do envio)
  const { effectiveDailyCap } = await import("@/lib/warmup");
  const usadosPorCaixa: Record<string, number> = {};
  for (const e of linhasBrutas) {
    if (e.type === "email_sent" && e.email_account_id) {
      usadosPorCaixa[e.email_account_id] = (usadosPorCaixa[e.email_account_id] || 0) + 1;
    }
  }
  const capacidade = ((caixas as any).data || [])
    .filter((c: any) => c.is_active)
    .map((c: any) => {
      const warmupOn = (c.warmup_stage ?? 0) !== -1;
      const { cap, warming } = effectiveDailyCap(c.created_at, c.daily_cap ?? 40, warmupOn);
      return { caixa: c.from_email, usados: usadosPorCaixa[c.id] || 0, teto: cap, aquecendo: !!warming };
    })
    .sort((a: any, b: any) => b.usados - a.usados);

  return {
    meusEmails: meus.filter((e) => e.type === "email_sent").length,
    meusWhats: meus.filter((e) => e.type === "whatsapp_sent").length,
    ultimoMeu: meus[0]?.created_at || null,
    totalEquipe: linhasBrutas.length,
    porPessoa: [...agg.values()].sort((a, b) => (b.emails + b.whats) - (a.emails + a.whats)),
    linhas: linhas.slice(0, 200),
    capacidade,
    semAutoria,
  };
}
