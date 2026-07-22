"use server";

// ============================================================
// CAPTURAR TELEFONE / WHATSAPP DO SITE (ação da lista de contatos)
//
// Lê o site da empresa (domínio do contato ou da conta) e preenche o telefone que
// estiver faltando. Um link wa.me já entra como WhatsApp confirmado; um telefone
// comum vai para a fila de verificação. Captura um primeiro lote na hora e
// enfileira o excedente para o cron.
// ============================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { captureContactsBatch, buildCaptureUpdate } from "@/lib/webPhone";
import { dominioDe } from "@/lib/emailFinder";

const INLINE_LIMIT = 8; // raspagem é mais lenta que a verificação — lote menor na hora

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null };
}

export async function capturarDoSiteLote(contactIds: string[]): Promise<{
  ok?: boolean; capturados?: number; achou?: number; whats?: number; filaVerif?: number; enfileirados?: number; semDominio?: number; error?: string;
}> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!contactIds.length) return { error: "Nada selecionado." };

  const { data: rows } = await supabase
    .from("contacts")
    .select("id, phone, company_domain, wa_status, accounts(domain)")
    .in("id", contactIds)
    .eq("tenant_id", tenant_id);
  const list = ((rows as any[]) || []).map((c) => ({
    id: c.id,
    phone: c.phone as string | null,
    wa_status: c.wa_status as string | null,
    domain: dominioDe(c.company_domain || c.accounts?.domain || null),
  }));

  const comDominio = list.filter((c) => c.domain);
  const semDominio = list.length - comDominio.length;

  const inline = comDominio.slice(0, INLINE_LIMIT);
  const resto = comDominio.slice(INLINE_LIMIT);

  let achou = 0, whats = 0, filaVerif = 0;
  if (inline.length) {
    const results = await captureContactsBatch(inline.map((c) => ({ id: c.id, domain: c.domain })), 6);
    const byId = new Map(inline.map((c) => [c.id, c]));
    const nowIso = new Date().toISOString();
    await Promise.all(
      results.map((r) => {
        const cur = byId.get(r.id)!;
        if (r.whatsapp) { achou++; whats++; }
        else if (r.phone) { achou++; if (cur.wa_status !== "valid") filaVerif++; }
        return supabase.from("contacts").update(buildCaptureUpdate(r, cur, nowIso) as any).eq("id", r.id).eq("tenant_id", tenant_id);
      })
    );
  }

  let enfileirados = 0;
  if (resto.length) {
    await supabase.from("contacts").update({ web_capture: "queued" } as any).in("id", resto.map((c) => c.id)).eq("tenant_id", tenant_id);
    enfileirados = resto.length;
  }

  revalidatePath("/dashboard/contatos");
  return { ok: true, capturados: inline.length, achou, whats, filaVerif, enfileirados, semDominio };
}
