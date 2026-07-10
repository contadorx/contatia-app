import "server-only";

// Régua de ciclo de vida do ASSINANTE (cliente do Contatia). Roda no cron diário.
// E-mails da plataforma para ativar e reter o cliente. Cada estágio é enviado uma única vez.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://app.contatia.com.br");

type Stage = "welcome" | "onboard_email" | "onboard_cadence" | "reengage";

function templates(name: string): Record<Stage, { subject: string; text: string }> {
  const first = (name || "").split(" ")[0] || "";
  const hi = first ? `Olá, ${first}!` : "Olá!";
  return {
    welcome: {
      subject: "Bem-vindo à Contatia 🚀",
      text: `${hi}\n\nQue bom ter você na Contatia. Ela foi feita para uma coisa: transformar prospecção em reunião, com cadência e método — sem virar uma planilha caótica.\n\nPrimeiro passo (2 minutos): conecte sua caixa de e-mail para começar a disparar cadências.\n${APP_URL}/dashboard/config\n\nQualquer dúvida, é só responder este e-mail ou clicar no botão de ajuda (?) dentro do sistema.\n\nEquipe Contatia`,
    },
    onboard_email: {
      subject: "Falta 1 passo para você começar a prospectar",
      text: `${hi}\n\nVi que você ainda não conectou uma caixa de e-mail. É por ali que a Contatia dispara suas cadências — e leva só 2 minutos.\n\nConectar agora:\n${APP_URL}/dashboard/config\n\nDica: ao conectar, a Contatia já ativa o "Envio Seguro" (aquecimento automático) para proteger a reputação do seu domínio desde o primeiro dia.\n\nEquipe Contatia`,
    },
    onboard_cadence: {
      subject: "Sua caixa está pronta. Que tal a primeira cadência?",
      text: `${hi}\n\nCaixa conectada, ótimo! Agora o coração da Contatia: crie sua primeira cadência (a sequência de toques que transforma um contato frio em reunião).\n\nCriar cadência:\n${APP_URL}/dashboard/cadencias\n\nComece simples: e-mail no dia 0, um follow-up no dia 3, um toque de WhatsApp no dia 6. O método importa mais que o volume.\n\nEquipe Contatia`,
    },
    reengage: {
      subject: "Podemos ajudar a destravar sua prospecção?",
      text: `${hi}\n\nNotamos que faz um tempo desde sua última atividade na Contatia. Prospecção trava por muitos motivos — e a gente quer ajudar a destravar.\n\nSe faltou tempo para configurar, responda este e-mail dizendo onde você parou. Se foi alguma dúvida, o botão de ajuda (?) dentro do sistema tem respostas rápidas.\n\nSeu pipeline está esperando:\n${APP_URL}/dashboard\n\nEquipe Contatia`,
    },
  };
}

export async function runLifecycle(admin: any): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;

  // tenants com régua ligada
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name, contact_email, created_at, lifecycle_enabled")
    .eq("lifecycle_enabled", true);
  if (!tenants?.length) return { sent, errors };

  const { sendBrevoEmail } = await import("@/lib/brevo");
  const now = Date.now();

  for (const t of tenants as any[]) {
    try {
      // destinatário: contact_email do tenant, senão e-mail do owner
      let to = (t.contact_email || "").trim();
      if (!to) {
        const { data: owner } = await admin.from("profiles").select("email").eq("tenant_id", t.id).eq("role", "owner").limit(1).maybeSingle();
        to = (owner as any)?.email || "";
      }
      if (!to) continue;

      // estágios já enviados
      const { data: sends } = await admin.from("lifecycle_sends").select("stage").eq("tenant_id", t.id);
      const done = new Set(((sends as any[]) || []).map((s) => s.stage));

      const ageDays = Math.floor((now - new Date(t.created_at).getTime()) / 86400000);

      // sinais de ativação
      const { count: mailboxes } = await admin.from("email_accounts").select("id", { count: "exact", head: true }).eq("tenant_id", t.id);
      const { count: cadences } = await admin.from("sequences").select("id", { count: "exact", head: true }).eq("tenant_id", t.id);

      // decide o próximo estágio a enviar (um por execução, na ordem de prioridade)
      let stage: Stage | null = null;
      if (!done.has("welcome")) stage = "welcome";
      else if (!done.has("onboard_email") && ageDays >= 1 && (mailboxes ?? 0) === 0) stage = "onboard_email";
      else if (!done.has("onboard_cadence") && ageDays >= 3 && (mailboxes ?? 0) > 0 && (cadences ?? 0) === 0) stage = "onboard_cadence";
      else if (!done.has("reengage") && ageDays >= 14) {
        // reengaja só se estiver realmente parado: sem cadências e sem contatos recentes
        const { count: contacts } = await admin.from("contacts").select("id", { count: "exact", head: true }).eq("tenant_id", t.id);
        if ((cadences ?? 0) === 0 && (contacts ?? 0) === 0) stage = "reengage";
      }
      if (!stage) continue;

      const tpl = templates(t.name)[stage];
      const r = await sendBrevoEmail({ to, toName: t.name || undefined, subject: tpl.subject, text: tpl.text });
      if (r?.error) { errors.push(`${t.id}/${stage}: ${r.error}`); continue; }

      await admin.from("lifecycle_sends").insert({ tenant_id: t.id, stage });
      sent++;
    } catch (e: any) {
      errors.push(`${t.id}: ${e?.message || "erro"}`);
    }
  }

  return { sent, errors };
}
