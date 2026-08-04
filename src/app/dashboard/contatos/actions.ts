"use server";

import { msgErro } from "@/lib/erros";
import { canCreate, mensagemLimite } from "@/lib/plan";
import { dominioDe } from "@/lib/emailFinder";
import { logAction, recortarItens } from "@/lib/actionLog";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function tenantId() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: data?.tenant_id as string | null, user_id: user?.id };
}

// A normalização de nome de empresa e o "só dígitos" moravam AQUI. Foram para
// @/lib/resolverEmpresas, junto com quem os usa. Manter uma cópia solta neste arquivo
// era um convite à divergência: a regra de dedup existe em três lugares (este app, o
// resolvedor e a função empresa_chave do banco) e as três precisam concordar — se
// discordarem, a importação passa a criar empresas duplicadas sem avisar ninguém.

// Encontra (por CNPJ, ou por nome normalizado) ou cria a empresa e devolve o id.
//
// Serve o cadastro AVULSO (um contato por vez). A implementação foi trocada para
// delegar ao resolvedor em lote: a versão anterior lia `accounts` sem limite e o
// PostgREST corta em 1.000 — numa base de 78 mil, cadastrar um contato de uma empresa
// que já existia criava uma DUPLICADA, o mesmo defeito da importação.
async function ensureAccount(
  supabase: any, tenant_id: string, user_id: string | undefined,
  companyName: string | null | undefined, cnpj?: string | null
) {
  const { resolverEmpresas, chaveDe } = await import("@/lib/resolverEmpresas");
  const pedido = { nome: companyName, cnpj };
  const chave = chaveDe(pedido);
  if (!chave) return null;
  try {
    const { porChave } = await resolverEmpresas(supabase, tenant_id, user_id, [pedido]);
    return porChave.get(chave) || null;
  } catch {
    // Não achar/criar a empresa não pode impedir de salvar o contato.
    return null;
  }
}

