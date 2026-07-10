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
export async function scoreEvent(supabase: any, args: ScoreArgs) {
  const { tenant_id, contact_id, type } = args;
  await supabase.from("events").insert({
    tenant_id,
    contact_id: contact_id ?? null,
    type,
    meta: args.meta ?? {},
    email_account_id: args.email_account_id ?? null,
  });
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
