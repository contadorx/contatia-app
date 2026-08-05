"use server";

// ============================================================
// O LOTE PRECISA DAR OS MESMOS PASSOS QUE O INDIVIDUAL
//
// Na ficha, "Atualizar dados" roda quatro passos, NESTA ordem, e a ordem não é
// enfeite — cada um destrava o seguinte:
//
//   1. CNPJ (Receita) → traz DOMÍNIO, telefone, sócios, porte, regime
//   2. site           → e-mail publicado, telefone, WhatsApp, redes
//   3. e-mail (SMTP)  → o endereço do decisor
//   4. WhatsApp       → confirma o número
//
// O "Completar canais" em lote começava no passo 2 e nunca consultava a Receita. Para
// um contato importado só com CNPJ — que é o caso da maioria vinda de planilha — isso
// significa: sem domínio, logo sem site para ler, logo sem e-mail para descobrir. As
// três fases seguintes rodavam e não achavam nada, e o resultado era "não tem dados
// publicados" para uma base que nunca foi consultada na origem.
//
// Esta ação é a fase que faltava. Ela chama `enrichContact`, exatamente a mesma
// função do passo individual — não uma reimplementação. Duas cópias da mesma regra
// divergem, e neste projeto já divergiram mais de uma vez.
// ============================================================

import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (prof as any)?.tenant_id as string | undefined };
}

export type ResultadoReceitaLote = {
  ok?: boolean;
  enriquecidos?: number;
  jaTinham?: number;
  semCnpj?: number;
  falhas?: number;
  ganhouDominio?: number;
  primeiroErro?: string | null;
  error?: string;
};

// Consulta externa por contato: em lote grande isso estoura o tempo da função. O
// cliente chama em fatias — igual às outras fases do Completar canais.
const TETO_POR_CHAMADA = 8;

export async function enriquecerReceitaLote(contactIds: string[]): Promise<ResultadoReceitaLote> {
  const { supabase, tenant_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!contactIds.length) return { error: "Nada selecionado." };

  const { data: rows, error } = await supabase
    .from("contacts")
    .select("id, cnpj, company_domain, custom, accounts(cnpj, domain)")
    .in("id", contactIds.slice(0, TETO_POR_CHAMADA))
    .eq("tenant_id", tenant_id);
  if (error) return { error: error.message };

  const lista = (rows as any[]) || [];
  let enriquecidos = 0, jaTinham = 0, semCnpj = 0, falhas = 0, ganhouDominio = 0;
  let primeiroErro: string | null = null;

  const { enrichContact } = await import("./actions");

  for (const c of lista) {
    const temCnpj = !!(c.cnpj || c.accounts?.cnpj);
    if (!temCnpj) { semCnpj++; continue; }
    // Mesma guarda do passo individual: não repete o que já foi feito. Consulta
    // externa custa, e a Receita não muda de um dia para o outro.
    if ((c.custom as any)?.enriched_at) { jaTinham++; continue; }

    const tinhaDominio = !!(c.company_domain || c.accounts?.domain);
    try {
      const r: any = await enrichContact(c.id);
      if (r?.error) {
        falhas++;
        if (!primeiroErro) primeiroErro = r.error;
        continue;
      }
      enriquecidos++;
      // O ganho que importa para as fases seguintes: sem domínio, site e e-mail não
      // têm onde procurar. Este número é o que explica por que a fase 2 passa a achar
      // coisas que antes não achava.
      if (!tinhaDominio) {
        const { data: depois } = await supabase
          .from("contacts").select("company_domain").eq("id", c.id).maybeSingle();
        if ((depois as any)?.company_domain) ganhouDominio++;
      }
    } catch (e: any) {
      falhas++;
      if (!primeiroErro) primeiroErro = e?.message || "falhou ao consultar";
    }
  }

  return { ok: true, enriquecidos, jaTinham, semCnpj, falhas, ganhouDominio, primeiroErro };
}
