"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function withUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user_id: user?.id };
}

export async function completeTask(id: string) {
  const { supabase } = await withUser();
  const { error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function skipTask(id: string) {
  const { supabase } = await withUser();
  const { error } = await supabase.from("tasks").update({ status: "skipped" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function snoozeTask(id: string, days: number) {
  const { supabase } = await withUser();
  const d = new Date();
  d.setDate(d.getDate() + (days || 1));
  const { error } = await supabase
    .from("tasks")
    .update({ due_date: d.toISOString().slice(0, 10) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---- Envio de e-mail real (SMTP/Gmail) a partir de uma tarefa da fila ----
export async function sendEmailTask(taskId: string) {
  const { sendEmail } = await import("@/lib/mailer");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const tenant_id = profile?.tenant_id as string | undefined;
  if (!tenant_id) return { error: "Sem workspace." };

  // tarefa + contato
  const { data: task } = await supabase
    .from("tasks")
    .select("id, channel, title, generated_content, contacts(email, name)")
    .eq("id", taskId)
    .single();
  if (!task) return { error: "Tarefa não encontrada." };
  if (task.channel !== "email") return { error: "Tarefa não é de e-mail." };
  const to = (task as any).contacts?.email as string | undefined;
  if (!to) return { error: "Contato sem e-mail." };

  // caixa ativa (com segredos — só no servidor)
  const { data: acct } = await supabase
    .from("email_accounts")
    .select("id, provider, from_email, display_name, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, oauth_refresh_token, daily_cap")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!acct) return { error: "Nenhuma caixa de e-mail conectada. Configure em Config." };

  // cap diário (Envio Seguro): conta e-mails já enviados hoje por esta caixa
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("type", "email_sent")
    .eq("email_account_id", (acct as any).id)
    .gte("created_at", startOfDay.toISOString());
  if ((count ?? 0) >= ((acct as any).daily_cap ?? 40)) {
    return { error: "Limite diário desta caixa atingido (Envio Seguro). Tente amanhã ou conecte outra caixa." };
  }

  try {
    await sendEmail(acct as any, {
      to,
      subject: task.title || "",
      text: task.generated_content || "",
    });
  } catch (e: any) {
    return { error: "Falha no envio: " + (e?.message || "erro desconhecido") };
  }

  // marca feita + registra evento (alimenta cap e, no futuro, o score)
  await supabase.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", taskId);
  await supabase.from("events").insert({
    tenant_id,
    type: "email_sent",
    email_account_id: (acct as any).id,
    meta: { to },
  });
  revalidatePath("/dashboard");
  return { ok: true };
}
