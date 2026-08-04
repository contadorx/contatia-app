"use server";

import { msgErro } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { headers } from "next/headers";
import { APP_URL } from "@/lib/regua";
import { assuntoConvite, htmlConvite, textoConvite } from "@/lib/emailConvite";
import { dataDoDia } from "@/lib/datas";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id, role, team_role")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return {
    supabase,
    tenant_id: (data?.tenant_id as string) || null,
    role: data?.role as string,
    team_role: (data as any)?.team_role as string | undefined,
    user_id: user?.id,
  };
}

// Quem pode convidar/remover convites: dono OU admin de equipe (capability "team").
function podeConvidar(role?: string, team_role?: string) {
  return role === "owner" || team_role === "admin";
}

export async function assignContact(contactId: string, userId: string | null) {
  const { supabase } = await ctx();
  const { error } = await supabase.from("contacts").update({ assigned_to: userId }).eq("id", contactId);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/equipe");
  return { ok: true };
}

// Distribui os contatos SEM responsável entre os membros ativos (round-robin).
export async function distributeUnassigned() {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Só o owner distribui." };

  const { data: members } = await supabase
    .from("profiles")
    .select("id")
    .eq("tenant_id", tenant_id)
    .eq("is_active", true);
  const ids = ((members as any[]) || []).map((m) => m.id);
  if (!ids.length) return { error: "Sem membros ativos." };

  const { data: unassigned } = await supabase
    .from("contacts")
    .select("id")
    .is("assigned_to", null)
    .limit(1000);
  const list = (unassigned as any[]) || [];
  if (!list.length) return { ok: true, distributed: 0 };

  let i = 0;
  for (const c of list) {
    await supabase.from("contacts").update({ assigned_to: ids[i % ids.length] }).eq("id", c.id);
    i++;
  }
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/equipe");
  return { ok: true, distributed: list.length };
}

