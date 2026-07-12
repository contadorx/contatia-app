"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// ============================================================
// Revisão do lote capturado (Sales Navigator / busca).
// O passo que transforma "nomes soltos" em leads de verdade: cada empresa é
// cruzada com a base da Receita (radar_leads) para trazer CNPJ, telefone,
// e-mail corporativo — e daí o domínio, que permite achar o e-mail do decisor.
// ============================================================

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, user_id: user?.id as string, tenant_id: (prof as any)?.tenant_id as string | null };
}

/** Cruza cada empresa do lote com a base da Receita. */
export async function enrichBatch(batchId: string) {
  const { supabase } = await ctx();

  const { data: batch } = await supabase
    .from("capture_batches")
    .select("id, items")
    .eq("id", batchId)
    .maybeSingle();

  if (!batch) return { error: "Lote não encontrado." };

  const items = ((batch as any).items as any[]) || [];
  const enriquecidos: any[] = [];

  for (const it of items) {
    // já tem domínio? não mexe
    if (it.domain || !it.company) { enriquecidos.push(it); continue; }

    const { data: matches } = await supabase.rpc("match_company", {
      p_nome: it.company,
      p_limite: 1,
    });

    const m = Array.isArray(matches) ? matches[0] : null;
    if (!m) { enriquecidos.push({ ...it, match: null }); continue; }

    // o e-mail da empresa dá o domínio (contato@acme.com.br → acme.com.br)
    const emailEmpresa = (m as any).email as string | null;
    const dominio = emailEmpresa?.includes("@") ? emailEmpresa.split("@")[1].toLowerCase() : null;

    enriquecidos.push({
      ...it,
      cnpj: (m as any).cnpj || null,
      domain: dominio,
      company_official: (m as any).razao_social || (m as any).nome_fantasia,
      company_phone: (m as any).telefone || null,
      company_email: emailEmpresa || null,
      match: Number((m as any).semelhanca || 0).toFixed(2),
    });
  }

  const { error } = await supabase
    .from("capture_batches")
    .update({ items: enriquecidos } as any)
    .eq("id", batchId);

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/contatos/lote/${batchId}`);
  const achados = enriquecidos.filter((i) => i.cnpj).length;
  return { ok: true, achados, total: items.length };
}

/** Importa os leads selecionados: cria contatos, inscreve e enfileira a busca do e-mail. */
export async function importBatch(batchId: string, indices: number[], cadenceId?: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: batch } = await supabase
    .from("capture_batches")
    .select("id, items")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return { error: "Lote não encontrado." };

  const items = ((batch as any).items as any[]) || [];
  const escolhidos = indices.map((i) => items[i]).filter(Boolean);

  let criados = 0, duplicados = 0, semDominio = 0;

  for (const it of escolhidos) {
    // já existe?
    const { data: existe } = await supabase
      .from("contacts")
      .select("id")
      .ilike("name", it.name)
      .ilike("company", it.company || "")
      .limit(1);

    if ((existe as any[])?.length) { duplicados++; continue; }

    const { data: c, error } = await supabase
      .from("contacts")
      .insert({
        tenant_id,
        assigned_to: user_id,
        name: it.name,
        company: it.company_official || it.company || null,
        company_domain: it.domain || null,
        cnpj: it.cnpj || null,
        phone: it.company_phone || null,
        role_title: it.role || null,
        origin: "LinkedIn (lote)",
        status: "new",
      } as any)
      .select("id")
      .single();

    if (error || !c) continue;
    const contactId = (c as any).id;
    criados++;

    if (it.linkedin_url) {
      await supabase.from("events").insert({
        tenant_id, contact_id: contactId, type: "note",
        detail: `Capturado em lote do LinkedIn. Perfil: ${it.linkedin_url}`,
      } as any);
    }

    // com domínio → procura o e-mail do decisor. Sem domínio → segue por WhatsApp.
    if (it.domain) {
      await supabase.from("email_discovery_queue").upsert({
        tenant_id, contact_id: contactId, name: it.name, domain: it.domain,
        status: "pending", attempts: 0,
      } as any, { onConflict: "contact_id" });
    } else {
      semDominio++;
    }

    if (cadenceId) {
      await supabase.from("enrollments").insert({
        tenant_id, sequence_id: cadenceId, contact_id: contactId,
        assigned_to: user_id, status: "active", current_step: 0,
      } as any);
    }
  }

  await supabase
    .from("capture_batches")
    .update({ status: "imported", imported_at: new Date().toISOString() } as any)
    .eq("id", batchId);

  revalidatePath("/dashboard/contatos");
  return { ok: true, criados, duplicados, semDominio };
}
