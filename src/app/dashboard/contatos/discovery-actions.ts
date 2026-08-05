"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dominioDe, discoverEmailParallel, workerConfigurado, verifyEmail } from "@/lib/emailFinder";
import { findPublishedEmail } from "@/lib/webEmail";
import { comSelo, seloConfirmado, seloPublicado, seloRecusado } from "@/lib/seloEmail";

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

// Diagnóstico do serviço de busca (worker no VPS). Transforma "não funciona" numa
// causa específica que o próprio usuário resolve.
export async function testarWorker(): Promise<{ ok: boolean; titulo: string; detalhe: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, titulo: "Sessão expirada", detalhe: "Recarregue a página." };
  const { workerHealth } = await import("@/lib/emailFinder");
  const h = await workerHealth();
  if (!h.configured) {
    return {
      ok: false,
      titulo: "Serviço de busca não configurado",
      detalhe: "Faltam as variáveis WORKER_URL e WORKER_TOKEN no ambiente do app (Vercel → Settings → Environment Variables). Sem elas, a confirmação por servidor não roda — a busca só encontra e-mail publicado no site.",
    };
  }
  if (h.ok) {
    return {
      ok: true,
      titulo: "Serviço de busca no ar ✓",
      detalhe: "O worker respondeu normalmente. Se mesmo assim uma busca específica falhar, o motivo costuma ser o domínio testado (catch-all, Google/Microsoft ou greylisting), não o serviço.",
    };
  }
  if (h.httpStatus === 401 || h.httpStatus === 403) {
    return {
      ok: false,
      titulo: "Token recusado pelo worker",
      detalhe: "O worker está no ar, mas rejeitou o token (401/403). O WORKER_TOKEN no app precisa ser EXATAMENTE o mesmo configurado no VPS.",
    };
  }
  if (h.httpStatus) {
    return {
      ok: false,
      titulo: `Worker respondeu com erro (HTTP ${h.httpStatus})`,
      detalhe: "O endereço responde, mas não com saúde OK. Confira se o processo do worker está rodando no VPS (systemd/pm2) e se o proxy HTTPS (Caddy/Nginx) aponta pra ele.",
    };
  }
  return {
    ok: false,
    titulo: "Worker fora do ar",
    detalhe: `Não consegui falar com o worker (${h.error || "sem conexão"}). Verifique se o VPS está ligado, se o processo do worker está rodando e se o WORKER_URL do app aponta pro endereço certo (com https://).`,
  };
}

