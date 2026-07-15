"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buscarAtividades, buscarEmpresas, receitaConfigurada, type FiltroReceita, type EmpresaReceita } from "@/lib/receita";

// Capitais (para marcar is_capital nos leads importados da base).
const CAPITAIS_BR = new Set([
  "rio branco","maceio","macapa","manaus","salvador","fortaleza","brasilia","vitoria","goiania",
  "sao luis","cuiaba","campo grande","belo horizonte","belem","joao pessoa","curitiba","recife",
  "teresina","rio de janeiro","natal","porto alegre","porto velho","boa vista","florianopolis",
  "sao paulo","aracaju","palmas",
]);
const semAcento = (s: string | null) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const soDigitos = (s: string | null) => (s || "").replace(/\D/g, "");

// Monta o filtro da API a partir do que a tela envia (validação básica).
function montarFiltro(input: any): FiltroReceita {
  const cnae = Array.isArray(input?.cnae) ? input.cnae.map(soDigitos).filter((c: string) => /^\d{7}$/.test(c)) : [];
  return {
    atividade: typeof input?.atividade === "string" && input.atividade.trim().length >= 3 ? input.atividade.trim() : undefined,
    cnae: cnae.length ? cnae : undefined,
    uf: typeof input?.uf === "string" && /^[A-Za-z]{2}$/.test(input.uf.trim()) ? input.uf.trim().toUpperCase() : undefined,
    municipio: typeof input?.municipio === "string" && input.municipio.trim() ? input.municipio.trim() : undefined,
    porte: ["ME", "EPP", "Demais"].includes(input?.porte) ? input.porte : undefined,
    com_email: input?.com_email === true,
    com_telefone: input?.com_telefone === true,
  };
}

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null };
}

// Importa um CSV colado (cabeçalho flexível). Mapeia colunas comuns da base scored.
export async function importRadarCsv(csv: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { error: "CSV vazio ou sem linhas de dados." };

  const delim = lines[0].includes(";") ? ";" : ",";
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const col = {
    cnpj: idx(["cnpj"]),
    razao: idx(["razao_social", "razão social", "razao", "nome"]),
    fantasia: idx(["nome_fantasia", "fantasia"]),
    cnae: idx(["cnae", "cnae_fiscal"]),
    uf: idx(["uf", "estado"]),
    municipio: idx(["municipio", "município", "cidade"]),
    bairro: idx(["bairro", "distrito"]),
    situacao: idx(["situacao_cadastral", "situacao", "situação"]),
    porte: idx(["porte"]),
    tier: idx(["tier", "t[1-4]"]),
    contato: idx(["contato_principal", "contato", "responsavel"]),
    email: idx(["email", "e-mail"]),
    telefone: idx(["telefone", "fone", "phone"]),
  };

  const CAPITAIS = new Set(["rio branco","maceio","macapa","manaus","salvador","fortaleza","brasilia","vitoria","goiania","sao luis","cuiaba","campo grande","belo horizonte","belem","joao pessoa","curitiba","recife","teresina","rio de janeiro","natal","porto alegre","porto velho","boa vista","florianopolis","sao paulo","aracaju","palmas"]);
  const norm = (s: string | null) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(delim);
    const get = (k: number) => (k >= 0 ? (c[k] || "").trim() : null);
    const municipio = get(col.municipio);
    rows.push({
      tenant_id,
      cnpj: get(col.cnpj),
      razao_social: get(col.razao),
      nome_fantasia: get(col.fantasia),
      cnae: get(col.cnae),
      uf: get(col.uf)?.toUpperCase() || null,
      municipio,
      bairro: get(col.bairro),
      is_capital: CAPITAIS.has(norm(municipio)),
      situacao_cadastral: get(col.situacao),
      porte: get(col.porte),
      tier: get(col.tier),
      contato_principal: get(col.contato),
      email: get(col.email),
      telefone: get(col.telefone),
    });
  }

  // insere em lotes de 500
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from("radar_leads").insert(chunk);
    if (error) return { error: `Linha ~${i}: ${error.message}` };
    inserted += chunk.length;
  }
  revalidatePath("/dashboard/radar");
  return { ok: true, inserted };
}

