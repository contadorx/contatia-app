import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { fetchRecentMessages } from "@/lib/imap";
import { POINTS } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}` && key !== secret) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SERVICE_ROLE ausente" }, { status: 500 });

  const { data: accounts } = await admin
    .from("email_accounts")
    .select("id, tenant_id, smtp_host, smtp_user, smtp_pass, imap_host, imap_port, last_reply_check_at")
    .eq("detect_replies", true)
    .eq("is_active", true);

  let marked = 0;
  let suggestions = 0;
  const errors: string[] = [];

  // M8: a fase de IMAP não pode consumir todo o orçamento (maxDuration=60) e impedir os
  // jobs seguintes (cobrança, retenção, lifecycle) de rodar. Damos um teto de tempo à
  // fase inteira e um timeout por caixa — o que sobrar é retomado na próxima rodada.
  const IMAP_PHASE_DEADLINE = Date.now() + 30_000;
  const PER_ACCOUNT_MS = 12_000;
  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("imap timeout")), ms))]);

  for (const acc of (accounts as any[]) || []) {
    if (Date.now() > IMAP_PHASE_DEADLINE) {
      errors.push("orçamento de IMAP esgotado nesta rodada; caixas restantes na próxima");
      break;
    }
    const since = acc.last_reply_check_at
      ? new Date(acc.last_reply_check_at)
      : new Date(Date.now() - 24 * 3600 * 1000);

    let msgs: { from: string; subject: string }[] = [];
    try {
      msgs = await withTimeout(fetchRecentMessages(acc, since), PER_ACCOUNT_MS);
    } catch (e: any) {
      errors.push(`${acc.id}: ${e?.message || "imap erro"}`);
      continue; // não atualiza o cursor se falhou, tenta de novo depois
    }

    if (msgs.length) {
      const set = new Set(msgs.map((m) => m.from));
      // assunto por remetente (o primeiro que aparece) — para o contexto na timeline
      const subjectByEmail: Record<string, string> = {};
      for (const m of msgs) if (m.from && !subjectByEmail[m.from]) subjectByEmail[m.from] = m.subject;
      const { data: enrs } = await admin
        .from("enrollments")
        .select("id, contact_id, contacts(email)")
        .eq("tenant_id", acc.tenant_id)
        .eq("status", "active");

      for (const e of (enrs as any[]) || []) {
        const email = (e.contacts?.email || "").toLowerCase();
        if (!email || !set.has(email)) continue;
        await admin.from("enrollments").update({ status: "replied" }).eq("id", e.id);
        await admin.from("tasks").update({ status: "skipped" }).eq("enrollment_id", e.id).eq("status", "pending");
        await admin.from("events").insert({
          tenant_id: acc.tenant_id,
          contact_id: e.contact_id,
          type: "replied",
          meta: { via: "imap", text: subjectByEmail[email] ? `Assunto: "${subjectByEmail[email]}"` : "" },
        });
        const { data: c } = await admin.from("contacts").select("score").eq("id", e.contact_id).single();
        await admin
          .from("contacts")
          .update({ score: (c?.score || 0) + (POINTS["replied"] || 30), last_activity_at: new Date().toISOString() })
          .eq("id", e.contact_id);
        marked++;
      }

      // remetentes que NÃO são contatos → viram sugestão (não perder quem te respondeu)
      try {
        const ownDomain = (acc.smtp_user || "").split("@")[1]?.toLowerCase();
        const { data: known } = await admin.from("contacts").select("email").eq("tenant_id", acc.tenant_id).in("email", Array.from(set));
        const knownSet = new Set(((known as any[]) || []).map((k) => (k.email || "").toLowerCase()));
        for (const s of set) {
          const email = s.toLowerCase();
          if (knownSet.has(email)) continue;
          const dom = email.split("@")[1] || "";
          // ignora ruído: no-reply, o próprio domínio, e provedores de sistema
          if (/no-?reply|mailer-daemon|postmaster|notification|bounce/.test(email)) continue;
          if (ownDomain && dom === ownDomain) continue;
          await admin.from("contact_suggestions").upsert(
            { tenant_id: acc.tenant_id, email, status: "pending" },
            { onConflict: "tenant_id,email", ignoreDuplicates: true }
          );
          suggestions++;
        }
      } catch { /* sugestões não devem quebrar o cron */ }
    }

    await admin.from("email_accounts").update({ last_reply_check_at: new Date().toISOString() }).eq("id", acc.id);
  }

  // ---- Automações por TEMPO (ex.: 120 dias sem atividade → cadência de recuperação) ----
  let autoRan = 0;
  try {
    const { applyRule } = await import("@/lib/automations");
    const { data: timeRules } = await admin
      .from("automations")
      .select("id, tenant_id, trigger_type, trigger_value, action_type, action_seq, action_stage")
      .eq("is_active", true)
      .eq("trigger_type", "no_activity_days");

    for (const rule of (timeRules as any[]) || []) {
      const days = Number(rule.trigger_value) || 0;
      if (!days) continue;
      const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
      const { data: cands } = await admin
        .from("contacts")
        .select("id")
        .eq("tenant_id", rule.tenant_id)
        .lt("last_activity_at", cutoff)
        .limit(500);

      for (const c of (cands as any[]) || []) {
        // dedupe: essa regra já disparou para esse contato? (uma vez por contato)
        const { data: fired } = await admin
          .from("automation_logs")
          .select("id")
          .eq("automation_id", rule.id)
          .eq("contact_id", c.id)
          .maybeSingle();
        if (fired) continue;
        const ok = await applyRule(admin, { tenantId: rule.tenant_id, contactId: c.id, rule });
        if (ok) autoRan++;
      }
    }
  } catch {
    /* automações de tempo não devem quebrar o cron de respostas */
  }

  // ---- Expurgo de arquivos por retenção (LGPD + custo de storage) ----
  let purged = 0;
  try {
    const { data: tnts } = await admin.from("tenants").select("id, file_retention_months");
    for (const t of (tnts as any[]) || []) {
      const months = Number(t.file_retention_months) || 0;
      if (!months) continue; // 0/null = nunca expurga
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      const { data: docs } = await admin
        .from("documents")
        .select("id, storage_path")
        .eq("tenant_id", t.id)
        .not("storage_path", "is", null)
        .lt("created_at", cutoff.toISOString())
        .limit(200);
      for (const d of (docs as any[]) || []) {
        await admin.storage.from("proposals").remove([d.storage_path]);
        await admin.from("documents").update({ storage_path: null }).eq("id", d.id);
        purged++;
      }
    }
  } catch {
    /* expurgo não deve quebrar o cron */
  }

  // ---- Régua de cobrança: marca vencidas + reenvia lembrete (via API Brevo) ----
  let reminders = 0;
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    await admin.from("platform_invoices").update({ status: "overdue" }).eq("status", "pending").lt("due_date", todayStr);

    if (process.env.BREVO_API_KEY) {
      const cutoff = new Date(Date.now() - 3 * 86400000).toISOString(); // já enviada há 3+ dias
      const { data: due } = await admin
        .from("platform_invoices")
        .select("id, amount, description, due_date, payment_link, sent_at, tenants(name, legal_name, contact_email)")
        .eq("status", "overdue")
        .not("sent_at", "is", null)
        .lt("sent_at", cutoff)
        .not("payment_link", "is", null)
        .limit(50);

      const { sendBrevoEmail } = await import("@/lib/brevo");
      for (const inv of (due as any[]) || []) {
        const to = inv.tenants?.contact_email;
        if (!to) continue;
        const nome = inv.tenants?.name || inv.tenants?.legal_name || "cliente";
        const valor = (Number(inv.amount) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        const venc = inv.due_date ? new Date(inv.due_date).toLocaleDateString("pt-BR") : "—";
        const r = await sendBrevoEmail({
          to,
          toName: nome,
          subject: `Lembrete: fatura Contatia em aberto (${valor})`,
          text: `Olá, ${nome}. Sua fatura de ${valor} (venc. ${venc}) segue em aberto.\n\nPague com segurança neste link:\n${inv.payment_link}\n\nAssim que confirmar, sua assinatura é atualizada automaticamente. Qualquer dúvida, é só responder este e-mail.`,
        });
        if (r.ok) {
          await admin.from("platform_invoices").update({ sent_at: new Date().toISOString() }).eq("id", inv.id);
          reminders++;
        }
      }
    }
  } catch {
    /* régua não deve quebrar o cron */
  }

  // reconcilia o valor das assinaturas com o nº de assentos (per-seat) + reversão de cupom
  let seatsSynced = 0;
  try {
    const { reconcileAllSeats } = await import("@/lib/billing");
    const rr = await reconcileAllSeats();
    seatsSynced = rr.synced;
  } catch (e: any) {
    errors.push(`seats: ${e?.message || "erro"}`);
  }

  // régua de ciclo de vida do assinante (boas-vindas, onboarding, reengajamento)
  let lifecycle = 0;
  try {
    const { runLifecycle } = await import("@/lib/lifecycle");
    const lc = await runLifecycle(admin);
    lifecycle = lc.sent;
    if (lc.errors.length) errors.push(...lc.errors);
  } catch (e: any) {
    errors.push(`lifecycle: ${e?.message || "erro"}`);
  }

  // sincronia com CRMs (push de leads quentes; pull de ganhos/perdas)
  let crm = { pushed: 0, failed: 0, pulled: 0 };
  try {
    const { processCrmQueue } = await import("@/lib/crmSync");
    crm = await processCrmQueue(admin);
  } catch (e: any) {
    errors.push(`crm: ${e?.message || "erro"}`);
  }

  // descoberta de e-mail dos leads sem endereço (chama o worker no VPS)
  let discovery = { found: 0, notFound: 0, errors: 0 };
  try {
    const { processEmailDiscovery } = await import("@/lib/emailDiscoverySync");
    discovery = await processEmailDiscovery(admin);
  } catch (e: any) {
    errors.push(`discovery: ${e?.message || "erro"}`);
  }

  return NextResponse.json({ ok: true, accounts: (accounts as any[])?.length || 0, marked, suggestions, autoRan, purged, reminders, seatsSynced, lifecycle, crm, discovery, errors });
}
