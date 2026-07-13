"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return {
    supabase,
    user_id: user?.id as string,
    tenant_id: (prof as any)?.tenant_id as string | null,
    role: (prof as any)?.role as string,
  };
}

/**
 * Libera (ou revoga) o SDR para agendar na agenda de um vendedor.
 * Pode fazer: o ADMIN (qualquer agenda) ou o PRÓPRIO VENDEDOR (a agenda dele).
 * A regra também está na RLS — isto aqui é a checagem amigável.
 */
export async function toggleCalendarPermission(sdrId: string, sellerId: string, ativar: boolean) {
  const { supabase, tenant_id, role, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const podeMexer = role === "owner" || sellerId === user_id;
  if (!podeMexer) return { error: "Só o admin ou o dono da agenda pode alterar esta permissão." };

  if (ativar) {
    const { error } = await supabase.from("calendar_permissions").upsert({
      tenant_id,
      sdr_id: sdrId,
      seller_id: sellerId,
      can_view: true,
      can_book: true,
      granted_by: user_id,
    } as any, { onConflict: "sdr_id,seller_id" });
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("calendar_permissions")
      .delete()
      .eq("sdr_id", sdrId)
      .eq("seller_id", sellerId);
    if (error) return { error: error.message };
  }

  revalidatePath("/dashboard/equipe");
  revalidatePath("/dashboard/reunioes");
  return { ok: true };
}

/** Verificação de assentos: quantos cabem, e qual plano é o indicado. */
export async function checkSeats() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("seat_check");
  if (error) return null;
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;
  return {
    usuarios: Number((r as any).usuarios_atuais || 0),
    teto: (r as any).teto ?? null,
    plano: (r as any).plano_atual || "—",
    sugerido: (r as any).plano_sugerido || "—",
    podeAdicionar: !!(r as any).pode_adicionar,
  };
}
