"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function guard() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, ok: !!(me as any)?.is_superadmin };
}

function slugCode(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "parceiro"
  );
}

export async function createPartner(input: { name: string; email?: string; ref_code?: string; commission_rate?: number; pix_key?: string }) {
  const { supabase, ok } = await guard();
  if (!ok) return { error: "Apenas o dono da plataforma." };
  if (!input.name.trim()) return { error: "Nome do parceiro é obrigatório." };
  let code = (input.ref_code || slugCode(input.name)).trim();
  // garante unicidade
  const { data: exists } = await supabase.from("platform_partners").select("id").eq("ref_code", code).maybeSingle();
  if (exists) code = `${code}-${Math.random().toString(36).slice(2, 6)}`;

  const rate = input.commission_rate != null ? Number(input.commission_rate) / 100 : 0.2;
  const { error } = await supabase.from("platform_partners").insert({
    name: input.name.trim(),
    email: input.email?.trim() || null,
    ref_code: code,
    commission_rate: rate,
    pix_key: input.pix_key?.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/parceiros");
  return { ok: true };
}

export async function togglePartner(id: string, active: boolean) {
  const { supabase, ok } = await guard();
  if (!ok) return { error: "Apenas o dono da plataforma." };
  const { error } = await supabase.from("platform_partners").update({ is_active: active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/parceiros");
  return { ok: true };
}

export async function recordReferral(input: { partner_id: string; tenant_id?: string; label?: string; mrr: number; status?: string }) {
  const { supabase, ok } = await guard();
  if (!ok) return { error: "Apenas o dono da plataforma." };
  if (!input.partner_id) return { error: "Escolha o parceiro." };
  const { error } = await supabase.from("platform_referrals").insert({
    partner_id: input.partner_id,
    tenant_id: input.tenant_id || null,
    label: input.label?.trim() || null,
    mrr: Number(input.mrr) || 0,
    status: input.status || "active",
  });
  if (error) return { error: error.message };
  // se vinculou a um tenant, marca a atribuição
  if (input.tenant_id) await supabase.from("tenants").update({ referred_by: input.partner_id }).eq("id", input.tenant_id);
  revalidatePath("/dashboard/superadmin/parceiros");
  return { ok: true };
}

export async function setReferralStatus(id: string, status: string) {
  const { supabase, ok } = await guard();
  if (!ok) return { error: "Apenas o dono da plataforma." };
  const { error } = await supabase.from("platform_referrals").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/superadmin/parceiros");
  return { ok: true };
}