export async function addContact(formData: FormData) {
  // limite de contatos do plano
  const lim = await canCreate("contatos");
  if (!lim.permitido) {
    return { error: mensagemLimite("contatos", lim.usado, lim.limite, lim.sugerido) };
  }

  const { supabase, tenant_id, user_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace atribuído." };

  const cnpj = String(formData.get("cnpj") || "").trim() || null;
  const payload = {
    tenant_id,
    assigned_to: user_id,
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim().toLowerCase() || null,
    phone: String(formData.get("phone") || "").trim() || null,
    company: String(formData.get("company") || "").trim() || null,
    role_title: String(formData.get("role_title") || "").trim() || null,
    cnpj,
    origin: String(formData.get("origin") || "").trim() || null,
  };
  if (!payload.name) return { error: "Nome é obrigatório." };

  // se veio empresa (ou CNPJ), encontra/cria em Empresas e vincula
  const account_id = await ensureAccount(supabase, tenant_id, user_id, payload.company, cnpj);

  const { data: inserted, error } = await supabase
    .from("contacts")
    .insert({ ...payload, account_id })
    .select("id")
    .single();
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  return { ok: true, id: (inserted as any)?.id as string | undefined };
}

type Row = { name: string; email?: string; phone?: string; company?: string; cnpj?: string; role_title?: string; origin?: string };

export async function importContacts(rows: Row[]) {
  // limite de contatos do plano (a importação não pode furar o teto)
  const limImp = await canCreate("contatos");
  if (!limImp.permitido) {
    return { error: mensagemLimite("contatos", limImp.usado, limImp.limite, limImp.sugerido) };
  }

  const { supabase, tenant_id, user_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace atribuído." };

  const clean = rows
    .filter((r) => r.name && r.name.trim())
    .map((r) => ({
      tenant_id,
      assigned_to: user_id,
      name: r.name.trim(),
      email: r.email?.trim().toLowerCase() || null,
      phone: r.phone?.trim() || null,
      company: r.company?.trim() || null,
      cnpj: r.cnpj?.trim() || null,
      role_title: r.role_title?.trim() || null,
      origin: r.origin?.trim() || "Import CSV",
    }));

  if (!clean.length) return { error: "Nenhuma linha válida (coluna 'name' é obrigatória)." };

  // EMPRESAS — resolvidas TODAS DE UMA VEZ (ver lib/resolverEmpresas).
  // O código anterior chamava ensureAccount() por nome, e cada chamada lia
  // `accounts` sem limite: o PostgREST corta em 1.000, então numa base grande a
  // empresa existente simplesmente não era encontrada e nascia uma duplicada.
  const { resolverEmpresas, chaveDe } = await import("@/lib/resolverEmpresas");
  let avisoEmpresa: string | undefined;
  let empresasCriadas = 0;
  let porChave = new Map<string, string>();
  try {
    const r = await resolverEmpresas(
      supabase, tenant_id, user_id,
      clean.map((c) => ({ nome: c.company, cnpj: c.cnpj }))
    );
    porChave = r.porChave;
    empresasCriadas = r.criadas;
    avisoEmpresa = r.aviso;
  } catch (e: any) {
    // Falhar aqui não pode impedir a importação: contato sem empresa é recuperável,
    // contato não importado obriga a refazer o arquivo inteiro.
    avisoEmpresa = `Não consegui vincular as empresas (${msgErro(e)}). Os contatos entraram sem empresa.`;
  }
  const withAccounts = clean.map((c) => ({
    ...c,
    account_id: porChave.get(chaveDe({ nome: c.company, cnpj: c.cnpj })) || null,
  }));

  // verifica e-mails por DOMÍNIO único (uma checagem de MX por domínio, não por linha)
  const { verifyEmail } = await import("@/lib/emailverify");
  const domainStatus: Record<string, boolean> = {}; // domínio → recebe e-mail (MX)
  const domainUnknown: Record<string, boolean> = {}; // domínio → checagem indeterminada
  const emailRe = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;
  for (const c of withAccounts) {
    const m = (c.email || "").toLowerCase().match(emailRe);
    if (!m) continue;
    const dom = m[1];
    if (dom in domainStatus) continue;
    const check = await verifyEmail(`x@${dom}`);
    domainStatus[dom] = check.hasMx && !check.disposable;
    domainUnknown[dom] = !!check.unknown; // M6: DNS falhou → não marcar inválido
  }
  const withStatus = withAccounts.map((c) => {
    const m = (c.email || "").toLowerCase().match(emailRe);
    let email_status = "ok";
    if (c.email) {
      if (!m) email_status = "invalid";
      // M6: domínio indeterminado (soluço de DNS) → dá o benefício da dúvida ("ok"),
      // não grava "invalid" e não tira o contato da cadência de e-mail.
      else if (domainUnknown[m[1]]) email_status = "ok";
      else email_status = domainStatus[m[1]] ? "ok" : "invalid";
    }
    return { ...c, email_status };
  });
  const invalidCount = withStatus.filter((c) => c.email && c.email_status === "invalid").length;

  // insere em lotes de 500. B7: se um lote falhar no meio, reporta quantos JÁ entraram
  // (em vez de sumir com o número) — o usuário sabe de onde continuar.
  let inserted = 0;
  for (let i = 0; i < withStatus.length; i += 500) {
    const chunk = withStatus.slice(i, i + 500);
    const { error } = await supabase.from("contacts").insert(chunk);
    if (error) {
      revalidatePath("/dashboard/contatos");
      revalidatePath("/dashboard/contas");
      return { error: `${error.message} (importados ${inserted} de ${withStatus.length} antes da falha).`, partial: inserted };
    }
    inserted += chunk.length;
  }
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  const comEmpresa = withAccounts.filter((c) => c.account_id).length;
  return {
    ok: true,
    count: withStatus.length,
    invalid: invalidCount,
    // números honestos sobre o vínculo: era isto que faltava para perceber que a
    // empresa não estava colando
    comEmpresa,
    semEmpresa: withAccounts.filter((c) => c.company && !c.account_id).length,
    empresasCriadas,
    aviso: avisoEmpresa,
  };
}

// Edita os dados de um contato (corrigir/completar informações).
export async function updateContact(id: string, patch: {
  name?: string; email?: string; phone?: string; company?: string; company_domain?: string;
  role_title?: string; cnpj?: string; status?: string;
}) {
  const { supabase, tenant_id, user_id } = await tenantId();
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = (typeof v === "string" ? v.trim() : v) || null;
  }
  // normaliza o domínio com a função única (trata https://, www., caminho, e-mail)
  if (typeof clean.company_domain === "string") {
    clean.company_domain = dominioDe(clean.company_domain as string);
  }
  if (typeof clean.email === "string") clean.email = (clean.email as string).toLowerCase();
  if (clean.name === null) return { error: "O nome não pode ficar vazio." };

  // e-mail alterado → re-verifica automaticamente (MX/descartável) e grava o status,
  // igual à importação. Assim a ficha reflete "válido/ inválido" sem passo manual.
  if (patch.email !== undefined) {
    const em = (clean.email as string | null) || null;
    if (!em) {
      clean.email_status = null;
    } else {
      const emailRe = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;
      const m = em.match(emailRe);
      if (!m) {
        clean.email_status = "invalid";
      } else {
        const { verifyEmail } = await import("@/lib/emailverify");
        const check = await verifyEmail(em);
        // M6: se a checagem ficou indeterminada (DNS falhou), não marca inválido.
        clean.email_status = check.unknown ? "ok" : check.hasMx && !check.disposable ? "ok" : "invalid";
      }
    }
  }

  // empresa alterada → encontra/cria em Empresas e revincula
  if (patch.company !== undefined && tenant_id) {
    clean.account_id = await ensureAccount(supabase, tenant_id, user_id, patch.company, patch.cnpj);
  }

  // O domínio pertence à EMPRESA, não só ao contato: propaga para Empresas,
  // para que os outros contatos da mesma empresa também o tenham.
  if (clean.company_domain && tenant_id) {
    const accId = (clean.account_id as string) || (await supabase
      .from("contacts").select("account_id").eq("id", id).maybeSingle()
      .then((r: any) => r.data?.account_id));

    if (accId) {
      await supabase
        .from("accounts")
        .update({ domain: clean.company_domain, website: `https://${clean.company_domain}` } as any)
        .eq("id", accId)
        .eq("tenant_id", tenant_id);
    }
  }

  const { error } = await supabase.from("contacts").update(clean).eq("id", id);
  if (error) return { error: msgErro(error) };
  revalidatePath(`/dashboard/contatos/${id}`);
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  return { ok: true };
}

// Salva os dados de RAPPORT e o LinkedIn no jsonb `custom`, SEM apagar o que o
// Radar já gravou lá (cnae, sócios, etc.) — faz merge, não overwrite.
export async function saveContactExtra(id: string, input: { linkedin?: string; rapport?: Record<string, string> }) {
  const { supabase } = await tenantId();
  const { data: cur } = await supabase.from("contacts").select("custom").eq("id", id).maybeSingle();
  const custom = { ...(((cur as any)?.custom as Record<string, unknown>) || {}) };
  if (input.linkedin !== undefined) {
    const lk = (input.linkedin || "").trim();
    if (lk) custom.linkedin = lk;
    else delete custom.linkedin;
  }
  if (input.rapport !== undefined) {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.rapport)) {
      const val = (v || "").trim();
      if (val) clean[k] = val;
    }
    if (Object.keys(clean).length) custom.rapport = clean;
    else delete custom.rapport;
  }
  const { error } = await supabase.from("contacts").update({ custom } as any).eq("id", id);
  if (error) return { error: msgErro(error) };
  revalidatePath(`/dashboard/contatos/${id}`);
  return { ok: true };
}

