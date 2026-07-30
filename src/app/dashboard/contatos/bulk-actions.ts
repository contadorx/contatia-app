"use server";

import { msgErro } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enrollContact } from "@/app/dashboard/cadencias/actions";
import { logAction } from "@/lib/actionLog";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

export async function bulkAssign(contactIds: string[], userId: string | null) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!contactIds.length) return { error: "Nenhum contato selecionado." };
  const { error } = await supabase.from("contacts").update({ assigned_to: userId }).in("id", contactIds);
  if (error) return { error: msgErro(error) };
  let nomeDono = "sem dono";
  if (userId) {
    const { data: p } = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
    nomeDono = (p?.full_name as string) || (p?.email as string) || "outro membro";
  }
  await logAction(supabase, {
    tenant_id,
    user_id,
    action: "contact_assign_bulk",
    entity: "contact",
    qtd: contactIds.length,
    detail: `Atribuiu ${contactIds.length} contato(s) a ${nomeDono}.`,
  });
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/equipe");
  return { ok: true, count: contactIds.length };
}

export async function bulkEnroll(contactIds: string[], sequenceId: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!contactIds.length) return { error: "Nenhum contato selecionado." };
  if (!sequenceId) return { error: "Escolha a cadência." };

  const ids = contactIds.slice(0, 500); // trava de segurança
  let enrolled = 0;
  let semDado = 0;      // sem e-mail nem telefone para os passos da cadência
  let jaInscrito = 0;   // já estava ativo/pausado nesta cadência
  let outros = 0;       // suprimido, erro etc.
  for (const id of ids) {
    const res = (await enrollContact(id, sequenceId)) as { ok?: boolean; error?: string; missingData?: boolean; already?: boolean };
    if (res?.ok) enrolled++;
    else if (res?.missingData) semDado++;
    else if (res?.already) jaInscrito++;
    else outros++;
  }
  const { data: seq } = await supabase.from("sequences").select("name").eq("id", sequenceId).maybeSingle();
  await logAction(supabase, {
    tenant_id,
    user_id,
    action: "contact_enroll_bulk",
    entity: "contact",
    entity_id: sequenceId,
    qtd: enrolled,
    detail:
      `Inscreveu ${enrolled} de ${ids.length} contato(s) na cadência "${(seq?.name as string) || "?"}"` +
      (semDado || jaInscrito || outros
        ? ` (${[semDado ? `${semDado} sem e-mail/telefone` : "", jaInscrito ? `${jaInscrito} já inscritos` : "", outros ? `${outros} recusados` : ""]
            .filter(Boolean)
            .join(", ")})`
        : "") +
      ".",
    meta: { cadencia: seq?.name || null, enrolled, semDado, jaInscrito, outros, selecionados: ids.length },
  });
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard");
  return { ok: true, enrolled, semDado, jaInscrito, outros };
}
