// ============================================================
// PASSO CONDICIONAL — "só manda o WhatsApp se ele abriu o e-mail"
//
// A cadência hoje é uma régua: passo 1 no dia 0, passo 2 no dia 3, aconteça o que
// acontecer. Isso trata igual quem abriu três vezes e quem nunca viu nada — e é o
// oposto do que um vendedor faz na vida real.
//
// DUAS FAMÍLIAS DE CONDIÇÃO, e elas são resolvidas em momentos diferentes:
//
//   DADO (tem_whatsapp, tem_email, tem_instagram, tem_linkedin)
//       Já era resolvida na INSCRIÇÃO: passo de e-mail não vira tarefa para quem não
//       tem e-mail. O que faltava era o caso do dado que MUDA: o contato foi
//       enriquecido depois, ou o número se provou sem WhatsApp no meio do caminho.
//       Por isso ela é reconferida na hora do toque.
//
//   COMPORTAMENTO (abriu_email, nao_abriu_email, clicou, nao_clicou)
//       Não tem como ser resolvida na inscrição — a resposta não existe ainda. É
//       avaliada quando o passo VENCE.
//
// SOBRE "NÃO ABRIU": abertura é sinal fraco (o servidor do destinatário pode buscar a
// imagem sozinho, e quem bloqueia imagem abre sem contar). Por isso "não abriu" NUNCA
// deve ser usado para punir — serve para escolher outro caminho, não para desistir do
// lead. A tela diz isso onde a condição é escolhida.
//
// O QUE ACONTECE quando a condição não bate: a tarefa é PULADA (status 'skipped'), com
// o motivo registrado. Nunca fica pendente para sempre — tarefa que não pode sair e não
// sai do caminho é a que entope a fila e some com a confiança no número do dia.
// ============================================================

export type TipoCondicao =
  | "abriu_email"
  | "nao_abriu_email"
  | "clicou"
  | "nao_clicou"
  | "tem_whatsapp"
  | "tem_email"
  | "tem_instagram"
  | "tem_linkedin";

export type Condicao = {
  tipo: TipoCondicao;
  /** posição do passo observado; vazio = qualquer passo anterior desta cadência */
  passo?: number | null;
};

export const CONDICOES: { v: TipoCondicao; label: string; ajuda: string }[] = [
  { v: "abriu_email", label: "só se abriu o e-mail", ajuda: "Manda só para quem abriu algum e-mail anterior desta cadência." },
  { v: "nao_abriu_email", label: "só se NÃO abriu o e-mail", ajuda: "Outro caminho para quem não deu sinal. Lembre que abertura é sinal fraco: use para mudar de canal, não para desistir." },
  { v: "clicou", label: "só se clicou num link", ajuda: "Clique é sinal firme — ninguém clica sem querer." },
  { v: "nao_clicou", label: "só se NÃO clicou", ajuda: "Para insistir por outro ângulo com quem leu e não agiu." },
  { v: "tem_whatsapp", label: "só se tem WhatsApp confirmado", ajuda: "Reconfere na hora do toque: o contato pode ter sido enriquecido depois da inscrição." },
  { v: "tem_email", label: "só se tem e-mail", ajuda: "Idem — o e-mail pode ter sido descoberto depois." },
  { v: "tem_instagram", label: "só se tem Instagram", ajuda: "Sem perfil não existe link para abrir." },
  { v: "tem_linkedin", label: "só se tem LinkedIn", ajuda: "Sem perfil não existe link para abrir." },
];

export function rotuloCondicao(c?: Condicao | null): string | null {
  if (!c?.tipo) return null;
  const base = CONDICOES.find((x) => x.v === c.tipo)?.label || c.tipo;
  return c.passo != null ? `${base} (passo ${c.passo + 1})` : base;
}

