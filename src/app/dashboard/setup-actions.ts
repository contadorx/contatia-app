"use server";

import { msgErro } from "@/lib/erros";
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
  if (e2) return { error: msgErro(e2) };

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

  // DADOS DE EXEMPLO — o workspace não nasce vazio: 3 contatos + 1 cadência marcados
  // com a tag "Exemplo" (o usuário apaga em 1 clique filtrando por ela). Sem e-mail,
  // então nada é enviado por engano. É só cortesia: nunca bloqueia o cadastro.
  try {
    const { data: tag } = await admin.from("tags").insert({ tenant_id: tid, name: "Exemplo", color: "#F79009" }).select("id").single();
    const tagId = (tag as any)?.id;
    const exemplos = [
      { name: "Ana Prado", company: "Prado Contabilidade", phone: "(11) 90000-0001" },
      { name: "Bruno Martins", company: "Martins Logística", phone: "(11) 90000-0002" },
      { name: "Carla Nunes", company: "Nunes & Cia", phone: "(11) 90000-0003" },
    ];
    const { data: cts } = await admin.from("contacts").insert(
      exemplos.map((e) => ({
        tenant_id: tid, assigned_to: user.id, name: e.name, company: e.company, phone: e.phone,
        origin: "Exemplo", status: "novo",
        notes: "Contato de exemplo — criado no cadastro para você ver como funciona. Apague quando quiser (filtre pela tag Exemplo).",
      }))
    ).select("id");
    if (tagId && cts) {
      await admin.from("contact_tags").insert((cts as any[]).map((c) => ({ tenant_id: tid, contact_id: c.id, tag_id: tagId })));
    }
    const { data: seq } = await admin.from("sequences").insert({
      tenant_id: tid, name: "Exemplo — Primeira prospecção (edite ou apague)", audience: "Exemplo", created_by: user.id,
    }).select("id").single();
    const seqId = (seq as any)?.id;
    if (seqId) {
      await admin.from("sequence_steps").insert([
        { sequence_id: seqId, tenant_id: tid, position: 0, channel: "whatsapp", delay_days: 0, subject: null, subject_b: null,
          body_template: "Olá! Falo com {{primeiro_nome}}? Aqui é [Seu Nome], da [Sua Empresa]. Posso te apresentar rápido uma ideia pra {{empresa}}?" },
        { sequence_id: seqId, tenant_id: tid, position: 1, channel: "email", delay_days: 2, subject: "Uma ideia para {{empresa}}", subject_b: null,
          body_template: "Oi {{primeiro_nome}}, complementando meu contato: ajudamos empresas como a {{empresa}} a [resultado]. Vale uma conversa de 10 min?" },
      ]);
    }
  } catch { /* seed é só cortesia — nunca bloqueia o cadastro */ }

  revalidatePath("/dashboard");
  return { ok: true };
}

// Dispensa a caixa "Primeiros passos" do Hoje ("não mostrar mais"). Por usuário,
// persistido no perfil — some em qualquer dispositivo, não é cookie.
export async function hideOnboarding() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };
  const { error } = await supabase.from("profiles").update({ onboarding_hidden: true }).eq("id", user.id);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard");
  return { ok: true };
}
