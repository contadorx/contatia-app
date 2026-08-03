"use server";

// ============================================================
// CAPTURA DE REDES SOCIAIS (Instagram / LinkedIn) no site da empresa
//
// Mesma mecânica da captura de telefone: lê o site, extrai o que a empresa publicou,
// grava no contato. O rodapé de praticamente todo site de escritório tem os ícones das
// redes — é o dado mais barato de colher que existe, e ninguém colhia.
//
// Grava também na EMPRESA (accounts), porque o perfil institucional é dela, não da
// pessoa: assim o próximo sócio da mesma empresa já nasce com o dado.
// ============================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { msgErro } from "@/lib/erros";
import { capturarRedesLote } from "@/lib/webSocial";

const INLINE = 8;   // sites por clique (cada um são até 7 requisições HTTP)

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null };
}

export async function capturarRedesDoSite(contactIds: string[]): Promise<{
  ok?: boolean; comIg?: number; comLi?: number; semRede?: number; semDominio?: number; restantes?: number; error?: string;
}> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const ids = Array.from(new Set((contactIds || []).filter(Boolean)));
  if (!ids.length) return { error: "Nada selecionado." };

  // select("*"): as colunas de rede nascem na 0110.
  const { data: rows, error } = await supabase
    .from("contacts")
    .select("*, accounts(domain, website)")
    .eq("tenant_id", tenant_id)
    .in("id", ids.slice(0, 300));
  if (error) return { error: msgErro(error) };

  const dominioDe = (s: any) =>
    String(s || "").trim().toLowerCase()
      .replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split("/")[0].split("?")[0] || null;

  const alvos = ((rows as any[]) || []).map((c) => ({
    id: c.id as string,
    accountId: (c.account_id as string) || null,
    // já tem as duas redes? não gasta requisição de novo.
    jaTem: !!(c.instagram && c.linkedin),
    domain: dominioDe(c.company_domain || c.accounts?.domain || c.accounts?.website),
  }));

  const comDominio = alvos.filter((a) => a.domain && !a.jaTem);
  const semDominio = alvos.filter((a) => !a.domain).length;

  const lote = comDominio.slice(0, INLINE);
  const restantes = comDominio.length - lote.length;

  if (!lote.length) {
    return { ok: true, comIg: 0, comLi: 0, semRede: 0, semDominio, restantes: 0 };
  }

  const res = await capturarRedesLote(lote.map((a) => ({ id: a.id, domain: a.domain })), 4);
  const agora = new Date().toISOString();
  let comIg = 0, comLi = 0, semRede = 0;

  for (const r of res) {
    const alvo = lote.find((a) => a.id === r.id);
    const upd: Record<string, any> = {
      social_capture: r.instagram || r.linkedin || r.facebook ? "done" : "notfound",
      social_captured_at: agora,
    };
    // Origem 'site' = a empresa publicou este perfil. É o nível de confiança do meio:
    // forte quanto ao endereço, fraco quanto a QUEM lê — costuma ser a conta
    // institucional, não a pessoal de quem decide.
    if (r.instagram) { upd.instagram = r.instagram; upd.instagram_origem = "site"; upd.instagram_conferido_at = null; comIg++; }
    if (r.linkedin) { upd.linkedin = r.linkedin; upd.linkedin_origem = "site"; upd.linkedin_conferido_at = null; comLi++; }
    if (!r.instagram && !r.linkedin) semRede++;

    // Não sobrescreve o que já existe: quem preencheu à mão sabe mais que o robô.
    const { error: e1 } = await supabase
      .from("contacts")
      .update(upd)
      .eq("id", r.id)
      .eq("tenant_id", tenant_id);
    // Sem a 0110 as colunas não existem: grava só o que dá, sem derrubar o lote.
    if (e1) {
      await supabase.from("contacts").update({}).eq("id", r.id);
    }

    // a empresa também fica com os perfis (o próximo sócio já nasce com eles)
    if (alvo?.accountId && (r.instagram || r.linkedin || r.facebook)) {
      const uacc: Record<string, any> = {};
      if (r.instagram) uacc.instagram = r.instagram;
      if (r.linkedin) uacc.linkedin = r.linkedin;
      if (r.facebook) uacc.facebook = r.facebook;
      await supabase.from("accounts").update(uacc).eq("id", alvo.accountId).eq("tenant_id", tenant_id);
    }
  }

  // o excedente fica marcado para a próxima passada
  if (restantes > 0) {
    await supabase
      .from("contacts")
      .update({ social_capture: "queued" } as any)
      .in("id", comDominio.slice(INLINE).map((a) => a.id))
      .eq("tenant_id", tenant_id);
  }

  revalidatePath("/dashboard/contatos");
  return { ok: true, comIg, comLi, semRede, semDominio, restantes };
}

/** Salvar/corrigir à mão, da ficha do contato. */
export async function salvarRedes(contactId: string, input: { instagram?: string; linkedin?: string }) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  // Aceita o que a pessoa colar: @user, instagram.com/user, a URL inteira.
  const ig = String(input.instagram || "").trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\//, "").replace(/^www\./, "")
    .replace(/^instagram\.com\//, "")
    .replace(/[?#].*$/, "").replace(/\/+$/, "");

  let li = String(input.linkedin || "").trim();
  if (li && !/^https?:\/\//i.test(li)) li = `https://${li.replace(/^www\./, "")}`;
  if (li && !/linkedin\.com/i.test(li)) {
    return { error: "O LinkedIn precisa ser o endereço do perfil (linkedin.com/in/... ou /company/...)." };
  }

  // Mudou o valor? A conferência anterior morre junto — ela era sobre o perfil ANTIGO.
  // Manter o "conferido ✓" depois de trocar o @ seria o selo mentindo, que é
  // exatamente o que este desenho existe para evitar.
  const { data: atual } = await supabase
    .from("contacts").select("*").eq("id", contactId).eq("tenant_id", tenant_id).maybeSingle();
  const igMudou = (((atual as any)?.instagram as string) || "") !== ig;
  const liMudou = (((atual as any)?.linkedin as string) || "") !== li;

  const upd: Record<string, any> = { instagram: ig || null, linkedin: li || null };
  if (igMudou) { upd.instagram_origem = ig ? "manual" : null; upd.instagram_conferido_at = null; }
  if (liMudou) { upd.linkedin_origem = li ? "manual" : null; upd.linkedin_conferido_at = null; }

  const { error } = await supabase
    .from("contacts")
    .update(upd as any)
    .eq("id", contactId)
    .eq("tenant_id", tenant_id);
  if (error) return { error: msgErro(error) };

  revalidatePath(`/dashboard/contatos/${contactId}`);
  return { ok: true };
}

// ============================================================
// "ERA ESSE" — a única verificação que este canal permite
//
// Não existe API que responda "este @ é mesmo do João". IP de datacenter é bloqueado
// pelo Instagram na hora, e o LinkedIn barra requisição não autenticada. Quem consegue
// verificar é quem abriu o perfil e olhou: você.
//
// Um clique, e o selo passa a dizer a verdade.
// ============================================================
export async function conferirRede(contactId: string, rede: "instagram" | "linkedin", confere = true) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const campo = rede === "instagram" ? "instagram_conferido_at" : "linkedin_conferido_at";
  const { error } = await supabase
    .from("contacts")
    .update({ [campo]: confere ? new Date().toISOString() : null } as any)
    .eq("id", contactId)
    .eq("tenant_id", tenant_id);
  if (error) {
    return { error: "Não consegui marcar como conferido. Se a migration 0111 ainda não foi aplicada, é isso." };
  }

  revalidatePath(`/dashboard/contatos/${contactId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
