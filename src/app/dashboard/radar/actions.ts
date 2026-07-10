"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
    situacao: idx(["situacao_cadastral", "situacao", "situação"]),
    porte: idx(["porte"]),
    tier: idx(["tier", "t[1-4]"]),
    contato: idx(["contato_principal", "contato", "responsavel"]),
    email: idx(["email", "e-mail"]),
    telefone: idx(["telefone", "fone", "phone"]),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(delim);
    const get = (k: number) => (k >= 0 ? (c[k] || "").trim() : null);
    rows.push({
      tenant_id,
      cnpj: get(col.cnpj),
      razao_social: get(col.razao),
      nome_fantasia: get(col.fantasia),
      cnae: get(col.cnae),
      uf: get(col.uf)?.toUpperCase() || null,
      municipio: get(col.municipio),
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
    .select("id, cnpj, razao_social, nome_fantasia, uf, municipio, cnae, contato_principal, email, telefone, converted_contact_id")
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

  const { data: contact, error } = await supabase
    .from("contacts")
    .insert({
      tenant_id,
      name,
      company,
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

  if (sequenceId) {
    const { enrollContact } = await import("@/app/dashboard/cadencias/actions");
    await enrollContact((contact as any).id, sequenceId);
  }

  revalidatePath("/dashboard/radar");
  revalidatePath("/dashboard/contatos");
  return { ok: true };
}
