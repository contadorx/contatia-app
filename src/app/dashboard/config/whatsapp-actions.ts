"use server";

import { msgErro } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { platformEvolution } from "@/lib/whatsapp";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

// ============================================================
// O cliente escolhe o NÍVEL do canal WhatsApp:
//   'assistido' → link wa.me (zero risco). Não precisa de nada.
//   'hibrido'   → primeiro toque na MÃO (link), mas com a sessão vinculada para
//                 receber, verificar número e responder conversa aberta. Exige o mesmo
//                 aceite: quem carrega o risco é a SESSÃO, não o envio.
//   'evolution' → API não-oficial ponta a ponta (com risco). Exige ACEITE registrado.
// A API oficial da Meta é roadmap (não selecionável aqui ainda).
// ============================================================
export async function setWhatsAppMode(mode: "assistido" | "hibrido" | "evolution", ackRisk?: boolean) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  if (mode === "assistido") {
    const { error } = await supabase.from("tenants").update({ whatsapp_mode: "assistido" }).eq("id", tenant_id);
    if (error) return { error: msgErro(error) };
    revalidatePath("/dashboard/config");
    revalidatePath("/dashboard");
    return { ok: true };
  }

  // sessão vinculada (híbrido ou Evolution): aceite de risco, uma vez por workspace
  const { data: t } = await supabase.from("tenants").select("whatsapp_risk_ack_at").eq("id", tenant_id).maybeSingle();
  const jaAceitou = !!(t as any)?.whatsapp_risk_ack_at;
  if (!jaAceitou && !ackRisk) return { needsAck: true };

  const patch: Record<string, unknown> = { whatsapp_mode: mode };
  if (!jaAceitou && ackRisk) {
    patch.whatsapp_risk_ack_at = new Date().toISOString();
    patch.whatsapp_risk_ack_by = user_id ?? null;
  }
  const { error } = await supabase.from("tenants").update(patch).eq("id", tenant_id);
  if (error) return { error: msgErro(error) };

  // registra o aceite na trilha de auditoria (events)
  if (!jaAceitou && ackRisk) {
    await supabase.from("events").insert({
      tenant_id,
      type: "note",
      meta: { text: "Aceite de risco do WhatsApp não-oficial (Evolution/Baileys) registrado." },
    } as any);
  }

  // Modelo PLATAFORMA: se temos servidor Evolution gerenciado e o cliente ainda
  // não tem instância, criamos uma para ele — ele só precisará escanear o QR.
  const plat = platformEvolution();
  if (plat) {
    // Conta só as instâncias DO WORKSPACE (sem dono). Contar todas faria com que, num
    // time onde alguém já conectou o número pessoal, o workspace ficasse sem número de
    // fallback — e quem não tem o seu ficaria sem canal nenhum.
    const { count } = await supabase
      .from("whatsapp_accounts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant_id)
      .is("user_id", null);
    if (!count) {
      const inst = "ct_" + tenant_id.replace(/-/g, "").slice(0, 12);
      await supabase.from("whatsapp_accounts").insert({
        tenant_id,
        evolution_url: plat.url,
        api_key: plat.api_key,
        instance: inst,
        is_active: true,
      });
    }
  }

  revalidatePath("/dashboard/config");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function saveWhatsApp(
  input: { evolution_url: string; api_key: string; instance: string },
  opts?: { doWorkspace?: boolean }
) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!input.evolution_url.trim() || !input.api_key.trim() || !input.instance.trim())
    return { error: "Preencha URL, API key e instância." };
  // Por padrão a instância é SUA: no WhatsApp a conversa fica no aparelho de quem
  // enviou, então mandar pelo número do escritório faz a resposta chegar na mão errada.
  // `doWorkspace` cria o número compartilhado de sempre (só gestor consegue — a RLS
  // da 0104 recusa user_id nulo para quem não é gestor).
  const { error } = await supabase.from("whatsapp_accounts").insert({
    tenant_id,
    user_id: opts?.doWorkspace ? null : user_id,
    is_shared: !!opts?.doWorkspace,
    evolution_url: input.evolution_url.trim(),
    api_key: input.api_key.trim(),
    instance: input.instance.trim(),
    is_active: true,
  });
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function deleteWhatsApp(id: string) {
  const { supabase } = await ctx();

  // apaga a instância no servidor Evolution ANTES de sumir com o registro —
  // senão ela fica órfã lá e trava a próxima conexão com o mesmo nome
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance")
    .eq("id", id)
    .maybeSingle();

  if (acc) {
    const { deleteInstance } = await import("@/lib/whatsapp");
    await deleteInstance(acc as any).catch(() => {});
  }

  const { error } = await supabase.from("whatsapp_accounts").delete().eq("id", id);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

export async function whatsappQR(id: string) {
  const { supabase } = await ctx();
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance, inbound_token")
    .eq("id", id)
    .maybeSingle();
  if (!acc) return { error: "Conta não encontrada." };

  const { getQR, setWebhook } = await import("@/lib/whatsapp");
  const qr = await getQR(acc as any);

  // Configura o webhook AUTOMATICAMENTE: é o que faz a cadência pausar quando
  // o lead responde. Antes o usuário tinha que copiar a URL e colar na Evolution
  // na mão — e se esquecesse, seguiria mandando follow-up para quem já respondeu.
  try {
    const origem =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    if (origem && (acc as any).inbound_token) {
      const url = `${origem}/api/whatsapp/webhook/${(acc as any).inbound_token}`;
      await setWebhook(acc as any, url);
    }
  } catch { /* o QR é o principal; o webhook a gente confere depois */ }

  return qr;
}

/** Reconfigura o webhook (botão manual, caso algo tenha saído do lugar). */
export async function whatsappSetWebhook(id: string) {
  const { supabase } = await ctx();
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance, inbound_token")
    .eq("id", id)
    .maybeSingle();
  if (!acc) return { error: "Conta não encontrada." };

  const origem =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!origem) return { error: "Configure NEXT_PUBLIC_APP_URL no ambiente." };

  const { setWebhook } = await import("@/lib/whatsapp");
  const url = `${origem}/api/whatsapp/webhook/${(acc as any).inbound_token}`;
  const r = await setWebhook(acc as any, url);

  if (r.error) return { error: r.error };
  return { ok: true, msg: "Webhook configurado. As respostas dos leads vão chegar aqui." };
}

