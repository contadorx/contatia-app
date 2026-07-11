import { discoverEmail, workerConfigurado } from "@/lib/emailFinder";

// ============================================================
// Processa a fila de descoberta de e-mail (chamado pelo cron diário).
//
// Para cada lead sem e-mail (tipicamente vindo do LinkedIn), pergunta ao worker:
// "existe alguma caixa que bata com este nome neste domínio?"
//
// REGRA DE OURO: só grava o e-mail quando o servidor CONFIRMA a caixa.
// Se não confirmar, marca o contato para a cadência de WhatsApp — nunca chuta.
// ============================================================

const MAX_ATTEMPTS = 3;

export async function processEmailDiscovery(admin: any): Promise<{ found: number; notFound: number; errors: number }> {
  if (!workerConfigurado()) return { found: 0, notFound: 0, errors: 0 };

  let found = 0, notFound = 0, errors = 0;

  const { data: jobs } = await admin
    .from("email_discovery_queue")
    .select("id, tenant_id, contact_id, name, domain, attempts")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(25); // a conversa SMTP é lenta: poucos por rodada

  for (const job of ((jobs as any[]) || [])) {
    try {
      const r = await discoverEmail(job.name, job.domain);

      if (r.status === "error") {
        errors++;
        await admin.from("email_discovery_queue").update({
          attempts: (job.attempts || 0) + 1,
          last_error: "worker indisponível",
        }).eq("id", job.id);
        continue;
      }

      if (r.status === "valid" && r.email) {
        // o servidor confirmou a caixa → pode entrar na cadência de e-mail
        await admin.from("contacts").update({
          email: r.email,
          email_status: "ok",
          email_discovery: "valid",
          email_discovered_at: new Date().toISOString(),
        }).eq("id", job.contact_id);

        await admin.from("events").insert({
          tenant_id: job.tenant_id,
          contact_id: job.contact_id,
          type: "note",
          detail: `E-mail descoberto e confirmado no servidor: ${r.email}`,
        });

        found++;
      } else {
        // não confirmou (not_found / uncertain / blocked / invalid)
        // → o contato NÃO recebe e-mail. Vai para a cadência de WhatsApp.
        const motivo: Record<string, string> = {
          not_found: "nenhum padrão de e-mail existe neste domínio",
          uncertain: "o domínio aceita qualquer endereço (catch-all) — não dá para confiar",
          blocked: "o provedor (Google/Microsoft) não permite verificar",
          invalid: "o domínio não tem servidor de e-mail",
        };

        await admin.from("contacts").update({
          email_discovery: r.status,
          email_discovered_at: new Date().toISOString(),
        }).eq("id", job.contact_id);

        await admin.from("events").insert({
          tenant_id: job.tenant_id,
          contact_id: job.contact_id,
          type: "note",
          detail: `E-mail não confirmado (${motivo[r.status] || r.status}). Use WhatsApp ou LinkedIn com este contato.`,
        });

        notFound++;
      }

      await admin.from("email_discovery_queue").update({
        status: "done",
        result: r.status,
        found_email: r.email || null,
        processed_at: new Date().toISOString(),
      }).eq("id", job.id);

    } catch (e: any) {
      errors++;
      await admin.from("email_discovery_queue").update({
        attempts: (job.attempts || 0) + 1,
        last_error: String(e?.message || e),
      }).eq("id", job.id);
    }
  }

  return { found, notFound, errors };
}
