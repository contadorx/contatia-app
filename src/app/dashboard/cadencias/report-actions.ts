"use server";

import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data as any)?.tenant_id as string | null };
}

export type StepReport = {
  position: number;
  channel: string;
  subject: string | null;
  subject_b: string | null;
  sent: number;       // tasks concluídas (enviadas) nesse passo
  replied: number;    // respostas atribuíveis a esse passo
  ab?: { a: { sent: number; replied: number }; b: { sent: number; replied: number } } | null;
};

// Monta o relatório por passo: para cada passo da sequência, quantas tasks foram enviadas
// e quantas respostas ocorreram. Se o passo tem A/B de assunto, quebra por variante.
export async function getCadenceReport(sequenceId: string) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { data: steps } = await supabase
    .from("sequence_steps")
    .select("position, channel, subject, subject_b")
    .eq("sequence_id", sequenceId)
    .order("position", { ascending: true });
  if (!steps?.length) return { error: "Sequência sem passos." };

  // enrollments dessa sequência (para saber quem respondeu e em que ponto parou)
  const { data: enrs } = await supabase
    .from("enrollments")
    .select("id, status, current_step")
    .eq("sequence_id", sequenceId);
  const enrollmentIds = ((enrs as any[]) || []).map((e) => e.id);

  // tasks dessa sequência com passo e variante
  let tasks: any[] = [];
  if (enrollmentIds.length) {
    const { data: t } = await supabase
      .from("tasks")
      .select("enrollment_id, step_position, subject_variant, status, channel")
      .in("enrollment_id", enrollmentIds);
    tasks = (t as any[]) || [];
  }

  // respostas: enrollments com status replied. Atribui a resposta ao ÚLTIMO passo enviado
  // daquele enrollment (o toque que provavelmente gerou a resposta).
  const repliedEnrollments = new Set(((enrs as any[]) || []).filter((e) => e.status === "replied").map((e) => e.id));
  const lastSentStepByEnrollment: Record<string, number> = {};
  const lastVariantByEnrollment: Record<string, string | null> = {};
  for (const tk of tasks) {
    if (tk.status !== "done") continue;
    const pos = tk.step_position ?? 0;
    if (lastSentStepByEnrollment[tk.enrollment_id] === undefined || pos > lastSentStepByEnrollment[tk.enrollment_id]) {
      lastSentStepByEnrollment[tk.enrollment_id] = pos;
      lastVariantByEnrollment[tk.enrollment_id] = tk.subject_variant || null;
    }
  }

  const report: StepReport[] = (steps as any[]).map((s) => {
    const pos = s.position;
    const sentTasks = tasks.filter((t) => (t.step_position ?? 0) === pos && t.status === "done");
    // respostas atribuídas a este passo
    let replied = 0;
    const abA = { sent: 0, replied: 0 };
    const abB = { sent: 0, replied: 0 };
    for (const t of sentTasks) {
      if (t.subject_variant === "a") abA.sent++;
      else if (t.subject_variant === "b") abB.sent++;
    }
    for (const eid of repliedEnrollments) {
      if (lastSentStepByEnrollment[eid] === pos) {
        replied++;
        const v = lastVariantByEnrollment[eid];
        if (v === "a") abA.replied++;
        else if (v === "b") abB.replied++;
      }
    }
    const hasAB = !!(s.subject_b && String(s.subject_b).trim());
    return {
      position: pos,
      channel: s.channel,
      subject: s.subject,
      subject_b: s.subject_b,
      sent: sentTasks.length,
      replied,
      ab: hasAB ? { a: abA, b: abB } : null,
    };
  });

  return { ok: true, report };
}
