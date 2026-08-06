"use server";

import { msgErro } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dataCurta } from "@/lib/datas";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

// Cadastra um contato a partir de uma conversa (número desconhecido) e vincula as mensagens.
export async function createContactFromThread(input: { phone: string; name?: string }) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const phone = (input.phone || "").trim();
  if (!phone) return { error: "Conversa sem telefone." };
  const name = (input.name || "").trim() || phone;

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({ tenant_id, assigned_to: user_id, name, phone, origin: "WhatsApp", status: "novo" })
    .select("id")
    .single();
  if (error) return { error: msgErro(error) };

  // vincula as mensagens desse número ao novo contato
  await supabase.from("whatsapp_messages").update({ contact_id: (created as any).id }).eq("tenant_id", tenant_id).eq("phone", phone).is("contact_id", null);

  revalidatePath("/dashboard/respostas");
  return { ok: true, contactId: (created as any).id };
}

// Cadastra um contato a partir de uma conversa de E-MAIL (remetente desconhecido) e
// vincula as mensagens — habilita responder por e-mail em 1 clique, sem passo à parte.
export async function createContactFromEmailThread(input: { email: string; name?: string }) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const email = (input.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { error: "Conversa sem e-mail válido." };
  const name = (input.name || "").trim() || email.split("@")[0];

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({ tenant_id, assigned_to: user_id, name, email, origin: "E-mail", status: "novo" })
    .select("id")
    .single();
  if (error) return { error: msgErro(error) };

  await supabase.from("email_messages").update({ contact_id: (created as any).id }).eq("tenant_id", tenant_id).eq("email", email).is("contact_id", null);

  revalidatePath("/dashboard/respostas");
  return { ok: true, contactId: (created as any).id };
}

// Bloqueia o número: o webhook passa a ignorar, e o contato (se houver) vira opt-out (LGPD).
export async function blockThread(input: { phone: string; contactId?: string | null }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const phone = (input.phone || "").trim();
  if (!phone) return { error: "Conversa sem telefone." };

  await supabase.from("whatsapp_blocklist").upsert({ tenant_id, phone }, { onConflict: "tenant_id,phone", ignoreDuplicates: true });
  if (input.contactId) {
    await supabase.from("contacts").update({ opted_out: true }).eq("id", input.contactId);
  }
  revalidatePath("/dashboard/respostas");
  return { ok: true };
}

// ============================================================
// AS MESMAS AÇÕES, NOS DOIS CANAIS
//
// "Bloquear" e "Excluir" só existiam para WhatsApp — a conversa de e-mail não tinha
// nenhuma gestão, nem para tirar da caixa nem para parar de receber. Estas duas
// funções fecham a lacuna reaproveitando o que já existe:
//   · excluir  → `excluirConversas`, que desde a última entrega apaga os dois canais
//     e devolve quantas mensagens saíram;
//   · bloquear → `email_suppressions` (a lista que o envio já consulta antes de
//     mandar qualquer e-mail) + opt-out no contato, que é o equivalente honesto do
//     bloqueio por número.
// ============================================================
export async function deleteEmailThread(input: { email?: string | null; contactId?: string | null }) {
  const r = await excluirConversas([{ channel: "email", email: input.email || null, contactId: input.contactId || null }]);
  return r;
}