export async function whatsappStatus(id: string) {
  const { supabase } = await ctx();
  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("evolution_url, api_key, instance")
    .eq("id", id)
    .maybeSingle();
  if (!acc) return { error: "Conta não encontrada." };
  const { getStatus } = await import("@/lib/whatsapp");
  return await getStatus(acc as any);
}


// Compartilhar (ou não) uma instância de WhatsApp — mesma regra da caixa de e-mail.
export async function definirCompartilhamentoWhatsApp(id: string, compartilhada: boolean) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  const { error } = await supabase
    .from("whatsapp_accounts")
    .update({ is_shared: !!compartilhada })
    .eq("id", id)
    .eq("tenant_id", tenant_id);
  if (error) return { error: msgErro(error) };
  revalidatePath("/dashboard/config");
  return { ok: true };
}

// ============================================================
// CRIAR A MINHA INSTÂNCIA (número individual, no servidor gerenciado)
//
// Até aqui o autoprovisionamento criava UMA instância por workspace, e só quando não
// havia nenhuma — todo mundo do time enviava pelo mesmo número. Com número por pessoa
// (migration 0104) isso deixa de servir: no WhatsApp a conversa fica no aparelho de quem
// enviou, então mandar pelo número do escritório faz a resposta chegar na mão errada.
//
// Aqui a pessoa cria a linha DELA. A instância no servidor Evolution em si é criada
// sozinha no primeiro pedido de QR (getQR já faz /instance/create quando não existe) —
// então esta ação não precisa falar com o servidor, o que é bom: se o VPS estiver fora
// do ar, a pessoa ainda consegue preparar o cadastro e só o QR falha, com mensagem
// própria.
//
// O nome da instância é DETERMINÍSTICO (tenant + usuário). Duas consequências boas:
// clicar duas vezes não cria duas instâncias no servidor, e dá para saber de quem é uma
// instância olhando o nome dela no Evolution — o que importa no dia em que for preciso
// depurar por lá.
// ============================================================
export async function criarMinhaInstancia() {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!user_id) return { error: "Sessão expirada. Entre de novo." };

  const plat = platformEvolution();
  if (!plat) {
    return {
      error:
        "O servidor de WhatsApp gerenciado não está configurado neste ambiente. " +
        "Use a opção avançada abaixo para informar o seu próprio servidor Evolution.",
    };
  }

  const { data: t } = await supabase.from("tenants").select("whatsapp_mode").eq("id", tenant_id).maybeSingle();
  const { temSessao } = await import("@/lib/waModo");
  if (!temSessao((t as any)?.whatsapp_mode)) {
    return { error: "Escolha o modo híbrido ou o automático acima antes de conectar um número." };
  }

  // já tem? devolve a que existe — o botão vira "reconectar" sem criar duplicata
  const { data: minha } = await supabase
    .from("whatsapp_accounts")
    .select("id, instance")
    .eq("tenant_id", tenant_id)
    .eq("user_id", user_id)
    .limit(1)
    .maybeSingle();
  if (minha) {
    revalidatePath("/dashboard/config");
    return { ok: true, id: (minha as any).id, jaExistia: true };
  }

  const nome = `ct_${tenant_id.replace(/-/g, "").slice(0, 8)}_${user_id.replace(/-/g, "").slice(0, 8)}`;

  const { data: nova, error } = await supabase
    .from("whatsapp_accounts")
    .insert({
      tenant_id,
      user_id,
      is_shared: false,      // número pessoal nasce privado — emprestar é decisão explícita
      evolution_url: plat.url,
      api_key: plat.api_key,
      instance: nome,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    // 42703 = a coluna user_id/is_shared não existe → a migration 0104 não foi aplicada.
    // Dizer isso é melhor do que devolver o erro cru do Postgres.
    if (String((error as any).code) === "42703") {
      return { error: "Este recurso precisa da migration 0104 aplicada no banco. Fale com quem administra." };
    }
    return { error: msgErro(error) };
  }

  revalidatePath("/dashboard/config");
  return { ok: true, id: (nova as any).id, jaExistia: false };
}