// Enriquece o contato pelo CNPJ (dele ou da empresa) via BrasilAPI — traz CNAE,
// porte, situação, município e sócios, e completa telefone/e-mail se faltarem.
export async function enrichContact(id: string) {
  const { supabase, tenant_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: c } = await supabase
    .from("contacts")
    // company_domain PRECISA vir aqui: sem ele, o `if (!c.company_domain)` abaixo
    // enxergaria undefined em todo contato e sobrescreveria um domínio já bom.
    .select("id, cnpj, email, phone, company_domain, account_id, custom, accounts(cnpj)")
    .eq("id", id)
    .maybeSingle();
  if (!c) return { error: "Contato não encontrado." };

  const cnpj = ((c as any).cnpj || (c as any).accounts?.cnpj || "").toString();
  if (!cnpj) return { error: "Este contato não tem CNPJ (nem a empresa). Preencha o CNPJ em Editar dados." };

  const { enrichCnpj } = await import("@/lib/cnpj");
  const r = await enrichCnpj(cnpj);
  if (r.error || !r.data) return { error: r.error || "Não foi possível enriquecer." };
  const d = r.data;

  // B3: só sobrescreve quando o provedor trouxe valor (fallback ReceitaWS é mais enxuto
  // que a BrasilAPI — não apaga o que já estava bom no custom).
  const custom = { ...(((c as any).custom as Record<string, unknown>) || {}) };
  if (d.cnae) custom.cnae = d.cnae;
  if (d.cnae_descricao) custom.cnae_descricao = d.cnae_descricao;
  if (d.situacao) custom.situacao = d.situacao;
  if (d.porte) custom.porte = d.porte;
  if (d.uf) custom.uf = d.uf;
  if (d.municipio) custom.municipio = d.municipio;
  if (Array.isArray(d.socios) && d.socios.length) custom.socios = d.socios;
  custom.enriched_at = new Date().toISOString();

  const patch: Record<string, unknown> = { custom };
  if (!(c as any).email && d.email) patch.email = d.email;
  if (!(c as any).phone && d.telefone) patch.phone = d.telefone;
  if (!(c as any).cnpj) patch.cnpj = cnpj;

  // ============================================================
  // O E-MAIL DA RECEITA ENTREGA O DOMÍNIO CORPORATIVO
  //
  // A Receita guarda o e-mail de contato da empresa. Quando ele é corporativo (não é
  // gmail/hotmail), o domínio dele é o domínio da empresa — que é exatamente o que os
  // passos seguintes precisam para existir: raspar o site e descobrir o e-mail do
  // decisor por SMTP. Sem isto, enriquecer pelo CNPJ não destravava nada: virava um
  // passo isolado num contato que continuava sem domínio.
  // ============================================================
  const { dominioCorporativo } = await import("@/lib/emailFinder");
  const dominioNovo = dominioCorporativo(d.email || (c as any).email);
  if (!(c as any).company_domain && dominioNovo) patch.company_domain = dominioNovo;

  const { error } = await supabase.from("contacts").update(patch as any).eq("id", id);
  if (error) return { error: msgErro(error) };

  // propaga para a empresa também
  const accId = (c as any).account_id;
  if (accId) {
    const patchConta: Record<string, unknown> = { cnpj, cnae: d.cnae, uf: d.uf, municipio: d.municipio, porte: d.porte };
    // ============================================================
    // DOMÍNIO DIGITADO À MÃO GANHA DE DOMÍNIO DEDUZIDO — SEMPRE
    //
    // Caso real: a Receita guardava `asseconassessoria.com.br` para a Ribeiro
    // Contabilidade, domínio que não existe mais. O operador corrigiu para
    // `contabilribeiro.com.br`, e o enriquecimento pelo CNPJ escrevia o antigo por
    // cima — então o passo seguinte visitava um site morto e não achava rede, e-mail
    // nem telefone. O trabalho manual era desfeito por um palpite automático.
    //
    // Regra: só preenche a conta quando ela está VAZIA. Correção humana é dado; e-mail
    // da Receita é indício.
    // ============================================================
    const { data: contaAtual } = await supabase
      .from("accounts").select("domain").eq("id", accId).maybeSingle();
    if (dominioNovo && !(contaAtual as any)?.domain) patchConta.domain = dominioNovo;
    await supabase.from("accounts").update(patchConta as any).eq("id", accId).eq("tenant_id", tenant_id);
  }

  revalidatePath(`/dashboard/contatos/${id}`);
  // Devolve o que descobriu: quem chama em cadeia (o botão "Atualizar dados") precisa
  // saber que agora existe domínio/telefone. Sem isso os passos seguintes rodariam com
  // a foto que a página carregou ANTES, e pulariam justamente o contato que mais
  // precisava deles.
  return {
    ok: true,
    dominio: dominioNovo || (c as any).company_domain || null,
    telefone: (patch.phone as string | undefined) || (c as any).phone || null,
  };
}

