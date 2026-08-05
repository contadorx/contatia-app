"use server";

// ============================================================
// PROSPECTAR — ações do passo a passo.
//
// O passo 4 (descobrir canais) roda NA HORA, em lotes pequenos, porque cada etapa
// tem um custo bem diferente:
//   • site (HTTP)        → lento por domínio, mas paralelizável       → lote de 8
//   • e-mail (SMTP)      → o mais lento (o worker testa padrão a padrão) → lote de 6
//   • WhatsApp (Evolution) → UMA chamada resolve o lote todo          → lote de 60
//
// Quem não couber no lote fica ENFILEIRADO (web_capture/wa_status = 'queued',
// email_discovery_queue = 'pending') e os crons drenam. O cliente chama estas ações
// repetidamente, lote por lote, e mostra o progresso real — nada de "aguarde".
// ============================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { msgErro } from "@/lib/erros";
import { dominioDe, discoverEmailParallel, workerConfigurado, ehCaixaDeBalcao, pareceEmailDaPessoa, dominioCorporativo } from "@/lib/emailFinder";
import { findPublishedEmail } from "@/lib/webEmail";

// SMTP é o gargalo: 6 por chamada cabe folgado no limite de 60s da função.
// (o maxDuration de 60s é declarado na página /dashboard/prospectar)
const LOTE_EMAIL = 6;

// provedores de e-mail pessoal: o domínio deles não diz nada sobre a empresa
const GENERICOS = new Set([
  "gmail.com", "hotmail.com", "outlook.com", "outlook.com.br", "live.com", "msn.com",
  "yahoo.com", "yahoo.com.br", "bol.com.br", "uol.com.br", "terra.com.br", "ig.com.br",
  "globo.com", "icloud.com", "me.com", "aol.com", "protonmail.com", "zipmail.com.br",
]);

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