// Enriquece um radar_lead via API e converte em contato no pipeline.
export async function enrichAndPush(radarId: string, sequenceId?: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: lead } = await supabase
    .from("radar_leads")
    .select("id, cnpj, razao_social, nome_fantasia, uf, municipio, cnae, tier, contato_principal, email, telefone, converted_contact_id")
    .eq("id", radarId)
    .maybeSingle();
  if (!lead) return { error: "Lead não encontrado." };
  if ((lead as any).converted_contact_id) return { error: "Este lead já está no pipeline." };

  const L = lead as any;
  let email = L.email as string | null;
  let phone = L.telefone as string | null;
  let contato = L.contato_principal as string | null;
  const custom: Record<string, unknown> = { cnpj: L.cnpj, cnae: L.cnae, uf: L.uf, municipio: L.municipio };

  // enriquecimento sob demanda (só se tiver CNPJ)
  if (L.cnpj) {
    const { enrichCnpj } = await import("@/lib/cnpj");
    const res = await enrichCnpj(L.cnpj);
    if (res.data) {
      email = email || res.data.email || null;
      phone = phone || res.data.telefone || null;
      if (!contato && res.data.socios?.length) contato = res.data.socios[0];
      custom.cnae_descricao = res.data.cnae_descricao;
      custom.situacao = res.data.situacao;
      custom.porte = res.data.porte;
      custom.socios = res.data.socios;
      custom.enriched_at = new Date().toISOString();
    }
    // se a API falhar, segue com o que já tinha (não bloqueia o push)
  }

  const company = L.nome_fantasia || L.razao_social || null;
  const name = contato || company || L.cnpj || "Empresa";

  // Radar é só descoberta: ao puxar, a empresa vai para Empresas (accounts) e o contato
  // fica amarrado a ela. Encontra por CNPJ (preferência) ou nome; senão cria com dados ricos.
  let account_id: string | null = null;
  if (company || L.cnpj) {
    let found: any = null;
    if (L.cnpj) {
      const { data } = await supabase.from("accounts").select("id").eq("tenant_id", tenant_id).eq("cnpj", L.cnpj).limit(1).maybeSingle();
      found = data;
    }
    if (!found && company) {
      const { data } = await supabase.from("accounts").select("id").eq("tenant_id", tenant_id).ilike("name", company).limit(1).maybeSingle();
      found = data;
    }
    if (found) {
      account_id = found.id;
    } else {
      const { data: acc } = await supabase
        .from("accounts")
        .insert({
          tenant_id,
          name: company || L.razao_social || L.cnpj || "Empresa",
          cnpj: L.cnpj || null,
          cnae: L.cnae || null,
          uf: L.uf || null,
          municipio: L.municipio || null,
        })
        .select("id")
        .maybeSingle();
      account_id = (acc as any)?.id || null;
    }
  }

  const { data: contact, error } = await supabase
    .from("contacts")
    .insert({
      tenant_id,
      name,
      company,
      account_id,
      cnpj: L.cnpj || null,
      email,
      phone,
      origin: "Radar",
      status: "novo",
      custom,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await supabase.from("radar_leads").update({ converted_contact_id: (contact as any).id }).eq("id", radarId);

  // tier vira TAG (dinâmica) — cria a tag se não existir e aplica ao contato
  const tier = (L.tier as string | null)?.trim();
  if (tier) {
    let { data: tag } = await supabase.from("tags").select("id").eq("name", tier).maybeSingle();
    if (!tag) {
      const color = tier === "T1" ? "#12B76A" : tier === "T2" ? "#4A3AFF" : tier === "T3" ? "#F79009" : "#667085";
      const { data: created } = await supabase.from("tags").insert({ tenant_id, name: tier, color }).select("id").maybeSingle();
      tag = created;
    }
    if (tag) await supabase.from("contact_tags").upsert({ tenant_id, contact_id: (contact as any).id, tag_id: (tag as any).id }, { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
  }

  // cria a OPORTUNIDADE no primeiro estágio do pipeline (é isso que aparece no board)
  const { data: firstStage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("is_won", false)
    .eq("is_lost", false)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (firstStage) {
    const { data: me } = await supabase.from("profiles").select("id").eq("id", (await supabase.auth.getUser()).data.user?.id ?? "").maybeSingle();
    await supabase.from("opportunities").insert({
      tenant_id,
      title: company || name,
      primary_contact_id: (contact as any).id,
      account_id,
      owner_id: (me as any)?.id || null,
      stage_id: (firstStage as any).id,
      status: "open",
      value_mrr: 0,
    });
  }

  if (sequenceId) {
    const { enrollContact } = await import("@/app/dashboard/cadencias/actions");
    await enrollContact((contact as any).id, sequenceId);
  }

  revalidatePath("/dashboard/radar");
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/contas");
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

// Semeia ~20 leads fictícios de contadores para teste (idempotente por CNPJ fake).
export async function seedRadarDemo() {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const nomes = [
    ["Contabilidade Andrade Ltda", "Andrade Contábil", "São Paulo", "SP", "T1"],
    ["Escritório Contábil Marques", "Marques Assessoria", "Campinas", "SP", "T1"],
    ["Nova Gestão Contábil ME", "Nova Gestão", "Santo André", "SP", "T2"],
    ["Oliveira & Santos Contadores", "O&S Contadores", "Guarulhos", "SP", "T1"],
    ["Precisão Contábil Ltda", "Precisão", "Rio de Janeiro", "RJ", "T2"],
    ["Contável Assessoria Empresarial", "Contável", "Belo Horizonte", "MG", "T2"],
    ["Assessoria Fiscal Ribeiro", "Ribeiro Fiscal", "Curitiba", "PR", "T3"],
    ["Grupo Contábil Horizonte", "Horizonte", "Porto Alegre", "RS", "T1"],
    ["Faceta Contabilidade", "Faceta", "Salvador", "BA", "T3"],
    ["Meridiano Serviços Contábeis", "Meridiano", "Recife", "PE", "T2"],
    ["Alfa Contabilidade Digital", "Alfa Digital", "Sorocaba", "SP", "T2"],
    ["Contabilidade Sá & Filhos", "Sá & Filhos", "São Bernardo", "SP", "T1"],
    ["Núcleo Contábil Vértice", "Vértice", "Osasco", "SP", "T3"],
    ["Prime Assessoria Contábil", "Prime", "Niterói", "RJ", "T2"],
    ["Contadoria Moderna Ltda", "Moderna", "Uberlândia", "MG", "T3"],
    ["Escritório Fiscal Aliança", "Aliança", "Londrina", "PR", "T3"],
    ["Contax Serviços Empresariais", "Contax", "Joinville", "SC", "T2"],
    ["Bastos Contabilidade", "Bastos", "Fortaleza", "CE", "T4"],
    ["Cia Contábil do Vale", "Vale Contábil", "São José dos Campos", "SP", "T1"],
    ["Zênite Contadores Associados", "Zênite", "Ribeirão Preto", "SP", "T2"],
  ];

  const rows = nomes.map((n, i) => {
    const seq = String(i + 1).padStart(4, "0");
    return {
      tenant_id,
      cnpj: `00.00${seq.slice(0, 1)}.${seq.slice(1)}/0001-${String((i * 7) % 90 + 10)}`,
      razao_social: n[0],
      nome_fantasia: n[1],
      cnae: "6920-6/01",
      uf: n[3],
      municipio: n[2],
      bairro: ["Centro", "Jardins", "Savassi", "Batel", "Moema", "Boa Viagem"][i % 6],
      is_capital: ["São Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba", "Recife", "Porto Alegre", "Salvador", "Fortaleza"].includes(n[2]),
      situacao_cadastral: "ATIVA",
      porte: i % 3 === 0 ? "ME" : i % 3 === 1 ? "EPP" : "DEMAIS",
      tier: n[4],
      contato_principal: `Sócio ${n[1]}`,
      email: `contato@${n[1].toLowerCase().replace(/[^a-z0-9]/g, "")}.com.br`,
      telefone: `(${11 + (i % 80)}) 9${String(90000000 + i * 137).slice(0, 8)}`,
    };
  });

  const { error } = await supabase.from("radar_leads").insert(rows);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/radar");
  return { ok: true, count: rows.length };
}

// ============================================================
// ETAPA 2 — Buscar na Base da Receita (substitui o CSV manual).
// ============================================================

// Autocomplete de atividade (o campo principal da busca).
export async function atividadesReceita(q: string) {
  const { tenant_id } = await ctx();
  if (!tenant_id) return { atividades: [], error: "Sem workspace." };
  return await buscarAtividades(q);
}

// Prévia: quantas empresas casam com os filtros + uma amostra + os CNAEs que casaram.
export async function buscarNaBase(input: any) {
  const { tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!receitaConfigurada()) return { error: "Base da Receita não configurada (defina RECEITA_API_URL e RECEITA_API_TOKEN)." };

  const f = montarFiltro(input);
  if (!f.atividade && !f.cnae && !f.uf) {
    return { error: "Escolha ao menos uma atividade (ou CNAE) ou uma UF." };
  }
  const r = await buscarEmpresas({ ...f, limit: 8, contar: true });
  if (r.error) return { error: r.error };
  return { ok: true, total: r.total, atividades: r.atividades, amostra: r.rows };
}

// Mapeia uma empresa da base para uma linha de radar_leads.
function paraRadarLead(tenant_id: string, e: EmpresaReceita) {
  const municipio = e.municipio || null;
  return {
    tenant_id,
    cnpj: soDigitos(e.cnpj) || null,
    razao_social: e.razao_social || null,
    nome_fantasia: e.nome_fantasia || null,
    cnae: e.cnae ? (e.cnae_descricao ? `${e.cnae} — ${e.cnae_descricao}` : e.cnae) : null,
    uf: e.uf || null,
    municipio,
    bairro: e.bairro || null,
    is_capital: CAPITAIS_BR.has(semAcento(municipio)),
    situacao_cadastral: "ATIVA",
    porte: e.porte || null,
    tier: null,
    contato_principal: null,
    email: e.email || null,
    telefone: e.telefone || null,
  };
}

// Importa da base para radar_leads. Pagina na API (500/página) até o teto, deduplica por CNPJ.
export async function importarDaBase(input: any) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!receitaConfigurada()) return { error: "Base da Receita não configurada." };

  const f = montarFiltro(input);
  if (!f.atividade && !f.cnae && !f.uf) {
    return { error: "Escolha ao menos uma atividade (ou CNAE) ou uma UF." };
  }

  const TETO = Math.min(Math.max(Number(input?.limite) || 500, 1), 2000); // teto de segurança
  const PAGINA = 500;

  // 1) puxa da API paginando até o teto
  const empresas: EmpresaReceita[] = [];
  for (let offset = 0; offset < TETO; offset += PAGINA) {
    const r = await buscarEmpresas({ ...f, limit: Math.min(PAGINA, TETO - offset), offset });
    if (r.error) return { error: r.error };
    empresas.push(...r.rows);
    if (r.rows.length < PAGINA) break; // acabaram os resultados
  }
  if (!empresas.length) return { ok: true, inserted: 0, skipped: 0, total: 0 };

  // 2) deduplica contra o que já existe no radar_leads (por CNPJ) deste workspace
  const cnpjs = Array.from(new Set(empresas.map((e) => soDigitos(e.cnpj)).filter(Boolean)));
  const jaExiste = new Set<string>();
  for (let i = 0; i < cnpjs.length; i += 500) {
    const fatia = cnpjs.slice(i, i + 500);
    const { data } = await supabase.from("radar_leads").select("cnpj").eq("tenant_id", tenant_id).in("cnpj", fatia);
    for (const d of (data as any[]) || []) if (d.cnpj) jaExiste.add(soDigitos(d.cnpj));
  }

  const vistos = new Set<string>();
  const rows = empresas
    .filter((e) => {
      const d = soDigitos(e.cnpj);
      if (!d || jaExiste.has(d) || vistos.has(d)) return false; // pula duplicados
      vistos.add(d);
      return true;
    })
    .map((e) => paraRadarLead(tenant_id, e));

  const skipped = empresas.length - rows.length;

  // 3) insere em lotes de 500
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from("radar_leads").insert(chunk);
    if (error) return { error: error.message, inserted };
    inserted += chunk.length;
  }

  revalidatePath("/dashboard/radar");
  return { ok: true, inserted, skipped, total: empresas.length };
}
