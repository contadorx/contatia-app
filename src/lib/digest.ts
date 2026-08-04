import "server-only";
import { HOT_THRESHOLD } from "@/lib/scoring";
import { diaISO } from "@/lib/datas";

// ============================================================
// RESUMO DIÁRIO — retenção. Puxa o usuário de volta em vez de esperar que ele
// lembre de abrir o app. Uma vez por dia, por workspace: "você tem N toques na
// fila hoje". Só envia quando há toques. Respeita o opt-out (lifecycle_enabled)
// e usa o mesmo remetente da plataforma (Brevo) da régua de comunicação.
// Idempotente: registra o envio em lifecycle_sends com o estágio datado.
// ============================================================
export async function runDailyDigest(admin: any): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;
  const today = diaISO();
  const stage = `digest_${today}`;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")).replace(/\/$/, "");

  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name, contact_email")
    .eq("lifecycle_enabled", true);
  if (!tenants?.length) return { sent, errors };

  const { sendBrevoEmail } = await import("@/lib/brevo");

  for (const t of tenants as any[]) {
    try {
      // já mandou hoje? (idempotência)
      const { data: ja } = await admin.from("lifecycle_sends").select("stage").eq("tenant_id", t.id).eq("stage", stage).maybeSingle();
      if (ja) continue;

      // toques pendentes para hoje (e atrasados)
      const { count: pend } = await admin
        .from("tasks").select("id", { count: "exact", head: true })
        .eq("tenant_id", t.id).eq("status", "pending").lte("due_date", today);
      if (!pend) continue; // nada pra puxar → não envia (e não marca; reavalia amanhã)

      const { count: hot } = await admin
        .from("contacts").select("id", { count: "exact", head: true })
        .eq("tenant_id", t.id).gte("score", HOT_THRESHOLD);

      let to = (t.contact_email || "").trim();
      if (!to) {
        const { data: owner } = await admin.from("profiles").select("email").eq("tenant_id", t.id).eq("role", "owner").limit(1).maybeSingle();
        to = (owner as any)?.email || "";
      }
      if (!to) continue;

      const plural = (pend as number) === 1 ? "toque" : "toques";
      const subject = `Você tem ${pend} ${plural} na fila hoje`;
      const linhas = [
        `Sua fila do Contatia tem ${pend} ${plural} esperando hoje.`,
        (hot ?? 0) > 0 ? `${hot} ${(hot as number) === 1 ? "contato está quente" : "contatos estão quentes"} — comece por eles.` : "",
        "",
        appUrl ? `Abra a fila "Hoje": ${appUrl}/dashboard` : `Abra o Contatia e vá em "Hoje".`,
        "",
        "Para não receber mais este resumo, desative a régua de comunicação nas configurações do workspace.",
      ];
      const text = linhas.join("\n");

      const r = await sendBrevoEmail({ to, toName: t.name || undefined, subject, text });
      if (r?.error) { errors.push(`${t.id}: ${r.error}`); continue; }

      await admin.from("lifecycle_sends").insert({ tenant_id: t.id, stage });
      sent++;
    } catch (e: any) {
      errors.push(`${t.id}: ${e?.message || "erro"}`);
    }
  }
  return { sent, errors };
}