export async function blockEmailThread(input: { email?: string | null; contactId?: string | null }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const email = (input.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { error: "Conversa sem endereço de e-mail válido." };

  const { error } = await supabase
    .from("email_suppressions")
    .upsert({ tenant_id, email, reason: "manual" }, { onConflict: "tenant_id,email", ignoreDuplicates: true });
  if (error) return { error: msgErro(error) };

  if (input.contactId) {
    await supabase.from("contacts").update({ opted_out: true }).eq("id", input.contactId);
  }
  revalidatePath("/dashboard/respostas");
  return { ok: true };
}

// Remove a conversa da caixa (apaga as mensagens desse número/contato).
export async function deleteThread(input: { phone: string; contactId?: string | null }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  let q = supabase.from("whatsapp_messages").delete().eq("tenant_id", tenant_id);
  if (input.contactId) q = q.eq("contact_id", input.contactId);
  else q = q.eq("phone", (input.phone || "").trim()).is("contact_id", null);
  const { error } = await q;
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/respostas");
  return { ok: true };
}

// Exclui VÁRIAS conversas de WhatsApp de uma vez (apaga as mensagens de cada número/contato).
// ============================================================
// AÇÕES EM MASSA NA CAIXA — WhatsApp E e-mail
//
// A versão anterior só apagava WhatsApp: recebia `phone` e mexia apenas em
// `whatsapp_messages`. Na tela isso virava "Selecionar todas (WhatsApp)" e as conversas
// de e-mail ficavam acinzentadas, sem explicação — quem tem a caixa cheia de e-mail
// não tinha como limpar.
//
// Agora a conversa é identificada pelo que ela realmente é: canal + contato (ou o
// telefone/endereço solto, quando não há contato cadastrado).
// ============================================================
export type AlvoConversa = {
  channel: "whatsapp" | "email";
  contactId?: string | null;
  phone?: string | null;
  email?: string | null;
};

const FATIA = 150;   // ids por consulta (limite de tamanho da URL do PostgREST)

// Devolve QUANTAS LINHAS foram realmente afetadas. Sem isso, uma operação que não
// mexe em nada (RLS, filtro que não bate) é indistinguível de sucesso: a tela some
// com a barra de seleção, o usuário acha que apagou, e as conversas continuam lá.
// É exatamente o sintoma de "seleciono e não acontece nada".
async function porFatias<T>(itens: T[], fn: (fatia: T[]) => Promise<any>): Promise<number> {
  let total = 0;
  for (let i = 0; i < itens.length; i += FATIA) {
    const r = await fn(itens.slice(i, i + FATIA));
    if (r?.error) throw r.error;
    total += r?.count ?? 0;
  }
  return total;
}

// Aplica uma operação (apagar ou marcar como lida) às conversas selecionadas.
async function operarConversas(
  alvos: AlvoConversa[],
  op: "excluir" | "marcarLida" | "arquivar" | "desarquivar"
): Promise<{ ok?: boolean; whatsapp?: number; email?: number; mensagens?: number; error?: string }> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const lista = (alvos || []).filter((t) => t && (t.contactId || t.phone || t.email));
  if (!lista.length) return { error: "Nenhuma conversa selecionada." };

  const wa = lista.filter((t) => t.channel === "whatsapp");
  const em = lista.filter((t) => t.channel === "email");

  const waContatos = Array.from(new Set(wa.map((t) => t.contactId).filter(Boolean))) as string[];
  const waFones = Array.from(new Set(wa.filter((t) => !t.contactId).map((t) => (t.phone || "").trim()).filter(Boolean)));
  const emContatos = Array.from(new Set(em.map((t) => t.contactId).filter(Boolean))) as string[];
  const emEnderecos = Array.from(new Set(em.filter((t) => !t.contactId).map((t) => (t.email || "").trim().toLowerCase()).filter(Boolean)));

  const agora = new Date().toISOString();
  // `count: "exact"` faz o PostgREST devolver quantas linhas foram afetadas sem trazer
  // os dados. É o número que a tela precisa para nunca mais mentir "pronto" sem ter feito nada.
  const aplicar = (q: any) =>
    op === "excluir"
      ? q.delete({ count: "exact" })
      : op === "arquivar"
      ? q.update({ archived_at: agora }, { count: "exact" })
      : op === "desarquivar"
      ? q.update({ archived_at: null }, { count: "exact" })
      : q.update({ read_at: agora }, { count: "exact" });

  let mensagens = 0;
  try {
    if (waContatos.length) {
      mensagens += await porFatias(waContatos, (f) =>
        aplicar(supabase.from("whatsapp_messages")).eq("tenant_id", tenant_id).in("contact_id", f));
    }
    if (waFones.length) {
      mensagens += await porFatias(waFones, (f) =>
        aplicar(supabase.from("whatsapp_messages")).eq("tenant_id", tenant_id).in("phone", f).is("contact_id", null));
    }
    if (emContatos.length) {
      mensagens += await porFatias(emContatos, (f) =>
        aplicar(supabase.from("email_messages")).eq("tenant_id", tenant_id).in("contact_id", f));
    }
    if (emEnderecos.length) {
      mensagens += await porFatias(emEnderecos, (f) =>
        aplicar(supabase.from("email_messages")).eq("tenant_id", tenant_id).in("email", f).is("contact_id", null));
    }
  } catch (e: any) {
    return { error: msgErro(e) };
  }

  // Zero linhas com conversas selecionadas é FALHA, não sucesso silencioso.
  if (mensagens === 0) {
    return {
      error:
        op === "excluir"
          ? "Nenhuma mensagem foi apagada. As conversas selecionadas não bateram com nada no banco — me avise se isso se repetir."
          : op === "arquivar" || op === "desarquivar"
          ? "Nada mudou. Se a coluna de arquivo ainda não existe no banco, falta aplicar a migration 0107."
          : "Nenhuma conversa foi marcada como lida (talvez já estivessem todas lidas).",
    };
  }

  // Exclusão em massa na caixa é destrutiva e some com histórico de conversa —
  // vai para o registro, como as demais.
  if (op === "excluir") {
    const { logAction } = await import("@/lib/actionLog");
    const { data: { user } } = await supabase.auth.getUser();
    await logAction(supabase, {
      tenant_id,
      user_id: user?.id,
      action: "thread_delete_bulk",
      entity: "message",
      qtd: lista.length,
      detail: `Excluiu ${lista.length} conversa(s) da caixa (${wa.length} WhatsApp, ${em.length} e-mail) — ${mensagens} mensagens.`,
      meta: { whatsapp: wa.length, email: em.length, mensagens },
    });
  }

  revalidatePath("/dashboard/respostas");
  return { ok: true, whatsapp: wa.length, email: em.length, mensagens };
}

