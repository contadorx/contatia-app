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
// Devolve { ok } de propósito: quem envia PRECISA saber se o registro entrou. Um envio
// sem evento é invisível para o limite diário — e foi assim que 300 e-mails saíram com
// o contador marcando 40.
export async function scoreEvent(
  supabase: any,
  args: ScoreArgs & { user_id?: string | null }
): Promise<{ ok: boolean; error?: string }> {
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

  // ============================================================
  // POR QUE ESTA REGRAVAÇÃO EXISTE — e por que a versão anterior não funcionava
  //
  // A coluna `user_id` só existe depois da migration 0106. Enquanto ela não for
  // aplicada, o insert falha — e um envio sem evento é INVISÍVEL: não conta no limite
  // diário nem no painel do dia.
  //
  // A primeira versão testava o código `42703`, que é o do POSTGRES para "coluna não
  // existe". Só que quem responde aqui é o PostgREST, e para coluna desconhecida num
  // insert ele devolve o código DELE — `PGRST204` ("could not find the column ... in
  // the schema cache"). Como o teste nunca batia, a regravação nunca acontecia e TODO
  // evento se perdia em silêncio. Foi assim que 297 tarefas concluídas viraram 40
  // eventos registrados.
  //
  // A correção não é acrescentar PGRST204 à lista: é parar de depender do código.
  // Falhou com `user_id`? Tenta SEM ele. O evento é mais importante que a autoria.
  // ============================================================
  let falhaEvento: string | null = null;
  const gravar = async (l: Record<string, any>) => (await supabase.from("events").insert(l))?.error || null;

  const err1 = await gravar(linha);
  if (err1) {
    if (linha.user_id !== undefined) {
      const semAutor = { ...linha };
      delete semAutor.user_id;
      const err2 = await gravar(semAutor);
      falhaEvento = err2 ? (err2.message || "erro ao registrar") : null;
    } else {
      falhaEvento = err1.message || "erro ao registrar";
    }
  }
  if (!contact_id) return { ok: !falhaEvento, error: falhaEvento || undefined };
  const pts = POINTS[type] ?? 0;
  if (!pts) {
    await supabase.from("contacts").update({ last_activity_at: new Date().toISOString() }).eq("id", contact_id);
    return { ok: !falhaEvento, error: falhaEvento || undefined };
  }
  const { data: c } = await supabase.from("contacts").select("score").eq("id", contact_id).single();
  const newScore = (c?.score ?? 0) + pts;
  await supabase
    .from("contacts")
    .update({ score: newScore, last_activity_at: new Date().toISOString() })
    .eq("id", contact_id);
  return { ok: !falhaEvento, error: falhaEvento || undefined };
}