// Remover a MINHA instância: apaga no servidor Evolution ANTES de apagar a linha.
// Na ordem inversa, uma falha no VPS deixaria a sessão pareada lá para sempre, sem
// nenhum registro apontando para ela — lixo invisível consumindo memória do servidor.
export async function removerMinhaInstancia(id: string) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id || !user_id) return { error: "Sem workspace." };

  const { data: acc } = await supabase
    .from("whatsapp_accounts")
    .select("id, evolution_url, api_key, instance, user_id")
    .eq("id", id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();
  if (!acc) return { error: "Instância não encontrada." };

  let avisoServidor: string | undefined;
  try {
    const { deleteInstance } = await import("@/lib/whatsapp");
    const r = await deleteInstance(acc as any);
    if (r?.error) avisoServidor = r.error;
  } catch (e: any) {
    avisoServidor = e?.message || "servidor não respondeu";
  }

  // A RLS já barra apagar a instância de outra pessoa — não precisamos checar aqui.
  const { error } = await supabase.from("whatsapp_accounts").delete().eq("id", id).eq("tenant_id", tenant_id);
  if (error) return { error: msgErro(error) };

  revalidatePath("/dashboard/config");
  return {
    ok: true,
    aviso: avisoServidor
      ? `A instância foi removida do Contatia, mas o servidor não confirmou a exclusão da sessão (${avisoServidor}). Se o número continuar aparecendo como conectado no celular, desconecte pelo aparelho: WhatsApp → Dispositivos conectados.`
      : undefined,
  };
}