export async function excluirConversas(alvos: AlvoConversa[]) {
  return operarConversas(alvos, "excluir");
}

// ============================================================
// ARQUIVAR — o meio-termo que faltava
//
// A caixa só tinha "excluir": destrutivo, definitivo, e apaga histórico de conversa
// que às vezes você quer manter. Quem só quer LIMPAR A TELA era obrigado a apagar de
// verdade. Arquivar tira da caixa e mantém tudo no banco (coluna `archived_at`, 0107).
// Reversível pelo botão "ver arquivadas".
// ============================================================
export async function arquivarConversas(alvos: AlvoConversa[]) {
  return operarConversas(alvos, "arquivar");
}
export async function desarquivarConversas(alvos: AlvoConversa[]) {
  return operarConversas(alvos, "desarquivar");
}

export async function marcarConversasLidas(alvos: AlvoConversa[]) {
  return operarConversas(alvos, "marcarLida");
}

// Compatibilidade: assinatura antiga (só WhatsApp).
export async function deleteThreadsBulk(threads: { phone: string; contactId?: string | null }[]) {
  return excluirConversas((threads || []).map((t) => ({ channel: "whatsapp" as const, phone: t.phone, contactId: t.contactId })));
}

// Busca a mídia de uma mensagem sob demanda (não armazena nada).
export async function fetchMedia(messageId: string): Promise<{ dataUrl?: string; error?: string }> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { data: msg } = await supabase
    .from("whatsapp_messages")
    .select("id, raw, media_mime, account_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return { error: "Mensagem não encontrada." };
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance")
    .eq("id", (msg as any).account_id)
    .maybeSingle();
  if (!acc) return { error: "Instância não encontrada (a mídia vem do servidor do WhatsApp)." };

  const { getMediaBase64 } = await import("@/lib/whatsapp");
  const r = await getMediaBase64(acc as any, (msg as any).raw);
  if (r.error || !r.base64) return { error: r.error || "Mídia indisponível (pode ter expirado no WhatsApp)." };
  const mime = r.mimetype || (msg as any).media_mime || "application/octet-stream";
  return { dataUrl: `data:${mime};base64,${r.base64}` };
}

