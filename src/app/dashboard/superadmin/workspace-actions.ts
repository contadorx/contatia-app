"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Exclusão de workspace (tenant) — SÓ superadmin. A FK on delete cascade apaga os
// dados do tenant (contatos, cadências, negócios, tarefas…); os perfis dos membros
// ficam com tenant_id nulo (voltam ao estado "sem workspace"). Cancela a assinatura
// no Asaas antes, para não deixar cobrança órfã. Protege o próprio workspace do admin.
export async function deleteWorkspace(tenantId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login." };

  const { data: me } = await supabase
    .from("profiles")
    .select("is_superadmin, tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!(me as any)?.is_superadmin) return { error: "Apenas o superadmin pode excluir workspaces." };
  if (!tenantId) return { error: "Workspace inválido." };
  if ((me as any).tenant_id === tenantId) {
    return { error: "Você não pode excluir o seu próprio workspace por aqui (proteção contra apagar seus dados)." };
  }

  const admin = createAdminClient();
  if (!admin) return { error: "Exclusão indisponível: SUPABASE_SERVICE_ROLE_KEY não configurada." };

  // cancela a assinatura no Asaas, se houver (evita cobrança órfã)
  try {
    const { data: t } = await admin.from("tenants").select("asaas_subscription_id").eq("id", tenantId).maybeSingle();
    const sub = (t as any)?.asaas_subscription_id as string | null;
    if (sub) {
      const { cancelAsaasSubscription } = await import("@/lib/asaas");
      await cancelAsaasSubscription(sub);
    }
  } catch { /* não bloqueia a exclusão */ }

  const { error } = await admin.from("tenants").delete().eq("id", tenantId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/superadmin");
  return { ok: true };
}
