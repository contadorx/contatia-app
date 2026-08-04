import "server-only";

// Régua de ciclo de vida do ASSINANTE. Roda no cron diário. Os TEXTOS agora vêm
// de business_messages (track 'comunicacao'), editáveis no painel — a LÓGICA de
// quando disparar cada estágio continua aqui. Cada estágio é enviado uma vez.

import { renderTemplate, logEmail, jaEnviado } from "@/lib/regua";

type Stage = "welcome" | "onboard_email" | "onboard_cadence" | "reengage";
const KEY: Record<Stage, string> = {
  welcome: "life_welcome",
  onboard_email: "life_onboard_email",
  onboard_cadence: "life_onboard_cadence",
  reengage: "life_reengage",
};

export async function runLifecycle(admin: any): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;

  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name, contact_email, created_at, lifecycle_enabled")
    .eq("lifecycle_enabled", true);
  if (!tenants?.length) return { sent, errors };

  // textos editáveis da régua de comunicação
  const { data: msgs } = await admin.from("business_messages").select("key, enabled, subject, body").eq("track", "comunicacao");
  const byKey: Record<string, any> = {};
  for (const m of (msgs as any[]) || []) byKey[m.key] = m;

  const { sendBrevoEmail } = await import("@/lib/brevo");
  const now = Date.now();

  for (const t of tenants as any[]) {
    try {
      let to = (t.contact_email || "").trim();
      if (!to) {
        const { data: owner } = await admin.from("profiles").select("email").eq("tenant_id", t.id).eq("role", "owner").limit(1).maybeSingle();
        to = (owner as any)?.email || "";
      }
      if (!to) continue;

      const { data: sends } = await admin.from("lifecycle_sends").select("stage").eq("tenant_id", t.id);
      const done = new Set(((sends as any[]) || []).map((s) => s.stage));
      const ageDays = Math.floor((now - new Date(t.created_at).getTime()) / 86400000);

      const { count: mailboxes } = await admin.from("email_accounts").select("id", { count: "exact", head: true }).eq("tenant_id", t.id);
      const { count: cadences } = await admin.from("sequences").select("id", { count: "exact", head: true }).eq("tenant_id", t.id);

      let stage: Stage | null = null;
      if (!done.has("welcome")) stage = "welcome";
      else if (!done.has("onboard_email") && ageDays >= 1 && (mailboxes ?? 0) === 0) stage = "onboard_email";
      else if (!done.has("onboard_cadence") && ageDays >= 3 && (mailboxes ?? 0) > 0 && (cadences ?? 0) === 0) stage = "onboard_cadence";
      else if (!done.has("reengage") && ageDays >= 14) {
        const { count: contacts } = await admin.from("contacts").select("id", { count: "exact", head: true }).eq("tenant_id", t.id);
        if ((cadences ?? 0) === 0 && (contacts ?? 0) === 0) stage = "reengage";
      }
      if (!stage) continue;

      const tpl = byKey[KEY[stage]];
      if (!tpl || tpl.enabled === false) continue; // estágio desligado no painel

      const subject = renderTemplate(tpl.subject, { name: t.name });
      const text = renderTemplate(tpl.body, { name: t.name });

      // ============================================================
      // RESERVAR ANTES DE ENVIAR — E CONFERIR A RESERVA
      //
      // A ordem antiga era: envia → grava que enviou. E a gravação não era conferida.
      // Enquanto ela dava certo, funcionava. No dia em que falhou (e falhou), o
      // estágio nunca ficava marcado e o e-mail saía OUTRA VEZ a cada rodada do cron —
      // 288 vezes por dia depois que o cron passou a rodar de 5 em 5 minutos.
      //
      // Agora a reserva vem primeiro. Se ela não entra, NÃO envio: o único jeito de
      // garantir "uma vez só" é decidir isso ANTES, no banco, que é quem sabe dizer
      // se já aconteceu. A tabela tem unique (tenant_id, stage) — duas rodadas
      // simultâneas não conseguem reservar o mesmo estágio.
      // ============================================================
      const { error: eReserva } = await admin.from("lifecycle_sends").insert({ tenant_id: t.id, stage });
      if (eReserva) {
        // 23505 = já reservado por outra rodada: normal, é o disjuntor funcionando.
        if ((eReserva as any).code !== "23505") {
          errors.push(`${t.id}/${stage}: nao consegui reservar (${(eReserva as any).message || "erro"}) — nao enviei`);
        }
        continue;
      }

      // Segunda trava, independente da primeira: mesmo assunto, mesmo destinatário,
      // nas últimas 20h, não repete — não importa qual controle tenha falhado.
      if (await jaEnviado(admin, { to, subject })) continue;

      const r = await sendBrevoEmail({ to, toName: t.name || undefined, subject, text });
      if (r?.error) {
        // ============================================================
        // FALHOU? NÃO TENTA DE NOVO. MANDOU (OU TENTOU), ACABOU.
        //
        // A versão de horas atrás devolvia a reserva aqui, para "tentar amanhã". Isso
        // parecia cuidadoso e era o mesmo erro de sempre, só que mais lento: quando o
        // envio na verdade ACONTECE e só o retorno é que falha — foi exatamente o caso
        // do Brevo devolvendo corpo ilegível — devolver a reserva reabre o ciclo de
        // reenvio. Uma vez por dia em vez de a cada 5 minutos, mas para sempre.
        //
        // Um aviso de ciclo de vida é de uma vez só por definição. Entre "pode não
        // chegar" e "pode chegar dez vezes", o certo é o primeiro: a falha fica
        // registrada na Central de E-mails e na resposta do cron, e reenviar é decisão
        // de gente, não do relógio.
        // ============================================================
        errors.push(`${t.id}/${stage}: ${r.error} — NAO reenvio automaticamente; reenvie pelo painel se precisar`);
        await logEmail(admin, { tenant_id: t.id, to, subject, kind: "comunicacao", status: "error", error: r.error });
        continue;
      }

      await logEmail(admin, { tenant_id: t.id, to, subject, kind: "comunicacao", status: "sent" });
      sent++;
    } catch (e: any) {
      errors.push(`${t.id}: ${e?.message || "erro"}`);
    }
  }

  return { sent, errors };
}