// Responde uma conversa pelo WhatsApp (envio automático — só no modo Evolution).
export async function replyWhatsApp(input: { contactId?: string | null; phone: string; text: string }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const text = (input.text || "").trim();
  if (!text) return { error: "Escreva uma mensagem." };
  if (!input.phone) return { error: "Conversa sem número de telefone." };

  // precisa de SESSÃO vinculada (híbrido ou automático), não de envio automático:
  // responder quem já te escreveu é o envio de menor risco que existe.
  const { data: t } = await supabase.from("tenants").select("whatsapp_mode").eq("id", tenant_id).maybeSingle();
  const { temSessao } = await import("@/lib/waModo");
  if (!temSessao((t as any)?.whatsapp_mode)) {
    return { error: "No modo assistido a resposta é manual: use o botão “Abrir WhatsApp”. Ative o modo híbrido ou o automático em Config → Canais para responder daqui." };
  }

  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("id, evolution_url, api_key, instance")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!acc) return { error: "Nenhuma instância WhatsApp conectada." };

  const { sendText } = await import("@/lib/whatsapp");
  const res = await sendText(acc as any, input.phone, text);
  if (res.error) return { error: res.error };

  await supabase.from("whatsapp_messages").insert({
    tenant_id,
    account_id: (acc as any).id,
    contact_id: input.contactId || null,
    phone: input.phone,
    direction: "out",
    text,
  });

  // ao responder, marca as recebidas dessa conversa como lidas
  await marcarLidas(supabase, tenant_id, input.contactId || null, input.phone);

  revalidatePath("/dashboard/respostas");
  return { ok: true };
}

// Marca uma conversa como lida (WhatsApp ou e-mail).
export async function markThreadRead(input: { contactId?: string | null; phone?: string; email?: string; channel?: "whatsapp" | "email" }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (input.channel === "email") {
    let q = supabase.from("email_messages").update({ read_at: new Date().toISOString() }).eq("tenant_id", tenant_id).eq("direction", "in").is("read_at", null);
    if (input.contactId) q = q.eq("contact_id", input.contactId);
    else q = q.eq("email", (input.email || "").toLowerCase());
    await q;
  } else {
    await marcarLidas(supabase, tenant_id, input.contactId || null, input.phone || "");
  }
  revalidatePath("/dashboard/respostas");
  return { ok: true };
}

// Responde uma conversa por E-MAIL (reaproveita o envio avulso: rotação/assinatura/cap).
export async function replyEmail(input: { contactId: string; subject: string; body: string }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const subject = (input.subject || "").trim() || "Re:";
  const body = (input.body || "").trim();
  if (!body) return { error: "Escreva a resposta." };
  if (!input.contactId) return { error: "Vincule o contato para responder por e-mail." };

  const { sendQuickEmail } = await import("@/app/dashboard/contatos/quick-send-actions");
  const r = (await sendQuickEmail(input.contactId, subject, body)) as any;
  if (r?.error) return { error: r.error };

  const { data: c } = await supabase.from("contacts").select("email").eq("id", input.contactId).maybeSingle();
  const { looksHtml, stripTags } = await import("@/lib/richtext");
  const logText = looksHtml(body) ? stripTags(body) : body; // histórico legível, sem tags
  await supabase.from("email_messages").insert({ tenant_id, contact_id: input.contactId, email: (c as any)?.email || null, direction: "out", subject, text: logText });
  await supabase.from("email_messages").update({ read_at: new Date().toISOString() }).eq("tenant_id", tenant_id).eq("contact_id", input.contactId).eq("direction", "in").is("read_at", null);
  revalidatePath("/dashboard/respostas");
  return { ok: true };
}

async function marcarLidas(supabase: any, tenant_id: string, contactId: string | null, phone: string) {
  const now = new Date().toISOString();
  let q = supabase
    .from("whatsapp_messages")
    .update({ read_at: now })
    .eq("tenant_id", tenant_id)
    .eq("direction", "in")
    .is("read_at", null);
  if (contactId) q = q.eq("contact_id", contactId);
  else q = q.eq("phone", phone);
  await q;
}