// `forcar` atende o caso "o contato já tem e-mail, mas quero ver se existe um mais
// atual". Antes a função recusava com "apague o e-mail atual se quiser procurar outro" —
// o que obriga a jogar fora o dado bom ANTES de saber se há um melhor. Forçado, ele só
// troca o endereço quando o servidor CONFIRMA o novo.
export async function buscarEmailAgora(contactId: string, siteOuDominio: string, forcar = false): Promise<ResultadoBusca> {
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
  const emailAtual = ((contact as any).email as string | null) || null;
  if (emailAtual && !forcar) {
    return {
      ok: false,
      status: "error",
      titulo: "Este contato já tem e-mail",
      detalhe: "Use “procurar um e-mail mais atual” na ficha, ou apague o atual antes de buscar outro.",
    };
  }

  // ============================================================
  // SÓ GUARDA O DOMÍNIO SE ELE EXISTIR
  //
  // Esta linha gravava `company_domain` com QUALQUER coisa que chegasse — inclusive um
  // domínio morto vindo do bloco automático. Aí o morto virava candidato outra vez na
  // rodada seguinte, e se reinstalava sozinho depois de apagado. Era o motor do
  // vaivém: conserta, roda, volta.
  //
  // Quando o operador digita na mão, o domínio existe e é gravado como sempre.
  // ============================================================
  let dominioVivo = true;
  try {
    const r = (await import("node:dns")).promises;
    const t = await Promise.allSettled([r.resolve4(dominio), r.resolve6(dominio), r.resolveMx(dominio)]);
    dominioVivo = t.some((x) => x.status === "fulfilled" && (x.value as any[])?.length > 0);
  } catch { dominioVivo = true; }   // na dúvida, comporta-se como antes
  if (dominioVivo) {
    await supabase.from("contacts").update({ company_domain: dominio } as any).eq("id", contactId);
  }

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
    const r = await discoverEmailParallel((contact as any).name, dominio);
    tentativas = (r.tentativas || []).map((t) => ({ email: t.email, status: t.status }));
    workerStatus = r.status;

    if (r.status === "valid" && r.email) {
      const igual = emailAtual && emailAtual.toLowerCase() === r.email.toLowerCase();
      // ============================================================
      // ENDEREÇO DESCOBERTO JÁ NASCE COM O SELO
      //
      // Este caminho só é alcançado quando o servidor do domínio CONFIRMOU a caixa numa
      // conversa SMTP — é a mesma prova que o botão "verificar" produz, e é mais forte:
      // o botão testa sintaxe e MX, este aqui perguntou ao servidor se a caixa existe.
      //
      // Só que o selo `custom.email_check` não era gravado aqui, então o e-mail recém
      // confirmado aparecia como "não verificado" e alguém ia clicar em verificar para
      // ouvir o que o sistema acabara de descobrir. Trabalho repetido por falta de um
      // campo.
      // ============================================================
      const { data: atual } = await supabase.from("contacts").select("custom").eq("id", contactId).maybeSingle();
      const customNovo = comSelo((atual as any)?.custom, seloConfirmado());
      await supabase
        .from("contacts")
        .update({ email: r.email, email_status: "ok", email_discovery: "valid", email_discovered_at: new Date().toISOString(), custom: customNovo } as any)
        .eq("id", contactId);
      await supabase.from("events").insert({
        tenant_id, contact_id: contactId, type: "note",
        meta: {
          text: igual
            ? `E-mail reconfirmado no servidor: ${r.email}`
            : emailAtual
            ? `E-mail atualizado: ${emailAtual} → ${r.email} (confirmado no servidor)`
            : `E-mail do decisor confirmado no servidor: ${r.email}`,
        },
      } as any);
      revalidatePath(`/dashboard/contatos/${contactId}`);
      return {
        ok: true,
        email: r.email,
        status: "valid",
        ...EXPLICACAO.valid,
        ...(igual
          ? { titulo: "O e-mail atual continua válido", detalhe: `O servidor confirmou ${r.email}. Nada mudou.` }
          : emailAtual
          ? { titulo: "E-mail atualizado", detalhe: `Troquei ${emailAtual} por ${r.email} — este o servidor confirmou.` }
          : {}),
        tentativas,
      };
    }
  }

  // ---- 2) CAMADA 0: e-mail publicado no site (funciona SEM worker, sem porta 25) ----
  const pub = await findPublishedEmail(dominio);
  // Revisão de um contato que JÁ tem e-mail: um endereço genérico do site
  // (contato@, faleconosco@) é quase sempre PIOR que o que já está lá. Sugiro, não troco.
  if (pub && emailAtual && pub.email.toLowerCase() !== emailAtual.toLowerCase()) {
    return {
      ok: false,
      email: emailAtual,
      status: "published",
      titulo: "Mantive o e-mail atual",
      detalhe: `No site aparece ${pub.email} (${pub.source}), mas é um endereço geral — normalmente pior que o do decisor. O servidor não confirmou nenhum endereço novo, então não troquei nada. Se quiser usar o do site, edite o contato à mão.`,
      tentativas,
    };
  }
  if (pub) {
    // ============================================================
    // O E-MAIL PUBLICADO TAMBÉM MERECE PROCEDÊNCIA
    //
    // Este caminho gravava só o endereço. Como a ficha lê `custom.email_check`, o
    // e-mail recém-achado aparecia como "não conferido" — a pessoa acabava de rodar a
    // busca, via o endereço chegar, e a tela dizia que ninguém tinha conferido nada.
    //
    // Antes de gravar, pergunto ao servidor do domínio se a caixa existe. Se
    // confirmar, o selo é o mesmo da descoberta ("SMTP validado"); se não der para
    // confirmar, fica registrado que foi a PRÓPRIA EMPRESA que publicou aquele
    // endereço — que não é prova técnica, mas é informação, e é bem diferente de
    // "ninguém sabe".
    // ============================================================
    let selo = seloPublicado(pub.source);
    if (workerConfigurado()) {
      try {
        const v = await verifyEmail(pub.email);
        if (v.status === "valid") selo = seloConfirmado();
        else if (v.status === "invalid") selo = seloRecusado(v.reason);
      } catch { /* sem resposta do worker: fica o selo de publicado */ }
    }
    const { data: atualPub } = await supabase.from("contacts").select("custom").eq("id", contactId).maybeSingle();
    await supabase
      .from("contacts")
      .update({
        email: pub.email,
        email_status: selo.valid === false ? "invalid" : "ok",
        email_discovery: "published",
        email_discovered_at: new Date().toISOString(),
        custom: comSelo((atualPub as any)?.custom, selo),
      } as any)
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
