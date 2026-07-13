"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dominioDe, discoverEmail, workerConfigurado } from "@/lib/emailFinder";
import { findPublishedEmail } from "@/lib/webEmail";

// ============================================================
// BUSCA DO E-MAIL DO DECISOR — AGORA NA HORA.
//
// ANTES: enfileirava e o cron processava... uma vez por dia, às 11h. A tela
// dizia "em alguns minutos" e o resultado só vinha no dia seguinte. Péssimo.
//
// AGORA: a busca roda na hora e devolve o resultado direto. São poucos segundos
// (o servidor testa os padrões de e-mail um a um).
// ============================================================

export type ResultadoBusca = {
  ok: boolean;
  email?: string | null;
  status: "valid" | "published" | "not_found" | "uncertain" | "blocked" | "invalid" | "error" | "sem_worker";
  titulo: string;
  detalhe: string;
  tentativas?: { email: string; status: string }[];
};

const EXPLICACAO: Record<string, { titulo: string; detalhe: string }> = {
  valid: {
    titulo: "E-mail encontrado e confirmado",
    detalhe: "O servidor de e-mail da empresa confirmou que esta caixa existe. O contato já pode entrar numa cadência de e-mail.",
  },
  published: {
    titulo: "E-mail da empresa (publicado no site)",
    detalhe: "Não confirmamos o e-mail pessoal do decisor, mas a empresa publicou este endereço no próprio site — é um canal válido e seguro (ela o divulgou para ser contatada).",
  },
  not_found: {
    titulo: "Nenhum e-mail encontrado",
    detalhe: "Testamos os padrões usuais (joao.silva@, jsilva@, joao@…) e o servidor recusou todos. Este contato não tem e-mail neste domínio — use WhatsApp ou LinkedIn.",
  },
  uncertain: {
    titulo: "Não dá para confiar neste domínio",
    detalhe: "O servidor desta empresa aceita QUALQUER endereço (é o que se chama catch-all), então ele diria 'sim' para qualquer palpite. Não vamos arriscar um bounce — use WhatsApp ou peça o e-mail.",
  },
  blocked: {
    titulo: "O provedor não permite verificar",
    detalhe: "Esta empresa usa Google Workspace ou Microsoft 365, que bloqueiam a verificação. O e-mail pode até existir, mas não temos como confirmar — use WhatsApp ou peça o e-mail.",
  },
  invalid: {
    titulo: "Domínio sem servidor de e-mail",
    detalhe: "Este domínio não tem servidor de e-mail configurado. Confira se o endereço está certo.",
  },
  error: {
    titulo: "Não consegui completar a busca",
    detalhe: "O serviço de verificação não respondeu. Tente de novo em instantes.",
  },
  sem_worker: {
    titulo: "Serviço de busca não configurado",
    detalhe: "O servidor de verificação de e-mail ainda não foi ligado. Configure WORKER_URL e WORKER_TOKEN no ambiente.",
  },
};

export async function buscarEmailAgora(contactId: string, siteOuDominio: string): Promise<ResultadoBusca> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  const tenant_id = (prof as any)?.tenant_id;

  if (!tenant_id) {
    return { ok: false, status: "error", ...EXPLICACAO.error, detalhe: "Sem workspace." };
  }

  const dominio = dominioDe(siteOuDominio);
  if (!dominio) {
    return {
      ok: false,
      status: "invalid",
      titulo: "Domínio inválido",
      detalhe: "Informe algo como empresa.com.br (pode colar o site completo).",
    };
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, email, account_id")
    .eq("id", contactId)
    .maybeSingle();

  if (!contact) {
    return { ok: false, status: "error", titulo: "Contato não encontrado", detalhe: "" };
  }
  if ((contact as any).email) {
    return {
      ok: false,
      status: "error",
      titulo: "Este contato já tem e-mail",
      detalhe: "Apague o e-mail atual se quiser procurar outro.",
    };
  }

  // guarda o domínio (no contato e na empresa) mesmo que a busca falhe
  await supabase.from("contacts").update({ company_domain: dominio } as any).eq("id", contactId);

  const accId = (contact as any).account_id;
  if (accId) {
    await supabase
      .from("accounts")
      .update({ domain: dominio, website: `https://${dominio}` } as any)
      .eq("id", accId)
      .eq("tenant_id", tenant_id);
  }

  // ---- 1) DECISOR: padrões nome@domínio confirmados no servidor (worker SMTP) ----
  let tentativas: { email: string; status: string }[] = [];
  let workerStatus: string | null = null;
  if (workerConfigurado()) {
    const r = await discoverEmail((contact as any).name, dominio);
    tentativas = (r.tentativas || []).map((t) => ({ email: t.email, status: t.status }));
    workerStatus = r.status;

    if (r.status === "valid" && r.email) {
      await supabase
        .from("contacts")
        .update({ email: r.email, email_status: "ok", email_discovery: "valid", email_discovered_at: new Date().toISOString() } as any)
        .eq("id", contactId);
      await supabase.from("events").insert({
        tenant_id, contact_id: contactId, type: "note",
        meta: { text: `E-mail do decisor confirmado no servidor: ${r.email}` },
      } as any);
      revalidatePath(`/dashboard/contatos/${contactId}`);
      return { ok: true, email: r.email, status: "valid", ...EXPLICACAO.valid, tentativas };
    }
  }

  // ---- 2) CAMADA 0: e-mail publicado no site (funciona SEM worker, sem porta 25) ----
  const pub = await findPublishedEmail(dominio);
  if (pub) {
    await supabase
      .from("contacts")
      .update({ email: pub.email, email_status: "ok", email_discovery: "published", email_discovered_at: new Date().toISOString() } as any)
      .eq("id", contactId);
    await supabase.from("events").insert({
      tenant_id, contact_id: contactId, type: "note",
      meta: { text: `E-mail publicado no site da empresa: ${pub.email} (${pub.source})` },
    } as any);
    revalidatePath(`/dashboard/contatos/${contactId}`);
    return { ok: true, email: pub.email, status: "published", ...EXPLICACAO.published, tentativas };
  }

  // ---- 3) Nada confirmado ----
  if (!workerConfigurado()) {
    return {
      ok: false, email: null, status: "not_found", tentativas: [],
      titulo: "Nenhum e-mail encontrado no site",
      detalhe: "Não há e-mail publicado no site desta empresa. Para testar os padrões do decisor (nome@empresa) com confirmação no servidor, ligue o worker de verificação (WORKER_URL / WORKER_TOKEN).",
    };
  }

  const status = (workerStatus as any) || "not_found";
  const exp = EXPLICACAO[status] || EXPLICACAO.not_found;
  await supabase
    .from("contacts")
    .update({ email_discovery: status, email_discovered_at: new Date().toISOString() } as any)
    .eq("id", contactId);
  await supabase.from("events").insert({
    tenant_id, contact_id: contactId, type: "note",
    meta: { text: `Busca de e-mail em ${dominio}: ${exp.titulo}.` },
  } as any);
  revalidatePath(`/dashboard/contatos/${contactId}`);
  return { ok: false, email: null, status, ...exp, tentativas };
}