// ------------------------------------------------------------------
// PASSO 4b — descobrir e-mail de um LOTE de contatos, agora.
// Duas camadas por contato: (1) padrões nome@domínio confirmados no servidor SMTP;
// (2) e-mail publicado no site da empresa. Só grava o que der para confirmar.
// ------------------------------------------------------------------
export async function descobrirEmailsLote(contactIds: string[]): Promise<{
  ok?: boolean; processados?: number; achou?: number; publicados?: number; semEmail?: number;
  restantes?: number; semDominio?: number; semWorker?: boolean; error?: string;
}> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const ids = Array.from(new Set((contactIds || []).filter(Boolean)));
  if (!ids.length) return { error: "Nada selecionado." };

  const { data: rows, error } = await supabase
    .from("contacts")
    .select("id, name, email, company_domain, account_id, accounts(domain)")
    .eq("tenant_id", tenant_id)
    .in("id", ids.slice(0, 300));
  if (error) return { error: msgErro(error) };

  // ============================================================
  // TER E-MAIL NÃO É TER O E-MAIL DO DECISOR
  //
  // O filtro era `!c.email`: quem já tinha QUALQUER endereço era pulado. Caso real —
  // Adriana Sampaio Cervi, com `contato@grupocervi.com.br` no cadastro. O lote passou
  // direto; aberta a ficha, o botão individual achou `adriana@grupocervi.com.br` na
  // hora, porque o passo individual sabe que caixa compartilhada NÃO é o endereço da
  // pessoa.
  //
  // Era a mesma regra existindo em dois lugares com critérios diferentes. Agora o lote
  // usa exatamente os testes do individual:
  //
  //   · sem e-mail                    → procura
  //   · caixa de balcão (contato@…)   → procura o da pessoa
  //   · domínio diferente do da empresa → herança de cadastro antigo, procura
  //   · começo do endereço sem nenhum pedaço do nome → é de outra pessoa, procura
  //
  // Em todos esses casos a troca continua condicionada à CONFIRMAÇÃO do servidor: se
  // ninguém confirmar nada, o endereço antigo fica onde está.
  // ============================================================
  const precisaProcurar = (c: any, dominio: string) => {
    const email = String(c.email || "").trim();
    if (!email) return true;
    if (ehCaixaDeBalcao(email)) return true;
    const doEmail = dominioDe(email) || "";
    if (doEmail && dominio && doEmail !== dominio) return true;
    if (!pareceEmailDaPessoa(email, c.name)) return true;
    return false;
  };

  const alvos = ((rows as any[]) || [])
    .map((c) => ({
      id: c.id,
      name: c.name as string,
      account_id: (c.account_id as string) || null,
      email: (c.email as string) || null,
      dominio: dominioDe(c.company_domain || c.accounts?.domain || dominioCorporativo(c.email) || null),
    }));

  // ============================================================
  // O DOMÍNIO PODE VIR DO E-MAIL DE UM COLEGA DA MESMA EMPRESA
  //
  // Muito contato do Radar entra sem `company_domain` — e era descartado por isso,
  // mesmo quando OUTRO sócio da mesma empresa já tinha e-mail corporativo cadastrado.
  // O domínio estava ali, depois do @, e ninguém olhava.
  //
  // Provedor genérico (gmail, hotmail…) é ignorado de propósito: testar padrões contra
  // gmail.com não descobre nada da empresa e ainda gasta a conversa SMTP.
  // ============================================================
  const semDom = alvos.filter((a) => !a.dominio && a.account_id);
  if (semDom.length) {
    const contas = Array.from(new Set(semDom.map((a) => a.account_id))) as string[];
    const { data: irmaos } = await supabase
      .from("contacts")
      .select("account_id, email")
      .in("account_id", contas.slice(0, 200))
      .not("email", "is", null);
    const domPorConta: Record<string, string> = {};
    for (const ir of ((irmaos as any[]) || [])) {
      if (!ir.account_id || domPorConta[ir.account_id]) continue;
      const d = String(ir.email || "").split("@")[1]?.trim().toLowerCase() || "";
      if (d && !GENERICOS.has(d)) domPorConta[ir.account_id] = d;
    }
    for (const a of semDom) {
      const d = a.account_id ? domPorConta[a.account_id] : "";
      if (d) a.dominio = d;
    }
  }

  // O filtro do "precisa procurar" vem DEPOIS de resolver o domínio: a comparação
  // "e-mail de outro domínio" precisa saber qual é o domínio da empresa.
  const comDominio = alvos.filter((c) => c.dominio && precisaProcurar(c, c.dominio as string));
  const semDominio = alvos.filter((c) => !c.dominio).length;

  const lote = comDominio.slice(0, LOTE_EMAIL);
  const restantes = comDominio.length - lote.length;

  let achou = 0, publicados = 0, semEmail = 0;
  const nowIso = new Date().toISOString();

  // sequencial de propósito: o worker SMTP já paraleliza os padrões de UM nome;
  // disparar 6 nomes ao mesmo tempo é o caminho mais curto para o servidor do
  // destinatário nos tratar como abuso (greylisting/bloqueio).
  for (const c of lote) {
    const dominio = c.dominio as string;
    let gravou = false;
    // `testouSmtp` decide o destino do job na fila: se o worker não rodou (desligado
    // ou fora do ar), o job NÃO pode ser fechado — senão o cron nunca mais tenta e o
    // sócio fica sem e-mail para sempre, silenciosamente.
    let testouSmtp = false;
    let statusSmtp: string | null = null;
    let via: "valid" | "published" | null = null;

    if (workerConfigurado()) {
      try {
        const r = await discoverEmailParallel(c.name, dominio);
        testouSmtp = r.status !== "error";
        statusSmtp = r.status;
        if (r.status === "valid" && r.email) {
          // O selo vem junto: sem ele, o endereço que o servidor ACABOU de confirmar
          // apareceria na ficha como "não conferido", e alguém clicaria em verificar
          // para ouvir o que o sistema já sabia. Mesma gravação do caminho individual.
          const { data: atual } = await supabase.from("contacts").select("custom").eq("id", c.id).maybeSingle();
          const { comSelo, seloConfirmado } = await import("@/lib/seloEmail");
          await supabase
            .from("contacts")
            .update({
              email: r.email, email_status: "ok", email_discovery: "valid",
              email_discovered_at: nowIso, custom: comSelo((atual as any)?.custom, seloConfirmado()),
            } as any)
            .eq("id", c.id).eq("tenant_id", tenant_id);
          achou++;
          gravou = true;
          via = "valid";
        } else {
          await supabase
            .from("contacts")
            .update({ email_discovery: r.status, email_discovered_at: nowIso } as any)
            .eq("id", c.id).eq("tenant_id", tenant_id);
        }
      } catch {
        /* worker fora do ar: cai para o e-mail publicado no site e mantém o job */
      }
    }

    // ============================================================
    // O E-MAIL PUBLICADO NÃO SUBSTITUI O QUE JÁ EXISTE
    //
    // Endereço genérico do site (contato@, faleconosco@) é quase sempre PIOR que o
    // que já está na ficha. Com o lote passando a processar quem JÁ tem e-mail, esta
    // etapa poderia rebaixar `rogerio@empresa` para `contato@empresa` — trocar um
    // endereço de gente por uma caixa de balcão. O caminho individual já tinha essa
    // regra; aqui ela faltava porque, antes, só entrava quem não tinha nada.
    // ============================================================
    if (!gravou && !c.email) {
      try {
        const pub = await findPublishedEmail(dominio);
        if (pub) {
          await supabase
            .from("contacts")
            .update({ email: pub.email, email_status: "ok", email_discovery: "published", email_discovered_at: nowIso } as any)
            .eq("id", c.id).eq("tenant_id", tenant_id);
          achou++; publicados++; gravou = true;
          via = "published";
        }
      } catch { /* site fora do ar: segue */ }
    }

    if (!gravou) semEmail++;

    if (gravou || testouSmtp) {
      // achou, ou testou e o domínio recusou/é catch-all/é bloqueado: trabalho FEITO,
      // fecha o job para o cron não repetir de graça.
      await supabase
        .from("email_discovery_queue")
        .update({ status: "done", result: via || statusSmtp || "not_found", processed_at: nowIso } as any)
        .eq("tenant_id", tenant_id)
        .eq("contact_id", c.id);
    } else {
      // não deu para testar de fato → deixa PENDENTE e conta a tentativa (mesma
      // política do cron em emailDiscoverySync).
      await supabase.from("email_discovery_queue").upsert(
        {
          tenant_id, contact_id: c.id, name: c.name, domain: dominio,
          status: "pending", result: null,
          last_error: workerConfigurado() ? "worker indisponível" : "worker não configurado",
          processed_at: null,
        } as any,
        { onConflict: "contact_id" }
      );
    }
  }

  // o excedente fica na fila para o cron de hora em hora
  if (restantes > 0) {
    const resto = comDominio.slice(LOTE_EMAIL);
    await supabase.from("email_discovery_queue").upsert(
      resto.map((c) => ({
        tenant_id, contact_id: c.id, name: c.name, domain: c.dominio as string,
        status: "pending", attempts: 0, result: null, last_error: null, processed_at: null,
      })),
      { onConflict: "contact_id" }
    );
  }

  revalidatePath("/dashboard/contatos");
  return {
    ok: true, processados: lote.length, achou, publicados, semEmail,
    restantes, semDominio, semWorker: !workerConfigurado(),
  };
}

