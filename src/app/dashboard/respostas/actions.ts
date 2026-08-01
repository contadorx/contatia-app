"use server";

import { msgErro } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
  op: "excluir" | "marcarLida"
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

  // envio automático só existe no modo Evolution
  const { data: t } = await supabase.from("tenants").select("whatsapp_mode").eq("id", tenant_id).maybeSingle();
  if (((t as any)?.whatsapp_mode || "assistido") !== "evolution") {
    return { error: "No modo assistido a resposta é manual: use o botão “Abrir WhatsApp”. Ative o modo automático em Config → WhatsApp para responder daqui." };
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