// Normaliza o que veio da tela/URL. Tipo desconhecido vira NENHUMA condição — e isso é
// seguro aqui, ao contrário dos filtros: sem condição o passo simplesmente sai, que é o
// comportamento de sempre. Inventar uma condição que ninguém pediu é que seria ruim.
export function normalizarCondicao(v: any): Condicao | null {
  const tipo = String(v?.tipo || "").trim() as TipoCondicao;
  if (!CONDICOES.some((c) => c.v === tipo)) return null;
  const passo = Number.isFinite(Number(v?.passo)) && v?.passo !== null && v?.passo !== "" ? Number(v.passo) : null;
  return { tipo, passo };
}

export type Avaliacao = { ok: boolean; motivo: string | null };

// ============================================================
// A AVALIAÇÃO
//
// `contato` traz o cadastro (para as condições de DADO). Os sinais de comportamento
// vêm de `email_opens`/`link_clicks` quando a 0108 está aplicada e, como plano B, dos
// EVENTOS do contato — que existem desde sempre. O plano B importa: sem ele, quem
// ainda não aplicou a 0108 veria toda condição de abertura falhar, e a cadência
// inteira seria pulada em silêncio. Falhar fechado aqui seria o pior dos mundos.
// ============================================================
export async function avaliarCondicao(
  supabase: any,
  cond: Condicao | null | undefined,
  ctx: { contactId?: string | null; enrollmentId?: string | null; contato?: any }
): Promise<Avaliacao> {
  const c = normalizarCondicao(cond);
  if (!c) return { ok: true, motivo: null };

  const contato = ctx.contato || {};

  // ---- condições de DADO: resposta imediata ----
  if (c.tipo === "tem_email") {
    const tem = !!String(contato.email || "").trim();
    return { ok: tem, motivo: tem ? null : "o contato continua sem e-mail" };
  }
  if (c.tipo === "tem_whatsapp") {
    const tem = !!String(contato.phone || "").trim() && contato.wa_status !== "invalid";
    return { ok: tem, motivo: tem ? null : "o número não tem WhatsApp (ou o contato está sem telefone)" };
  }
  if (c.tipo === "tem_instagram") {
    const tem = !!String(contato.instagram || "").trim();
    return { ok: tem, motivo: tem ? null : "o contato não tem Instagram" };
  }
  if (c.tipo === "tem_linkedin") {
    const tem = !!String(contato.linkedin || "").trim();
    return { ok: tem, motivo: tem ? null : "o contato não tem LinkedIn" };
  }

  // ---- condições de COMPORTAMENTO ----
  const querAbertura = c.tipo === "abriu_email" || c.tipo === "nao_abriu_email";
  let houve = false;

  if (ctx.enrollmentId) {
    try {
      const tabela = querAbertura ? "email_opens" : "link_clicks";
      const campo = querAbertura ? "opens" : "clicks";
      let q = supabase.from(tabela).select(`${campo}, step_position`).eq("enrollment_id", ctx.enrollmentId);
      if (c.passo != null) q = q.eq("step_position", c.passo);
      const { data, error } = await q;
      if (!error) {
        houve = ((data as any[]) || []).some((r) => Number(r[campo]) > 0);
      } else {
        throw error;
      }
    } catch {
      // 0108 ausente ou consulta recusada: cai no plano B (eventos)
      houve = await porEventos(supabase, ctx.contactId, querAbertura);
    }
  } else {
    houve = await porEventos(supabase, ctx.contactId, querAbertura);
  }

  if (c.tipo === "abriu_email") return { ok: houve, motivo: houve ? null : "ainda não há registro de abertura" };
  if (c.tipo === "nao_abriu_email") return { ok: !houve, motivo: houve ? "o contato já abriu o e-mail" : null };
  if (c.tipo === "clicou") return { ok: houve, motivo: houve ? null : "ainda não houve clique" };
  return { ok: !houve, motivo: houve ? "o contato já clicou num link" : null };
}

async function porEventos(supabase: any, contactId?: string | null, abertura = true): Promise<boolean> {
  if (!contactId) return false;
  const { data } = await supabase
    .from("events")
    .select("id")
    .eq("contact_id", contactId)
    .eq("type", abertura ? "email_opened" : "link_clicked")
    .limit(1);
  return (((data as any[]) || []).length) > 0;
}
