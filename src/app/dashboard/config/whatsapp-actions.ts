"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { platformEvolution } from "@/lib/whatsapp";

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
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

// ============================================================
// O cliente escolhe o NÍVEL do canal WhatsApp:
//   'assistido' → link wa.me (zero risco). Não precisa de nada.
//   'evolution' → API não-oficial (com risco). Exige ACEITE registrado uma vez.
// A API oficial da Meta é roadmap (não selecionável aqui ainda).
// ============================================================
export async function setWhatsAppMode(mode: "assistido" | "evolution", ackRisk?: boolean) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  if (mode === "assistido") {
    const { error } = await supabase.from("tenants").update({ whatsapp_mode: "assistido" }).eq("id", tenant_id);
    if (error) return { error: error.message };
    revalidatePath("/dashboard/config");
    revalidatePath("/dashboard");
    return { ok: true };
  }

  // modo Evolution: exige o aceite de risco (uma vez por workspace)
  const { data: t } = await supabase.from("tenants").select("whatsapp_risk_ack_at").eq("id", tenant_id).maybeSingle();
  const jaAceitou = !!(t as any)?.whatsapp_risk_ack_at;
  if (!jaAceitou && !ackRisk) return { needsAck: true };

  const patch: Record<string, unknown> = { whatsapp_mode: "evolution" };
  if (!jaAceitou && ackRisk) {
    patch.whatsapp_risk_ack_at = new Date().toISOString();
    patch.whatsapp_risk_ack_by = user_id ?? null;
  }
  const { error } = await supabase.from("tenants").update(patch).eq("id", tenant_id);
  if (error) return { error: error.message };

  // registra o aceite na trilha de auditoria (events)
  if (!jaAceitou && ackRisk) {
    await supabase.from("events").insert({
      tenant_id,
      type: "note",
      meta: { text: "Aceite de risco do WhatsApp não-oficial (Evolution/Baileys) registrado." },
    } as any);
  }

  // Modelo PLATAFORMA: se temos servidor Evolution gerenciado e o cliente ainda
  // não tem instância, criamos uma para ele — ele só precisará escanear o QR.
  const plat = platformEvolution();
  if (plat) {
    const { count } = await supabase.from("whatsapp_accounts").select("id", { count: "exact", head: true });
    if (!count) {
      const inst = "ct_" + tenant_id.replace(/-/g, "").slice(0, 12);
      await supabase.from("whatsapp_accounts").insert({
        tenant_id,
        evolution_url: plat.url,
        api_key: plat.api_key,
        instance: inst,
        is_active: true,
      });
    }
  }

  revalidatePath("/dashboard/config");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function saveWhatsApp(input: { evolution_url: string; api_key: string; instance: string }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.evolution_url.trim() || !input.api_key.trim() || !input.instance.trim())
    return { error: "Preencha URL, API key e instância." };
  const { error } = await supabase.from("whatsapp_accounts").insert({
    tenant_id,
    evolution_url: input.evolution_url.trim(),
    api_key: input.api_key.trim(),
    instance: input.instance.trim(),
    is_active: true,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function deleteWhatsApp(id: string) {
  const { supabase } = await ctx();

  // apaga a instância no servidor Evolution ANTES de sumir com o registro —
  // senão ela fica órfã lá e trava a próxima conexão com o mesmo nome
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance")
    .eq("id", id)
    .maybeSingle();

  if (acc) {
    const { deleteInstance } = await import("@/lib/whatsapp");
    await deleteInstance(acc as any).catch(() => {});
  }

  const { error } = await supabase.from("whatsapp_accounts").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function whatsappQR(id: string) {
  const { supabase } = await ctx();
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance, inbound_token")
    .eq("id", id)
    .maybeSingle();
  if (!acc) return { error: "Conta não encontrada." };

  const { getQR, setWebhook } = await import("@/lib/whatsapp");
  const qr = await getQR(acc as any);

  // Configura o webhook AUTOMATICAMENTE: é o que faz a cadência pausar quando
  // o lead responde. Antes o usuário tinha que copiar a URL e colar na Evolution
  // na mão — e se esquecesse, seguiria mandando follow-up para quem já respondeu.
  try {
    const origem =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    if (origem && (acc as any).inbound_token) {
      const url = `${origem}/api/whatsapp/webhook/${(acc as any).inbound_token}`;
      await setWebhook(acc as any, url);
    }
  } catch { /* o QR é o principal; o webhook a gente confere depois */ }

  return qr;
}

/** Reconfigura o webhook (botão manual, caso algo tenha saído do lugar). */
export async function whatsappSetWebhook(id: string) {
  const { supabase } = await ctx();
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance, inbound_token")
    .eq("id", id)
    .maybeSingle();
  if (!acc) return { error: "Conta não encontrada." };

  const origem =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!origem) return { error: "Configure NEXT_PUBLIC_APP_URL no ambiente." };

  const { setWebhook } = await import("@/lib/whatsapp");
  const url = `${origem}/api/whatsapp/webhook/${(acc as any).inbound_token}`;
  const r = await setWebhook(acc as any, url);

  if (r.error) return { error: r.error };
  return { ok: true, msg: "Webhook configurado. As respostas dos leads vão chegar aqui." };
}

export async function whatsappStatus(id: string) {
  const { supabase } = await ctx();
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance")
    .eq("id", id)
    .maybeSingle();
  if (!acc) return { error: "Conta não encontrada." };
  const { getStatus } = await import("@/lib/whatsapp");
  return await getStatus(acc as any);
}
