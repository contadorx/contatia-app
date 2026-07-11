import { pushLead, pullDeals, PULL_PROVIDERS, type CrmConnection, type LeadPayload } from "@/lib/crm";

// ============================================================
// Processa a fila de sincronia com CRMs (chamado pelo cron diário).
// PUSH: leads quentes (respondeu / reunião marcada) vão para o CRM do cliente.
// PULL: negócios ganhos/perdidos lá voltam para cá e ENCERRAM a cadência —
//       ninguém quer mandar follow-up para quem já fechou.
// ============================================================

const MAX_ATTEMPTS = 4;

export async function processCrmQueue(admin: any): Promise<{ pushed: number; failed: number; pulled: number }> {
  let pushed = 0, failed = 0, pulled = 0;

  // ---------- PUSH ----------
  const { data: jobs } = await admin
    .from("crm_sync_queue")
    .select("id, tenant_id, connection_id, entity, local_id, payload, attempts")
    .eq("status", "pending")
    .eq("direction", "push")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(100);

  for (const job of (jobs as any[]) || []) {
    try {
      const { data: conn } = await admin
        .from("crm_connections").select("*").eq("id", job.connection_id).maybeSingle();
      if (!conn || !conn.is_active) {
        await admin.from("crm_sync_queue").update({ status: "done", processed_at: new Date().toISOString(), last_error: "conexão inativa" }).eq("id", job.id);
        continue;
      }

      // monta o payload a partir do registro local
      let contact: any = null;
      let meeting: any = null;

      if (job.entity === "contact") {
        const { data } = await admin.from("contacts")
          .select("id, name, email, phone, company, origin, status").eq("id", job.local_id).maybeSingle();
        contact = data;
      } else {
        const { data: m } = await admin.from("meetings")
          .select("id, contact_id, datetime, title").eq("id", job.local_id).maybeSingle();
        meeting = m;
        if (m?.contact_id) {
          const { data } = await admin.from("contacts")
            .select("id, name, email, phone, company, origin, status").eq("id", m.contact_id).maybeSingle();
          contact = data;
        }
      }

      if (!contact) {
        await admin.from("crm_sync_queue").update({ status: "done", processed_at: new Date().toISOString(), last_error: "registro local não encontrado" }).eq("id", job.id);
        continue;
      }

      const { data: tenant } = await admin.from("tenants").select("name").eq("id", job.tenant_id).maybeSingle();

      const payload: LeadPayload = {
        contact,
        trigger: (job.payload?.trigger === "meeting" ? "meeting" : "replied"),
        meeting: meeting ? { datetime: meeting.datetime, title: meeting.title } : null,
        cadence: null,
        workspace: tenant?.name || "Contatia",
      };

      const r = await pushLead(conn as CrmConnection, payload);

      if (r.error) {
        failed++;
        const attempts = (job.attempts || 0) + 1;
        await admin.from("crm_sync_queue").update({
          attempts,
          last_error: r.error,
          status: attempts >= MAX_ATTEMPTS ? "error" : "pending",
        }).eq("id", job.id);
        continue;
      }

      // guarda o espelho local↔remoto (permite o pull depois)
      if (r.remoteId) {
        await admin.from("crm_links").upsert({
          tenant_id: job.tenant_id,
          connection_id: conn.id,
          entity: job.entity === "contact" ? "contact" : "opportunity",
          local_id: job.local_id,
          remote_id: r.remoteId,
          synced_at: new Date().toISOString(),
        }, { onConflict: "connection_id,entity,local_id" });
      }

      await admin.from("crm_sync_queue").update({ status: "done", processed_at: new Date().toISOString() }).eq("id", job.id);
      pushed++;
    } catch (e: any) {
      failed++;
      await admin.from("crm_sync_queue").update({
        attempts: (job.attempts || 0) + 1,
        last_error: String(e?.message || e),
      }).eq("id", job.id);
    }
  }

  // ---------- PULL (Pipedrive): ganhou/perdeu lá → encerra a cadência aqui ----------
  const { data: conns } = await admin
    .from("crm_connections")
    .select("*")
    .in("provider", PULL_PROVIDERS)
    .eq("is_active", true)
    .eq("pull_enabled", true);

  for (const conn of (conns as any[]) || []) {
    try {
      const { data: links } = await admin
        .from("crm_links")
        .select("id, local_id, remote_id, entity, remote_status")
        .eq("connection_id", conn.id)
        .neq("remote_status", "won")
        .neq("remote_status", "lost")
        .limit(200);

      const ids = ((links as any[]) || []).map((l) => l.remote_id);
      if (!ids.length) continue;

      const { statuses } = await pullDeals(conn as CrmConnection, ids);

      for (const l of (links as any[]) || []) {
        const st = statuses[l.remote_id];
        if (!st || st === l.remote_status) continue;

        await admin.from("crm_links").update({ remote_status: st, synced_at: new Date().toISOString() }).eq("id", l.id);

        // fechou (ganhou ou perdeu) lá → para de perseguir aqui
        if (st === "won" || st === "lost") {
          const contactId = l.entity === "contact" ? l.local_id : null;
          if (contactId) {
            const { data: enrs } = await admin
              .from("enrollments").select("id").eq("contact_id", contactId).eq("status", "active");
            for (const e of (enrs as any[]) || []) {
              await admin.from("enrollments").update({ status: st === "won" ? "won" : "closed" }).eq("id", e.id);
              await admin.from("tasks").update({ status: "skipped" }).eq("enrollment_id", e.id).eq("status", "pending");
            }
            await admin.from("contacts").update({ status: st === "won" ? "customer" : "closed" }).eq("id", contactId);
            await admin.from("events").insert({
              tenant_id: conn.tenant_id,
              contact_id: contactId,
              type: "crm_sync",
              detail: st === "won" ? "Negócio GANHO no CRM — cadência encerrada." : "Negócio perdido no CRM — cadência encerrada.",
            });
          }
          pulled++;
        }
      }

      await admin.from("crm_connections").update({ last_pull_at: new Date().toISOString() }).eq("id", conn.id);
    } catch {
      /* pull é best-effort; não derruba o cron */
    }
  }

  return { pushed, failed, pulled };
}