// ------------------------------------------------------------------
// Situação da esteira para um conjunto de contatos — alimenta o placar do passo 4
// e o resumo final. Uma query, sem N+1.
// ------------------------------------------------------------------
export type PlacarEsteira = {
  total: number;
  comEmail: number;
  comWhats: number;
  comAlgumCanal: number;
  semCanal: number;
  filaSite: number;
  filaWhats: number;
  filaEmail: number;
  semDominio: number;
  // TODOS os ids com canal (é isso que a inscrição em cadência usa)
  prontosIds: string[];
  // amostra para a tabela da tela (não é o que limita a inscrição)
  prontos: { id: string; nome: string; empresa: string | null; email: string | null; whats: string | null }[];
};

// PostgREST manda os filtros na query string: 500 UUIDs num .in() estouram o limite
// de tamanho da requisição. Fatiamos em 100.
function fatias<T>(arr: T[], n = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function placarEsteira(contactIds: string[]): Promise<{ placar?: PlacarEsteira; error?: string }> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const ids = Array.from(new Set((contactIds || []).filter(Boolean)));
  if (!ids.length) return { error: "Nada selecionado." };

  const list: any[] = [];
  for (const fatia of fatias(ids)) {
    const { data: rows, error } = await supabase
      .from("contacts")
      .select("id, name, company, email, phone, wa_status, wa_number, web_capture, company_domain, accounts(domain)")
      .eq("tenant_id", tenant_id)
      .in("id", fatia);
    if (error) return { error: msgErro(error) };
    list.push(...((rows as any[]) || []));
  }

  const filaEmailIds = new Set<string>();
  for (const fatia of fatias(list.map((c) => c.id))) {
    const { data: fila } = await supabase
      .from("email_discovery_queue")
      .select("contact_id")
      .eq("tenant_id", tenant_id)
      .eq("status", "pending")
      .in("contact_id", fatia);
    for (const r of ((fila as any[]) || [])) filaEmailIds.add(r.contact_id);
  }

  const placar: PlacarEsteira = {
    total: list.length,
    comEmail: 0, comWhats: 0, comAlgumCanal: 0, semCanal: 0,
    filaSite: 0, filaWhats: 0, filaEmail: filaEmailIds.size, semDominio: 0,
    prontosIds: [],
    prontos: [],
  };

  for (const c of list) {
    const temEmail = !!c.email;
    const temWhats = c.wa_status === "valid";
    if (temEmail) placar.comEmail++;
    if (temWhats) placar.comWhats++;
    if (temEmail || temWhats) {
      placar.comAlgumCanal++;
      placar.prontosIds.push(c.id);
      if (placar.prontos.length < 20) {
        placar.prontos.push({
          id: c.id, nome: c.name, empresa: c.company || null,
          email: c.email || null, whats: temWhats ? (c.wa_number || c.phone || null) : null,
        });
      }
    } else placar.semCanal++;
    if (c.web_capture === "queued") placar.filaSite++;
    if (c.wa_status === "queued") placar.filaWhats++;
    if (!dominioDe(c.company_domain || c.accounts?.domain || null)) placar.semDominio++;
  }

  return { placar };
}

