"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase.from("profiles").select("tenant_id, role").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (prof as any)?.tenant_id as string | null, role: (prof as any)?.role };
}

export async function saveWebhookConnection(formData: FormData) {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Apenas o dono do workspace pode configurar integrações." };

  const url = String(formData.get("webhook_url") || "").trim();
  const push_on = String(formData.get("push_on") || "both");
  if (!url) return { error: "Informe a URL do webhook." };
  if (!/^https?:\/\//i.test(url)) return { error: "A URL precisa começar com http:// ou https://" };

  const secret = String(formData.get("webhook_secret") || "").trim() || crypto.randomBytes(16).toString("hex");

  const { error } = await supabase.from("crm_connections").upsert({
    tenant_id,
    provider: "webhook",
    webhook_url: url,
    webhook_secret: secret,
    push_on,
    is_active: true,
  } as any, { onConflict: "tenant_id,provider" });

  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true, secret };
}

export async function savePipedriveConnection(formData: FormData) {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Apenas o dono do workspace pode configurar integrações." };

  const api_token = String(formData.get("api_token") || "").trim();
  const company_domain = String(formData.get("company_domain") || "").trim();
  const pipeline_id = String(formData.get("pipeline_id") || "").trim() || null;
  const stage_id = String(formData.get("stage_id") || "").trim() || null;
  const push_on = String(formData.get("push_on") || "both");
  const pull_enabled = formData.get("pull_enabled") === "on";

  if (!api_token) return { error: "Informe o token da API do Pipedrive." };

  const { error } = await supabase.from("crm_connections").upsert({
    tenant_id,
    provider: "pipedrive",
    api_token,
    company_domain: company_domain || null,
    pipeline_id,
    stage_id,
    push_on,
    pull_enabled,
    is_active: true,
  } as any, { onConflict: "tenant_id,provider" });

  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function disconnectCrm(provider: string) {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Apenas o dono do workspace." };

  const { error } = await supabase.from("crm_connections").delete().eq("tenant_id", tenant_id).eq("provider", provider);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

// Testa a conexão enviando um lead de exemplo
export async function testCrmConnection(provider: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: conn } = await supabase
    .from("crm_connections").select("*").eq("tenant_id", tenant_id).eq("provider", provider).maybeSingle();
  if (!conn) return { error: "Conexão não encontrada." };

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", tenant_id).maybeSingle();
  const { pushLead } = await import("@/lib/crm");

  const r = await pushLead(conn as any, {
    contact: {
      id: "00000000-0000-0000-0000-000000000000",
      name: "Contato de Teste",
      email: "teste@exemplo.com",
      phone: "11999999999",
      company: "Empresa de Teste",
      origin: "Teste de integração",
      status: "replied",
    },
    trigger: "replied",
    meeting: null,
    cadence: "Teste de integração",
    workspace: (tenant as any)?.name || "Contatia",
  });

  if (r.error) return { error: r.error };
  const nomes: Record<string, string> = {
    pipedrive: "Negócio de teste criado no Pipedrive.",
    hubspot: "Negócio de teste criado no HubSpot.",
    rdstation: "Negócio de teste criado no RD Station CRM.",
    webhook: "Webhook chamado com sucesso.",
  };
  return { ok: true, msg: nomes[provider] || "Conexão testada com sucesso." };
}

export async function saveHubspotConnection(formData: FormData) {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Apenas o dono do workspace pode configurar integrações." };

  const api_token = String(formData.get("api_token") || "").trim();
  const pipeline_id = String(formData.get("pipeline_id") || "").trim() || null;
  const stage_id = String(formData.get("stage_id") || "").trim() || null;
  const push_on = String(formData.get("push_on") || "both");
  const pull_enabled = formData.get("pull_enabled") === "on";

  if (!api_token) return { error: "Informe o token do Private App do HubSpot." };

  const { error } = await supabase.from("crm_connections").upsert({
    tenant_id, provider: "hubspot", api_token, pipeline_id, stage_id, push_on, pull_enabled, is_active: true,
  } as any, { onConflict: "tenant_id,provider" });

  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function saveRdstationConnection(formData: FormData) {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Apenas o dono do workspace pode configurar integrações." };

  const api_token = String(formData.get("api_token") || "").trim();
  const stage_id = String(formData.get("stage_id") || "").trim() || null;
  const push_on = String(formData.get("push_on") || "both");
  const pull_enabled = formData.get("pull_enabled") === "on";

  if (!api_token) return { error: "Informe o token da API do RD Station CRM." };

  const { error } = await supabase.from("crm_connections").upsert({
    tenant_id, provider: "rdstation", api_token, stage_id, push_on, pull_enabled, is_active: true,
  } as any, { onConflict: "tenant_id,provider" });

  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}