// ============================================================
// RASCUNHO DE RESPOSTA COM IA — estimulado, nunca automático
//
// Quem aperta o botão é a pessoa, e o que volta é texto na caixa de edição. Nada sai
// daqui para o lead: o envio continua sendo o botão "Enviar", com o texto que o humano
// aprovou (e quase sempre mexeu).
//
// A parte cara desta função não é a chamada ao modelo — é JUNTAR O CONTEXTO. Um
// rascunho genérico é pior que rascunho nenhum, porque ainda dá o trabalho de apagar.
// Por isso ela lê, antes de escrever: a conversa dos dois lados, os toques que já foram
// enviados na cadência, os sinais de engajamento das últimas semanas, quem é o lead, de
// que produto se trata e o contexto de negócio que o operador já escreveu uma vez para
// a IA de cadência (reaproveitado — ninguém quer preencher briefing duas vezes).
//
// A cota é a MESMA das gerações de cadência, de propósito: um número só de "IA no mês"
// é entendível; dois viram suporte.
// ============================================================
export async function rascunharResposta(input: {
  contactId?: string | null;
  phone?: string | null;
  canal: "whatsapp" | "email";
  instrucao?: string;
}): Promise<{ texto?: string; usados?: number; quota?: number; error?: string }> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const canal = input.canal === "email" ? "email" : "whatsapp";

  // ---- cota de uso justo (mesma bolsa da IA de cadência) ----
  const { data: tenant } = await supabase
    .from("tenants")
    .select("ai_model, ai_api_key, ai_context, email_signature, platform_plans(ai_quota, segment)")
    .eq("id", tenant_id)
    .maybeSingle();
  const plano = (tenant as any)?.platform_plans;
  const agora = new Date();
  const inicioDoMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString();
  let quota = plano?.ai_quota != null ? Number(plano.ai_quota) : 100;
  if (plano?.segment === "equipe") {
    const { count: assentos } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenant_id);
    quota = quota * Math.max(1, assentos ?? 1);
  }
  const { count: usados } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant_id)
    .in("type", ["ai_generation", "ai_generation_opus", "ai_rascunho"])
    .gte("created_at", inicioDoMes);
  if ((usados ?? 0) >= quota) {
    return { error: `Você atingiu o limite de ${quota} usos de IA neste mês (cadências + rascunhos). O limite renova no dia 1º.` };
  }

  // ---- quem é o lead ----
  let lead: any = null;
  if (input.contactId) {
    const { data } = await supabase
      .from("contacts")
      // `*`: uma coluna ausente aqui (o schema evoluiu por migrations aplicadas à mão)
      // faria o PostgREST recusar a consulta e o rascunho perderia QUEM é o lead.
      .select("*")
      .eq("id", input.contactId)
      .maybeSingle();
    lead = data;
  }
  if (!lead && !input.phone) return { error: "Conversa sem contato cadastrado — cadastre o contato para a IA ter com quem falar." };

  // ---- a conversa (os dois lados) ----
  const conversa: { de: "lead" | "voce"; texto: string; quando?: string | null }[] = [];
  if (canal === "whatsapp") {
    let q = supabase.from("whatsapp_messages").select("direction, text, created_at").order("created_at", { ascending: true }).limit(40);
    q = input.contactId ? q.eq("contact_id", input.contactId) : q.eq("phone", input.phone as string);
    const { data } = await q;
    for (const m of ((data as any[]) || [])) {
      if (!m.text) continue;
      conversa.push({ de: m.direction === "out" ? "voce" : "lead", texto: m.text, quando: m.created_at });
    }
  } else if (input.contactId) {
    const { data } = await supabase
      .from("email_messages")
      // a coluna do corpo chama `text` (0077) — pedir `body` faria o PostgREST recusar
      // a consulta inteira e o rascunho sairia sem conhecer a conversa, em silêncio.
      .select("direction, subject, text, created_at")
      .eq("contact_id", input.contactId)
      .order("created_at", { ascending: true })
      .limit(40);
    for (const m of ((data as any[]) || [])) {
      const t = [m.subject ? `(${m.subject})` : "", m.text || ""].filter(Boolean).join(" ");
      if (!t.trim()) continue;
      conversa.push({ de: m.direction === "out" ? "voce" : "lead", texto: t, quando: m.created_at });
    }
  }

  // ---- os toques da cadência que JÁ SAÍRAM (para não repetir argumento) ----
  const toques: { canal: string; titulo?: string | null; texto?: string | null; quando?: string | null }[] = [];
  let cadencia: string | null = null;
  let produto: string | null = null;
  if (input.contactId) {
    const { data: feitas } = await supabase
      .from("tasks")
      .select("channel, title, generated_content, completed_at, enrollment_id")
      .eq("contact_id", input.contactId)
      .eq("status", "done")
      .order("completed_at", { ascending: true })
      .limit(10);
    for (const t of ((feitas as any[]) || [])) {
      toques.push({ canal: t.channel, titulo: t.title, texto: t.generated_content, quando: t.completed_at ? dataCurta(t.completed_at) : null });
    }
    const enrollmentId = ((feitas as any[]) || []).map((t) => t.enrollment_id).filter(Boolean).pop();
    if (enrollmentId) {
      const { data: enr } = await supabase
        .from("enrollments")
        .select("sequences(name, products(name))")
        .eq("id", enrollmentId)
        .maybeSingle();
      cadencia = ((enr as any)?.sequences?.name as string) || null;
      produto = ((enr as any)?.sequences?.products?.name as string) || null;
    }
  }

  // ---- sinais de engajamento (o que ele fez, além de escrever) ----
  const sinais: string[] = [];
  if (input.contactId) {
    const { data: evs } = await supabase
      .from("events")
      .select("type, created_at, meta")
      .eq("contact_id", input.contactId)
      .in("type", ["email_opened", "link_clicked", "doc_opened", "meeting"])
      .order("created_at", { ascending: false })
      .limit(20);
    const conta: Record<string, number> = {};
    const urls: string[] = [];
    for (const e of ((evs as any[]) || [])) {
      conta[e.type] = (conta[e.type] || 0) + 1;
      if (e.type === "link_clicked" && e.meta?.url && urls.length < 3) urls.push(String(e.meta.url).slice(0, 120));
    }
    if (conta.email_opened) sinais.push(`abriu o e-mail ${conta.email_opened}x (abertura é sinal fraco: pode ser o servidor dele)`);
    if (conta.link_clicked) sinais.push(`clicou em link ${conta.link_clicked}x${urls.length ? ` — ${urls.join(", ")}` : ""}`);
    if (conta.doc_opened) sinais.push(`ABRIU A PROPOSTA ${conta.doc_opened}x (sinal forte de compra)`);
    if (conta.meeting) sinais.push("já tem reunião marcada");
  }

  // ---- contexto de negócio: o MESMO briefing da IA de cadência ----
  const ai = ((tenant as any)?.ai_context as Record<string, any>) || {};
  const negocio = [
    ai.market ? `Mercado: ${ai.market}` : null,
    ai.product ? `Produto: ${ai.product}` : null,
    ai.icp ? `Cliente ideal: ${ai.icp}` : null,
    ai.tone ? `Tom: ${ai.tone}` : null,
    ai.pain ? `Dor que resolve: ${ai.pain}` : null,
    ai.proof ? `Provas: ${ai.proof}` : null,
    ai.avoid ? `Evitar: ${ai.avoid}` : null,
  ].filter(Boolean).join("\n") || null;

  const { montarPrompt, limparRascunho } = await import("@/lib/copiloto");
  const { system, pergunta } = montarPrompt({
    canal,
    lead: {
      nome: lead?.name,
      empresa: lead?.company,
      cargo: lead?.role_title,
      atividade: (lead?.custom as any)?.cnae_descricao || lead?.cnae || null,
    },
    produto: produto || ai.product || null,
    cadencia,
    toquesEnviados: toques,
    sinais,
    conversa,
    negocio,
    instrucao: input.instrucao,
  });

  const { assistantReply } = await import("@/lib/aichat");
  const r = await assistantReply({
    system,
    messages: [{ role: "user", content: pergunta }],
    // mesmo modelo da geração de cadência (o tenant pode ter o dele); rascunho de
    // resposta é onde o texto encosta no cliente, então não é lugar de economizar.
    model: ((tenant as any)?.ai_model as string) || process.env.ANTHROPIC_MODEL || undefined,
  });
  if (r.error) return { error: r.error };
  const texto = limparRascunho(r.text || "");
  if (!texto) return { error: "A IA não devolveu texto. Tente de novo." };

  // conta o uso só quando deu certo — erro de API não pode consumir cota
  await supabase.from("events").insert({
    tenant_id,
    contact_id: input.contactId || null,
    type: "ai_rascunho",
    meta: { canal, comInstrucao: !!input.instrucao?.trim() },
  } as any);

  return { texto, usados: (usados ?? 0) + 1, quota };
}