// Cria um novo contato a partir do nome de um SÓCIO (da Receita), vinculado à
// mesma empresa — multiplica os decisores por conta.
export async function addSocioContact(sourceContactId: string, socioName: string) {
  const lim = await canCreate("contatos");
  if (!lim.permitido) return { error: mensagemLimite("contatos", lim.usado, lim.limite, lim.sugerido) };

  const { supabase, tenant_id, user_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace." };
  const name = (socioName || "").trim();
  if (!name) return { error: "Nome do sócio vazio." };

  const { data: src } = await supabase
    .from("contacts")
    // phone e email entram porque são candidatos a herança — mas com regras diferentes,
    // explicadas no comentário do insert.
    .select("account_id, company, cnpj, company_domain, phone, email, assigned_to, accounts(domain)")
    .eq("id", sourceContactId)
    .maybeSingle();
  // o sócio herda o domínio da empresa → já entra na esteira de captura no site
  const dominioSocio = dominioDe((src as any)?.company_domain || (src as any)?.accounts?.domain || null);

  // M10: evita duplicar. Com empresa, checa dentro da empresa; SEM empresa (o guard
  // antigo só rodava com account_id), checa por nome + empresa/CNPJ no tenant.
  let dupQuery = supabase
    .from("contacts")
    .select("id")
    .eq("tenant_id", tenant_id)
    .ilike("name", name)
    .limit(1);
  if ((src as any)?.account_id) {
    dupQuery = dupQuery.eq("account_id", (src as any).account_id);
  } else if ((src as any)?.cnpj) {
    dupQuery = dupQuery.eq("cnpj", (src as any).cnpj);
  } else if ((src as any)?.company) {
    dupQuery = dupQuery.ilike("company", (src as any).company);
  }
  const { data: dup } = await dupQuery.maybeSingle();
  if (dup) return { error: "Já existe um contato com esse nome para esta empresa." };

  // ============================================================
  // O QUE O SÓCIO PODE HERDAR — e o que seria mentira herdar
  //
  // O pedido foi "o contato criado a partir de um sócio deve herdar dados de contato,
  // como e-mail". Herdar o e-mail do contato de origem seria errado: é OUTRA PESSOA.
  // Escrever `joao@empresa.com.br` na ficha da Maria faz o app mandar e-mail para o
  // João achando que fala com a Maria — e o pior é que funcionaria, então ninguém
  // perceberia o erro.
  //
  // A distinção que resolve é: dado DA EMPRESA se herda, dado DA PESSOA não.
  //
  //   herda    company, account_id, cnpj, company_domain   → são da empresa
  //   herda    telefone, se for o mesmo da empresa          → é o telefone do escritório
  //   herda    e-mail SÓ se for de balcão (contato@, sac@)  → é a caixa da empresa
  //   NÃO herda e-mail pessoal do sócio de origem           → é de outra pessoa
  //   NÃO herda o dono                                      → quem criou assume
  //
  // E o que faltava de verdade: o sócio novo não entrava em NENHUMA fila de descoberta
  // de e-mail. Nascia sem e-mail e continuava sem, porque a esteira só olhava
  // `web_capture`. Agora entra também em `email_discovery_queue`, que é o que de fato
  // consegue achar o endereço DELE no domínio da empresa.
  // ============================================================
  const { ehCaixaDeBalcao } = await import("@/lib/emailFinder");
  const emailOrigem = ((src as any)?.email || "").trim() || null;
  const emailHerdado = emailOrigem && ehCaixaDeBalcao(emailOrigem) ? emailOrigem : null;

  const { data: novo, error } = await supabase.from("contacts").insert({
    tenant_id,
    assigned_to: user_id,
    name,
    company: (src as any)?.company || null,
    account_id: (src as any)?.account_id || null,
    cnpj: (src as any)?.cnpj || null,
    company_domain: dominioSocio,
    phone: (src as any)?.phone || null,   // telefone da empresa; o WhatsApp é verificado depois
    email: emailHerdado,
    origin: "Sócio (Receita)",
    status: "novo",
    // com domínio da empresa, o sócio já entra na fila de captura (busca o WhatsApp
    // no site) — e o que for achado cai sozinho na fila de verificação.
    web_capture: dominioSocio ? "queued" : null,
  }).select("id").maybeSingle();
  if (error) return { error: msgErro(error) };

  // Fila de descoberta do e-mail DELE: nome + domínio da empresa. Sem isto o sócio
  // ficava eternamente sem endereço próprio.
  const novoId = (novo as any)?.id as string | undefined;
  if (novoId && dominioSocio && !emailHerdado) {
    // `name` e `domain` são NOT NULL e o status inicial é 'pending' (migration 0049) —
    // a fila tem índice único por contact_id, então upsert. Eu tinha escrito isto de
    // cabeça, com as colunas erradas e status 'queued': teria falhado calado, que é
    // exatamente o defeito que este projeto já pagou caro quatro vezes.
    const { error: errFila } = await supabase.from("email_discovery_queue").upsert(
      { tenant_id, contact_id: novoId, name, domain: dominioSocio, status: "pending", attempts: 0 } as any,
      { onConflict: "contact_id" }
    );
    // Não impede a criação do contato, mas também não some: o sócio existe, só não
    // entrou na fila — e quem olhar a ficha vai ver que falta e-mail.
    if (errFila) console.error("addSocioContact: fila de e-mail falhou", errFila.message);
  }
  revalidatePath(`/dashboard/contatos/${sourceContactId}`);
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}

// Exclui um contato (FKs são cascade/set null — não deixa órfãos).
export async function deleteContact(id: string) {
  const { supabase, tenant_id, user_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace." };
  // foto antes do delete: depois não há como saber quem era.
  const { data: antes } = await supabase
    .from("contacts").select("name, company, email").eq("id", id).eq("tenant_id", tenant_id).maybeSingle();
  const { error } = await supabase.from("contacts").delete().eq("id", id).eq("tenant_id", tenant_id);
  if (error) return { error: msgErro(error) };
  await logAction(supabase, {
    tenant_id, user_id, action: "contact_delete", entity: "contact", entity_id: id, qtd: 1,
    detail: `Excluiu o contato ${antes?.name || "(sem nome)"}${antes?.company ? ` — ${antes.company}` : ""}.`,
    meta: { itens: antes ? [{ id, nome: antes.name, empresa: antes.company, email: antes.email }] : [] },
  });
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  return { ok: true };
}

// Exclui vários contatos de uma vez (barra de lote).
export async function bulkDeleteContacts(ids: string[]) {
  const { supabase, tenant_id, user_id } = await tenantId();
  if (!tenant_id) return { error: "Sem workspace." };
  const clean = (ids || []).filter(Boolean);
  if (!clean.length) return { error: "Nenhum contato selecionado." };
  const { data: antes } = await supabase
    .from("contacts").select("id, name, company, email").eq("tenant_id", tenant_id).in("id", clean);
  // .select("id"): o log tem que dizer quantos SAÍRAM, não quantos foram pedidos (a
  // RLS pode barrar contato de outro vendedor).
  const { data: apagados, error } = await supabase
    .from("contacts").delete().eq("tenant_id", tenant_id).in("id", clean).select("id");
  if (error) return { error: msgErro(error) };
  const n = ((apagados as any[]) || []).length;
  if (!n) return { error: "Nada foi excluído — talvez esses contatos não sejam seus." };
  const idsApagados = new Set(((apagados as any[]) || []).map((r) => r.id));
  const { itens, truncado } = recortarItens(
    ((antes as any[]) || [])
      .filter((c) => idsApagados.has(c.id))
      .map((c) => ({ id: c.id, nome: c.name, empresa: c.company, email: c.email }))
  );
  await logAction(supabase, {
    tenant_id, user_id, action: "contact_delete_bulk", entity: "contact", qtd: n,
    detail: `${n} contato(s) excluído(s) em lote.`,
    meta: { itens, truncado, selecionados: clean.length },
  });
  revalidatePath("/dashboard/contatos");
  return { ok: true, count: n };
}