// ------------------------------------------------------------------
// Re-enfileira o que ficou sem canal: manda tudo o que tem domínio/telefone de volta
// para as filas do cron. Serve para "tentar de novo mais tarde" sem refazer a busca.
// ------------------------------------------------------------------
export async function reenfileirarEsteira(contactIds: string[]): Promise<{
  ok?: boolean; site?: number; whats?: number; email?: number; error?: string;
}> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const ids = Array.from(new Set((contactIds || []).filter(Boolean))).slice(0, 500);
  if (!ids.length) return { error: "Nada selecionado." };

  const { data: rows } = await supabase
    .from("contacts")
    .select("id, name, email, phone, wa_status, company_domain, accounts(domain)")
    .eq("tenant_id", tenant_id)
    .in("id", ids);
  const list = ((rows as any[]) || []).map((c) => ({
    id: c.id, name: c.name as string, email: c.email as string | null,
    phone: c.phone as string | null, wa_status: c.wa_status as string | null,
    dominio: dominioDe(c.company_domain || c.accounts?.domain || null),
  }));

  const paraSite = list.filter((c) => c.dominio).map((c) => c.id);
  const paraWhats = list.filter((c) => String(c.phone || "").replace(/\D/g, "").length >= 10 && c.wa_status !== "valid").map((c) => c.id);
  const paraEmail = list.filter((c) => !c.email && c.dominio);

  if (paraSite.length) {
    await supabase.from("contacts").update({ web_capture: "queued" } as any).eq("tenant_id", tenant_id).in("id", paraSite);
  }
  if (paraWhats.length) {
    await supabase.from("contacts").update({ wa_status: "queued" } as any).eq("tenant_id", tenant_id).in("id", paraWhats);
  }
  if (paraEmail.length) {
    await supabase.from("email_discovery_queue").upsert(
      paraEmail.map((c) => ({
        tenant_id, contact_id: c.id, name: c.name, domain: c.dominio as string,
        status: "pending", attempts: 0, result: null, last_error: null, processed_at: null,
      })),
      { onConflict: "contact_id" }
    );
  }

  revalidatePath("/dashboard/contatos");
  return { ok: true, site: paraSite.length, whats: paraWhats.length, email: paraEmail.length };
}