// Marca duplicados por e-mail (mantém o mais antigo, marca os demais como 'duplicate').
export async function dedupeByEmail() {
  const { supabase, tenant_id, role } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (role !== "owner") return { error: "Só o owner deduplica." };

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, email, created_at")
    .not("email", "is", null)
    .order("created_at", { ascending: true })
    .limit(5000);

  const seen = new Set<string>();
  const dups: string[] = [];
  for (const c of (contacts as any[]) || []) {
    const key = (c.email || "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) dups.push(c.id);
    else seen.add(key);
  }
  if (dups.length) {
    await supabase.from("contacts").update({ status: "duplicate" }).in("id", dups);
  }
  revalidatePath("/dashboard/contatos");
  return { ok: true, marked: dups.length };
}

// ============================================================
// ENVIO DO E-MAIL DE CONVITE
//
// Este era o buraco: `createInvite` só gravava a linha e devolvia o token — quem tinha
// que avisar a pessoa era o dono, copiando o link na mão. Não havia e-mail, e por isso
// também não havia registro na Central de E-mails. "Não chegou nada" estava certo.
//
// Regra de ouro aqui: FALHAR NO E-MAIL NÃO PODE INVALIDAR O CONVITE. O convite já está
// no banco e o link funciona. Se o Brevo não estiver configurado ou recusar, a ação
// devolve o link com um aviso claro em vez de fingir que deu certo — ou, pior, de
// desfazer um convite que está válido.
// ============================================================
function baseUrl(): string {
  // O host REAL da requisição (o domínio que o dono está usando agora). Melhor que
  // NEXT_PUBLIC_APP_URL, que pode estar vazio, e que VERCEL_URL, que numa preview
  // aponta para um endereço temporário — o convidado clicaria num link que morre.
  try {
    const h = headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "https";
    if (host) return `${proto}://${host}`;
  } catch { /* fora de request: cai no padrão */ }
  return APP_URL;
}

async function enviarEmailDeConvite(input: {
  supabase: any;
  tenant_id: string;
  user_id?: string;
  email: string;
  token: string;
  papel: string;
  expires_at?: string | null;
}): Promise<{ enviado: boolean; aviso?: string }> {
  const link = `${baseUrl()}/convite/${input.token}`;
  try {
    const [{ data: tenant }, { data: quem }] = await Promise.all([
      input.supabase.from("tenants").select("name").eq("id", input.tenant_id).maybeSingle(),
      input.user_id
        ? input.supabase.from("profiles").select("full_name, email").eq("id", input.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const validade = input.expires_at
      ? dataDoDia(input.expires_at)
      : null;
    const convidadoPor = ((quem as any)?.full_name || (quem as any)?.email || "").trim() || null;
    const workspace = ((tenant as any)?.name || "").trim() || null;
    const assunto = assuntoConvite(workspace);

    const html = htmlConvite({ link, para: input.email, workspace, convidadoPor, papel: input.papel, validade });
    const text = textoConvite({ link, workspace, convidadoPor, papel: input.papel, validade });

    // CAMINHO 1 — Brevo (transacional, remetente do Contatia).
    const { sendBrevoEmail } = await import("@/lib/brevo");
    let r = await sendBrevoEmail({
      to: input.email,
      subject: assunto,
      html,
      text,
      // responder ao convite vai para quem convidou, não para o suporte
      replyTo: (quem as any)?.email || undefined,
    });

    // CAMINHO 2 — a caixa do próprio workspace, se o Brevo não estiver configurado ou
    // recusar. Sem este fallback, quem nunca pôs BREVO_API_KEY continuaria sem receber
    // convite nenhum — que é exatamente o sintoma que estamos corrigindo.
    // Não mexemos no contador diário da caixa: isto é e-mail de sistema, não cadência;
    // debitar do aquecimento penalizaria a prospecção por causa de um convite.
    if (!r.ok) {
      const erroBrevo = r.error;
      try {
        const { data: caixa } = await input.supabase
          .from("email_accounts")
          .select("provider, from_email, display_name, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, oauth_refresh_token")
          .eq("tenant_id", input.tenant_id)
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (caixa) {
          const { sendEmail } = await import("@/lib/mailer");
          await sendEmail(caixa as any, { to: input.email, subject: assunto, text, html });
          r = { ok: true };
        } else {
          r = { error: `${erroBrevo} — e não há caixa de e-mail ativa em Configurações para usar no lugar.` };
        }
      } catch (e2: any) {
        r = { error: `${erroBrevo} — a caixa do workspace também falhou: ${e2?.message || "erro"}.` };
      }
    }

    // O log é best-effort e usa a service role: a Central de E-mails tem que mostrar
    // tanto o envio quanto a FALHA — foi a ausência de registro que escondeu o problema.
    try {
      const { logEmail } = await import("@/lib/regua");
      await logEmail(createAdminClient(), {
        tenant_id: input.tenant_id,
        to: input.email,
        subject: assunto,
        kind: "convite",
        status: r.ok ? "sent" : "error",
        error: r.error ?? null,
      });
    } catch { /* nunca derruba o convite */ }

    if (r.ok) return { enviado: true };
    return {
      enviado: false,
      aviso: `O convite foi criado, mas o e-mail não saiu (${r.error}). Copie o link e mande por WhatsApp.`,
    };
  } catch (e: any) {
    return {
      enviado: false,
      aviso: `O convite foi criado, mas o e-mail não saiu (${e?.message || "falha de conexão"}). Copie o link e mande por WhatsApp.`,
    };
  }
}

// Gera um convite (owner), JÁ ENVIANDO o e-mail para a pessoa.
// Devolve o token de qualquer jeito — o link é a rede de segurança quando o e-mail falha.
export async function createInvite(email: string, teamRole?: string) {
  const { supabase, tenant_id, role, team_role, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!podeConvidar(role, team_role)) return { error: "Apenas dono ou admin podem convidar." };
  if (!email.trim() || !email.includes("@")) return { error: "E-mail inválido." };
  const papel = ["admin", "gestor", "sdr", "vendedor"].includes(teamRole || "") ? (teamRole as string) : "vendedor";

  // O plano tem teto de usuários? Se encheu, indicamos o plano certo em vez de
  // bloquear em silêncio.
  const { data: sc } = await supabase.rpc("seat_check");
  const seat = Array.isArray(sc) ? sc[0] : sc;
  if (seat && !(seat as any).pode_adicionar) {
    const s = seat as any;
    return {
      error: `Seu plano ${s.plano_atual} comporta ${s.teto} usuários e você já tem ${s.usuarios_atuais}. Para adicionar mais gente, mude para o plano ${s.plano_sugerido} em Planos.`,
    };
  }

  const destino = email.trim().toLowerCase();
  const { data, error } = await supabase
    .from("tenant_invites")
    .insert({ tenant_id, email: destino, role: "partner", team_role: papel, created_by: user_id })
    .select("token, expires_at")
    .single();
  if (error) return { error: msgErro(error) };

  const env = await enviarEmailDeConvite({
    supabase, tenant_id, user_id, email: destino,
    token: (data as any).token, papel, expires_at: (data as any).expires_at,
  });

  revalidatePath("/dashboard/equipe");
  return { ok: true, token: (data as any).token as string, enviado: env.enviado, aviso: env.aviso };
}

// Reenviar o e-mail de um convite que já existe (a pessoa apagou, caiu no spam, etc).
// Não gera token novo: o link antigo continua valendo, e trocá-lo invalidaria o que já
// foi mandado.
export async function reenviarConvite(id: string) {
  const { supabase, tenant_id, role, team_role, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!podeConvidar(role, team_role)) return { error: "Apenas dono ou admin podem convidar." };

  const { data, error } = await supabase
    .from("tenant_invites")
    .select("email, token, team_role, expires_at, accepted_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: msgErro(error) };
  if (!data) return { error: "Convite não encontrado." };
  if ((data as any).accepted_at) return { error: "Este convite já foi aceito." };
  if ((data as any).expires_at && new Date((data as any).expires_at) < new Date()) {
    return { error: "Este convite expirou. Remova e gere um novo." };
  }

  const env = await enviarEmailDeConvite({
    supabase, tenant_id, user_id,
    email: (data as any).email,
    token: (data as any).token,
    papel: (data as any).team_role || "vendedor",
    expires_at: (data as any).expires_at,
  });
  if (!env.enviado) return { error: env.aviso || "Não consegui enviar o e-mail." };
  return { ok: true, email: (data as any).email as string };
}

export async function revokeInvite(id: string) {
  const { supabase, role, team_role } = await ctx();
  if (!podeConvidar(role, team_role)) return { error: "Apenas dono ou admin removem convites." };
  const { error } = await supabase.from("tenant_invites").delete().eq("id", id);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/equipe");
  return { ok: true };
}

// Define o nível de equipe de um membro. Só owner/admin/gestor podem alterar.
// team_role é coluna PROTEGIDA (migration 0068) — o cliente do navegador não a grava;
// por isso a escrita passa pelo admin client (service_role), com checagem explícita de
// permissão do chamador E de que o alvo pertence ao MESMO workspace.
export async function setTeamRole(memberId: string, teamRole: string) {
  const { supabase, tenant_id, role, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { data: me } = await supabase.from("profiles").select("team_role").eq("id", user_id ?? "").maybeSingle();
  const canManage = role === "owner" || ["admin", "gestor"].includes((me as any)?.team_role);
  if (!canManage) return { error: "Só gestores/admin podem alterar níveis de equipe." };
  if (!["admin", "gestor", "sdr", "vendedor"].includes(teamRole)) return { error: "Nível inválido." };

  const admin = createAdminClient();
  if (!admin) return { error: "Configuração indisponível (service role). Fale com o suporte." };

  // o alvo precisa ser do MESMO tenant (o admin ignora RLS, então validamos na mão)
  const { data: target } = await admin.from("profiles").select("tenant_id").eq("id", memberId).maybeSingle();
  if (!target || (target as any).tenant_id !== tenant_id) {
    return { error: "Membro não encontrado no seu workspace." };
  }

  const { error } = await admin.from("profiles").update({ team_role: teamRole }).eq("id", memberId);
  if (error) return { error: msgErro(error) };

  // deixou de ser SDR? as liberações de agenda dele perdem sentido — limpa
  // (hygiene que o antigo setRole fazia; agora vive aqui, no editor canônico)
  if (teamRole !== "sdr") {
    await admin.from("calendar_permissions").delete().eq("sdr_id", memberId);
  }

  revalidatePath("/dashboard/equipe");
  revalidatePath("/dashboard/reunioes");
  return { ok: true };
}
