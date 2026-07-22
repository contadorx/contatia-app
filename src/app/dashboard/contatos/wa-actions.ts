"use server";

// ============================================================
// VERIFICAR WHATSAPP EM MASSA (ação da lista de contatos)
//
// Verifica na HORA um primeiro lote (uma chamada ao Evolution) e ENFILEIRA o
// excedente para o cron drenar com ritmo seguro (anti-ban). Exige o modo
// Evolution conectado — no modo assistido não há sessão para consultar.
// ============================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { verifyContactsBatch } from "@/lib/waVerify";

// quantos verificar na hora (é UMA chamada ao Evolution com todas as variantes)
const INLINE_LIMIT = 60;

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null };
}

const digits = (s: any) => String(s || "").replace(/\D/g, "");

export async function verificarWhatsAppLote(contactIds: string[]): Promise<{
  ok?: boolean; verificados?: number; comWa?: number; semWa?: number; enfileirados?: number; semTelefone?: number; error?: string;
}> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!contactIds.length) return { error: "Nada selecionado." };

  // precisa do modo Evolution + instância conectada
  const { data: tmode } = await supabase.from("tenants").select("whatsapp_mode").eq("id", tenant_id).maybeSingle();
  if ((tmode as any)?.whatsapp_mode !== "evolution") {
    return { error: "A verificação em massa exige o WhatsApp no modo Evolution conectado (Config → Canais)." };
  }
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("id, evolution_url, api_key, instance")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!acc) return { error: "Nenhuma instância WhatsApp conectada." };

  const { data: rows } = await supabase
    .from("contacts")
    .select("id, phone")
    .in("id", contactIds)
    .eq("tenant_id", tenant_id);
  const list = ((rows as any[]) || []);
  const comTel = list.filter((c) => digits(c.phone).length >= 10);
  const semTelefone = list.length - comTel.length;

  const inline = comTel.slice(0, INLINE_LIMIT);
  const resto = comTel.slice(INLINE_LIMIT);

  let comWa = 0, semWa = 0;
  if (inline.length) {
    try {
      const results = await verifyContactsBatch(acc as any, inline);
      const nowIso = new Date().toISOString();
      await Promise.all(
        results.map((r) => {
          if (r.status === "valid") comWa++; else semWa++;
          return supabase
            .from("contacts")
            .update({ wa_status: r.status, wa_number: r.number, wa_checked_at: nowIso } as any)
            .eq("id", r.id)
            .eq("tenant_id", tenant_id);
        })
      );
    } catch (e: any) {
      return { error: "Falha ao consultar o WhatsApp: " + (e?.message || "erro") };
    }
  }

  let enfileirados = 0;
  if (resto.length) {
    const ids = resto.map((c) => c.id);
    await supabase.from("contacts").update({ wa_status: "queued" } as any).in("id", ids).eq("tenant_id", tenant_id);
    enfileirados = ids.length;
  }

  revalidatePath("/dashboard/contatos");
  return { ok: true, verificados: inline.length, comWa, semWa, enfileirados, semTelefone };
}
