"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Cria o workspace (tenant) de um usuário novo e o torna DONO, com os estágios
// padrão do funil — o passo de onboarding que faltava para o cadastro self-service.
// Usa service role (o usuário ainda não tem tenant, então a RLS não deixaria inserir).
// Idempotente: se o perfil já tem workspace, não faz nada.
export async function setupWorkspace(name: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login primeiro." };

  const { data: prof } = await supabase.from("profiles").select("tenant_id, full_name").eq("id", user.id).maybeSingle();
  if ((prof as any)?.tenant_id) { revalidatePath("/dashboard"); return { ok: true, already: true }; }

  const admin = createAdminClient();
  if (!admin) return { error: "Configuração indisponível (service role). Fale com o suporte." };

  const wsName = (name || "").trim() || (prof as any)?.full_name || "Meu workspace";

  const { data: t, error: e1 } = await admin
    .from("tenants")
    .insert({ name: wsName, contact_email: user.email || null, inbound_token: crypto.randomUUID().replace(/-/g, "") })
    .select("id")
    .single();
  if (e1 || !t) return { error: e1?.message || "Não foi possível criar o workspace." };

  const tid = (t as any).id as string;

  const { error: e2 } = await admin
    .from("profiles")
    .update({ tenant_id: tid, role: "owner", is_active: true })
    .eq("id", user.id);
  if (e2) return { error: e2.message };

  // estágios padrão do funil (mesmos do bootstrap SEED)
  await admin.from("pipeline_stages").insert([
    { tenant_id: tid, name: "Novo", position: 0, is_won: false, is_lost: false },
    { tenant_id: tid, name: "Contatado", position: 1, is_won: false, is_lost: false },
    { tenant_id: tid, name: "Respondeu", position: 2, is_won: false, is_lost: false },
    { tenant_id: tid, name: "Reunião", position: 3, is_won: false, is_lost: false },
    { tenant_id: tid, name: "Proposta", position: 4, is_won: false, is_lost: false },
    { tenant_id: tid, name: "Fechado", position: 5, is_won: true, is_lost: false },
    { tenant_id: tid, name: "Perdido", position: 6, is_won: false, is_lost: true },
  ]);

  revalidatePath("/dashboard");
  return { ok: true };
}
