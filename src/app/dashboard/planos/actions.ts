"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase.from("profiles").select("tenant_id, role").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, user, tenant_id: (prof as any)?.tenant_id as string | null, role: (prof as any)?.role };
}

// Conta os usuários ativos do workspace (para calcular o valor por assento).
async function seatCount(supabase: any, tenant_id: string): Promise<number> {
  const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenant_id);
  return Math.max(1, count ?? 1);
}

export async function subscribePlan(planId: string) {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Apenas o dono do workspace pode assinar." };

  const { data: plan } = await supabase
    .from("platform_plans")
    .select("id, name, price_monthly, max_seats")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return { error: "Plano não encontrado." };

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, legal_name, cnpj, contact_email, asaas_customer_id")
    .eq("id", tenant_id)
    .maybeSingle();
  if (!tenant) return { error: "Workspace não encontrado." };

  const seats = await seatCount(supabase, tenant_id);
  const value = Number((plan as any).price_monthly) * seats;

  const { ensureAsaasCustomer, createAsaasSubscription } = await import("@/lib/asaas");

  // garante o cliente no Asaas
  const cust = await ensureAsaasCustomer({
    name: (tenant as any).legal_name || (tenant as any).name || "Cliente Contatia",
    email: (tenant as any).contact_email,
    cpfCnpj: (tenant as any).cnpj,
    existingId: (tenant as any).asaas_customer_id,
  });
  if (cust.error || !cust.id) return { error: cust.error || "Falha ao registrar cliente no Asaas." };

  // cria a assinatura recorrente
  const sub = await createAsaasSubscription({
    customerId: cust.id,
    value,
    description: `Contatia ${(plan as any).name} — ${seats} usuário(s)`,
  });
  if (sub.error) return { error: sub.error };

  // vincula o plano ao tenant (status aguardando 1º pagamento; o webhook confirma)
  await supabase.from("tenants").update({
    plan_id: (plan as any).id,
    asaas_customer_id: cust.id,
    subscription_status: "pending",
    mrr: value,
  }).eq("id", tenant_id);

  revalidatePath("/dashboard/planos");
  return { ok: true, link: sub.link, value, seats, planName: (plan as any).name };
}
