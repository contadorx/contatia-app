// Lead scoring. Cada evento vale pontos; o score do contato ordena a fila e
// marca "quente". Sem tabela nova: usa contacts.score/last_activity_at (0002) + events.

export const POINTS: Record<string, number> = {
  replied: 30, // respondeu — o sinal mais forte
  meeting: 20, // reunião marcada
  doc_opened: 15, // abriu a proposta — sinal de compra forte
  email_opened: 15, // abriu (fatia futura de tracking de e-mail)
  link_clicked: 10,
  task_done: 2, // toque executado
  email_sent: 1, // envio
};

export const HOT_THRESHOLD = 25;

type ScoreArgs = {
  tenant_id: string;
  contact_id: string | null | undefined;
  type: string;
  meta?: Record<string, unknown>;
  email_account_id?: string | null;
};

// supabase = client já autenticado (server action / route). Insere o evento e
// incrementa o score do contato de forma incremental.
export async function scoreEvent(supabase: any, args: ScoreArgs & { user_id?: string | null }) {
  const { tenant_id, contact_id, type } = args;
  // `user_id` = quem apertou o botão (migration 0106). Sem ele não dá para responder
  // "quanto EU enviei hoje" — a tabela sabia QUE saiu, não QUEM mandou.
  // Nulo é legítimo: cron e automações não têm autor.
  const linha: Record<string, any> = {
    tenant_id,
    contact_id: contact_id ?? null,
    type,
    meta: args.meta ?? {},
    email_account_id: args.email_account_id ?? null,
  };
  if (args.user_id) linha.user_id = args.user_id;
  const { error: errEvt } = await supabase.from("events").insert(linha);
  // 42703 = coluna user_id ainda não existe (0106 não aplicada). Regrava sem ela em
  // vez de perder o evento — o app é publicado antes da migration ser rodada à mão.
  if (errEvt && String((errEvt as any).code) === "42703") {
    delete linha.user_id;
    await supabase.from("events").insert(linha);
  }
  if (!contact_id) return;
  const pts = POINTS[type] ?? 0;
  if (!pts) {
    await supabase.from("contacts").update({ last_activity_at: new Date().toISOString() }).eq("id", contact_id);
    return;
  }
  const { data: c } = await supabase.from("contacts").select("score").eq("id", contact_id).single();
  const newScore = (c?.score ?? 0) + pts;
  await supabase
    .from("contacts")
    .update({ score: newScore, last_activity_at: new Date().toISOString() })
    .eq("id", contact_id);
}
