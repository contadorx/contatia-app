"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dominioDe } from "@/lib/emailFinder";

// ============================================================
// Enfileira a descoberta do e-mail de um contato que não tem endereço.
// Chamado pela extensão (captura do LinkedIn) e pela tela do contato.
// O processamento acontece no cron (chama o worker no VPS) — assim a captura
// é instantânea e a conversa SMTP, que é lenta, roda em segundo plano.
// ============================================================

export async function enqueueEmailDiscovery(contactId: string, domainOrSite?: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  const tenant_id = (prof as any)?.tenant_id;
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, email, company, company_domain")
    .eq("id", contactId)
    .maybeSingle();

  if (!contact) return { error: "Contato não encontrado." };
  if ((contact as any).email) return { error: "Este contato já tem e-mail." };

  // domínio: o informado agora, o já salvo, ou nada
  const dominio = dominioDe(domainOrSite) || (contact as any).company_domain;
  if (!dominio) {
    return { error: "Informe o site ou o domínio da empresa para procurar o e-mail." };
  }

  await supabase.from("contacts").update({ company_domain: dominio } as any).eq("id", contactId);

  const { error } = await supabase.from("email_discovery_queue").upsert({
    tenant_id,
    contact_id: contactId,
    name: (contact as any).name,
    domain: dominio,
    status: "pending",
    attempts: 0,
  } as any, { onConflict: "contact_id" });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/contatos/${contactId}`);
  return { ok: true, msg: "Procurando o e-mail. O resultado aparece em alguns minutos." };
}
