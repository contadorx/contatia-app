"use server";

// ============================================================
// ENRIQUECER A PARTIR DE EMPRESAS
//
// As três ações de enriquecimento (verificar WhatsApp, capturar do site, descobrir
// e-mail) já existiam, mas só alcançavam CONTATOS — e só a partir da tela de Contatos
// ou do Prospectar. Na tela de Empresas não havia nenhuma delas.
//
// Isso é incômodo justamente no fluxo do Radar, onde o que você tem na mão é a EMPRESA:
// para enriquecer os sócios dela era preciso ir até Contatos e caçar quem pertence a
// quem. Aqui a tradução é feita no servidor: empresa selecionada → contatos dela →
// mesma ação de sempre.
//
// Reaproveitar as ações existentes (em vez de duplicar a lógica) é proposital: são elas
// que sabem falar com o Evolution e com o worker SMTP, respeitar limite de lote e
// enfileirar o excedente. Duas cópias dessa lógica divergiriam na primeira correção.
// ============================================================

import { createClient } from "@/lib/supabase/server";
import { msgErro } from "@/lib/erros";
import { verificarWhatsAppLote } from "@/app/dashboard/contatos/wa-actions";
import { capturarDoSiteLote } from "@/app/dashboard/contatos/web-capture-actions";
import { descobrirEmailsLote } from "@/app/dashboard/prospectar/actions";

// Teto de contatos alcançados por clique. Acima disso a função da Vercel não termina —
// e as ações abaixo já enfileiram o excedente para o cron drenar, então o teto aqui é
// só para não montar uma lista gigante à toa.
const TETO_CONTATOS = 300;
const FATIA = 150;   // ids por consulta (limite de tamanho da URL do PostgREST)

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null };
}

// Contatos das empresas selecionadas. `so` recorta quem interessa para cada ação —
// mandar contato que já tem e-mail para a descoberta de e-mail é queimar chamada do
// worker SMTP à toa, e ele é o recurso mais escasso da esteira.
async function contatosDe(
  supabase: any,
  tenant_id: string,
  accountIds: string[],
  so: "todos" | "sem_email" | "com_telefone" | "com_dominio"
): Promise<{ ids: string[]; totalContatos: number }> {
  const ids: string[] = [];
  let total = 0;

  for (let i = 0; i < accountIds.length; i += FATIA) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, email, phone, company_domain, accounts(domain)")
      .eq("tenant_id", tenant_id)
      .in("account_id", accountIds.slice(i, i + FATIA))
      .limit(1000);
    if (error) throw error;

    for (const c of ((data as any[]) || [])) {
      total++;
      const temDominio = !!((c.company_domain || c.accounts?.domain || "").trim());
      const ok =
        so === "todos" ? true :
        so === "sem_email" ? !c.email && temDominio :
        so === "com_telefone" ? !!(c.phone || "").trim() :
        temDominio;
      if (ok && ids.length < TETO_CONTATOS) ids.push(c.id);
    }
  }
  return { ids, totalContatos: total };
}

type Base = { error?: string; contatosAlcancados?: number; totalContatos?: number; aviso?: string };

async function preparar(accountIds: string[], so: Parameters<typeof contatosDe>[3]) {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { erro: "Sem workspace." as string };
  const limpos = Array.from(new Set((accountIds || []).filter(Boolean)));
  if (!limpos.length) return { erro: "Nenhuma empresa selecionada." };
  try {
    const { ids, totalContatos } = await contatosDe(supabase, tenant_id, limpos, so);
    return { ids, totalContatos };
  } catch (e: any) {
    return { erro: msgErro(e) };
  }
}

// Mensagem única para "as empresas até têm contatos, mas nenhum serve para esta ação" —
// dizer só "0 processados" deixaria você sem saber se foi falha ou se não havia alvo.
function nadaAFazer(totalContatos: number, exigencia: string): string {
  return totalContatos
    ? `As empresas selecionadas têm ${totalContatos} contato(s), mas nenhum ${exigencia}.`
    : "As empresas selecionadas não têm nenhum contato cadastrado. Traga os sócios pelo Radar ou cadastre um contato antes.";
}

export async function verificarWhatsAppDasEmpresas(accountIds: string[]): Promise<Base & {
  verificados?: number; comWa?: number; semWa?: number; enfileirados?: number; semTelefone?: number;
}> {
  const p = await preparar(accountIds, "com_telefone");
  if ("erro" in p) return { error: p.erro };
  if (!p.ids.length) return { error: nadaAFazer(p.totalContatos, "tem telefone para verificar") };
  const r = await verificarWhatsAppLote(p.ids);
  return { ...r, contatosAlcancados: p.ids.length, totalContatos: p.totalContatos };
}

export async function capturarDoSiteDasEmpresas(accountIds: string[]): Promise<Base & {
  achou?: number; whats?: number; filaVerif?: number; enfileirados?: number; semDominio?: number;
}> {
  const p = await preparar(accountIds, "com_dominio");
  if ("erro" in p) return { error: p.erro };
  if (!p.ids.length) return { error: nadaAFazer(p.totalContatos, "tem domínio de site para raspar") };
  const r = await capturarDoSiteLote(p.ids);
  return { ...r, contatosAlcancados: p.ids.length, totalContatos: p.totalContatos };
}

export async function descobrirEmailsDasEmpresas(accountIds: string[]): Promise<Base & {
  processados?: number; achou?: number; publicados?: number; semEmail?: number; restantes?: number; semWorker?: boolean;
}> {
  const p = await preparar(accountIds, "sem_email");
  if ("erro" in p) return { error: p.erro };
  if (!p.ids.length) return { error: nadaAFazer(p.totalContatos, "está sem e-mail E com domínio corporativo (é essa a combinação que a descoberta precisa)") };
  const r = await descobrirEmailsLote(p.ids);
  return { ...r, contatosAlcancados: p.ids.length, totalContatos: p.totalContatos };
}
