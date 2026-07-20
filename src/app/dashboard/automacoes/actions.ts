"use server";

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

const DIAS_TRIGGERS = ["no_activity_days", "opportunity_lost", "opportunity_won", "state_days"];

export async function createAutomation(input: {
  name: string;
  trigger_type: string;
  trigger_value?: string;
  action_type: string;
  action_seq?: string;
  action_stage?: string;
  action_tag?: string;
  product_id?: string;
  source_seq?: string;
  priority?: number;
  stop_on_match?: boolean;
  end_current?: boolean;
  set_state?: string;
  cond_state?: string;
}) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.name.trim()) return { error: "Dê um nome à automação." };
  if (input.action_type === "enroll" && !input.action_seq) return { error: "Escolha a cadência para inscrever." };
  if (input.action_type === "move_stage" && !input.action_stage) return { error: "Escolha o estágio de destino." };
  if (input.action_type === "add_tag" && !input.action_tag) return { error: "Escolha a tag a aplicar." };
  if ((input.action_type === "mark_state") && !(input.set_state || "").trim()) return { error: "Informe o estado a marcar (ex.: dormente)." };
  if (input.trigger_type === "score_gte" && !input.trigger_value) return { error: "Informe o score mínimo." };
  if (DIAS_TRIGGERS.includes(input.trigger_type) && !input.trigger_value) return { error: "Informe a quantidade de dias." };
  if (input.trigger_type === "state_days" && !(input.cond_state || "").trim()) return { error: "Informe o estado do gatilho (ex.: dormente)." };

  const { error } = await supabase.from("automations").insert({
    tenant_id,
    name: input.name.trim(),
    trigger_type: input.trigger_type,
    trigger_value: input.trigger_value || null,
    action_type: input.action_type,
    action_seq: input.action_type === "enroll" ? input.action_seq : null,
    action_stage: input.action_type === "move_stage" ? input.action_stage : null,
    action_tag: (input.action_type === "add_tag" || input.action_type === "suppress") ? input.action_tag || null : null,
    // escopo por produto (opcional) para gatilhos que dependem de "no produto"
    product_id: input.product_id || null,
    // cadência de origem do gatilho "terminou a cadência"
    source_seq: input.trigger_type === "cadence_completed" ? input.source_seq || null : null,
    // máquina de estados (Fase 1): ordem, parar-no-match, transição limpa, estado-destino
    priority: Number.isFinite(input.priority as number) ? (input.priority as number) : 100,
    stop_on_match: input.stop_on_match === true,
    end_current: input.action_type === "enroll" ? input.end_current === true : false,
    set_state: (input.set_state || "").trim() || null,
    cond_state: input.trigger_type === "state_days" ? (input.cond_state || "").trim() || null : null,
    created_by: user_id,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/automacoes");
  return { ok: true };
}

export async function toggleAutomation(id: string, active: boolean) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("automations").update({ is_active: active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/automacoes");
  return { ok: true };
}

export async function deleteAutomation(id: string) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("automations").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/automacoes");
  return { ok: true };
}

// ============================================================
// TEMPLATES DE AUTOMAÇÃO (biblioteca de sugestões)
// ============================================================

// Lista os modelos: globais (curados) + os do próprio tenant.
export async function listAutomationTemplates() {
  const { supabase } = await ctx();
  const { data } = await supabase
    .from("automation_templates")
    .select("id, tenant_id, name, description, category, config, is_global, sort")
    .order("is_global", { ascending: false })
    .order("category", { ascending: true })
    .order("sort", { ascending: true });
  return { templates: (data as any[]) || [] };
}

// Salva uma automação existente como modelo. Superadmin pode publicar como GLOBAL.
export async function saveAutomationAsTemplate(automationId: string, opts?: { description?: string; global?: boolean; category?: string }) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { data: a } = await supabase
    .from("automations")
    .select("name, trigger_type, trigger_value, action_type, priority, stop_on_match, end_current, set_state, cond_state")
    .eq("id", automationId)
    .maybeSingle();
  if (!a) return { error: "Automação não encontrada." };
  const r = a as any;
  // guarda só o "esqueleto" (sem cadência/estágio/tag/produto — são do workspace)
  const config = {
    trigger_type: r.trigger_type,
    trigger_value: r.trigger_value || undefined,
    action_type: r.action_type,
    priority: r.priority ?? 100,
    stop_on_match: !!r.stop_on_match,
    end_current: !!r.end_current,
    set_state: r.set_state || undefined,
    cond_state: r.cond_state || undefined,
  };
  const isGlobal = opts?.global === true;
  // só superadmin publica global
  let superadmin = false;
  if (isGlobal) {
    const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user_id ?? "").maybeSingle();
    superadmin = !!(me as any)?.is_superadmin;
    if (!superadmin) return { error: "Só o superadmin publica modelo global." };
  }
  const { error } = await supabase.from("automation_templates").insert({
    tenant_id: isGlobal ? null : tenant_id,
    name: r.name,
    description: opts?.description || null,
    category: opts?.category || "geral",
    config,
    is_global: isGlobal,
    created_by: user_id,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/automacoes");
  return { ok: true };
}

export async function deleteAutomationTemplate(id: string) {
  const { supabase } = await ctx();
  // a RLS já restringe: tenant só apaga os seus; superadmin apaga globais
  const { error } = await supabase.from("automation_templates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/automacoes");
  return { ok: true };
}

// Pré-instala as automações padrão (só as autocontidas: pontuar/marcar estado — sem
// alvo de cadência/estágio/tag) em workspace novo. Roda uma vez por tenant (flag).
export async function ensureDefaultAutomations() {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return;
  const { data: t } = await supabase.from("tenants").select("automations_seeded").eq("id", tenant_id).maybeSingle();
  if ((t as any)?.automations_seeded) return;

  // modelos globais marcados como install_default E sem "needs" (não exigem escolha)
  const { data: tpls } = await supabase
    .from("automation_templates")
    .select("name, config")
    .eq("is_global", true)
    .eq("install_default", true);

  const rows = ((tpls as any[]) || [])
    .filter((tp) => !(tp.config?.needs && tp.config.needs.length))
    .map((tp) => {
      const c = tp.config || {};
      return {
        tenant_id,
        name: tp.name,
        trigger_type: c.trigger_type,
        trigger_value: c.trigger_value || null,
        action_type: c.action_type,
        priority: c.priority ?? 100,
        stop_on_match: !!c.stop_on_match,
        end_current: !!c.end_current,
        set_state: c.set_state || null,
        cond_state: c.cond_state || null,
        created_by: user_id,
      };
    });

  if (rows.length) await supabase.from("automations").insert(rows);
  await supabase.from("tenants").update({ automations_seeded: true }).eq("id", tenant_id);
  revalidatePath("/dashboard/automacoes");
}
