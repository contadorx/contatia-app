"use server";

// ============================================================
// AÇÕES SOBRE "TUDO QUE BATE COM O FILTRO"
//
// A lista carrega 200 contatos. Marcar todos alcançava só esses 200 — numa base de
// dezenas de milhares, isso é inútil para limpar. Aqui a operação é pelo FILTRO: o
// servidor refaz a mesma consulta da tela (consultaContatos, o mesmo código) e
// trabalha sobre o resultado inteiro.
//
// Travas, todas porque isto APAGA:
//  • a consulta é REFEITA no servidor — o cliente manda o filtro, nunca a lista de ids
//    (senão bastaria adulterar o pedido para apagar o que quisesse);
//  • tenant explícito + RLS: quem não é gestor só apaga o que é dele;
//  • ondas de 200 ids (URL do PostgREST com 1.000 uuids passa de 37 KB e o servidor
//    recusa — medido);
//  • o total é reconferido antes e o laço NUNCA passa do que foi confirmado;
//  • se quebrar no meio, o que já saiu vai para o registro de ações assim mesmo —
//    exclusão parcial sem trilha é pior que exclusão nenhuma.
// ============================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { msgErro } from "@/lib/erros";
import { isManager } from "@/lib/permissions";
import { consultaContatos, normalizarFiltro, filtroVazio, type FiltroContatos } from "@/lib/contatosFiltro";
import { logAction, recortarItens } from "@/lib/actionLog";

// 200 uuids ≈ 7,4 KB de URL — abaixo do limite de 8 KB do PostgREST/proxy.
const ONDA = 200;
// Teto por clique. Cabe folgado nos 60s da função; o que sobrar, o operador clica de novo.
const TETO_POR_CHAMADA = 10000;

async function ctx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("profiles").select("tenant_id, role, team_role").eq("id", user?.id ?? "").maybeSingle();
  return {
    supabase,
    tenant_id: ((me as any)?.tenant_id as string) || null,
    user_id: user?.id,
    gerente: isManager((me as any)?.role, (me as any)?.team_role),
  };
}

// Quantos contatos batem com o filtro de verdade (não os 200 da tela).
// Só roda quando o operador clica em "selecionar todos" — nunca a cada carregamento.
// Devolve TAMBÉM `semFiltro`, decidido pelo servidor com filtroVazio(). A tela não
// deve julgar isso sozinha: `?q=%%%` ou `?view=lixo` parecem filtro mas não aplicam
// condição nenhuma — a UI acharia que está recortando e pularia a confirmação extra
// de "isso zera a sua base".
export async function contarPorFiltro(filtro: FiltroContatos): Promise<{ total?: number; semFiltro?: boolean; error?: string }> {
  const { supabase, tenant_id, user_id, gerente } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  try {
    const { query } = await consultaContatos(
      supabase,
      normalizarFiltro(filtro),
      { gerente, userId: user_id, tenantId: tenant_id },
      { select: "id", count: "exact", head: true, ordenar: false }
    );
    const { count, error } = await query;
    if (error) return { error: msgErro(error) };
    return { total: count ?? 0, semFiltro: filtroVazio(filtro) };
  } catch (e: any) {
    return { error: msgErro(e) };
  }
}

// Exclui TODOS os contatos que batem com o filtro.
// `confirmacao.total` é o número que o operador viu na tela: serve de teto E de
// verificação. Sem um total válido a ação não roda — não dá para apagar às cegas.
export async function excluirPorFiltro(
  filtro: FiltroContatos,
  confirmacao: { total: number }
): Promise<{ ok?: boolean; excluidos?: number; restam?: number; error?: string; aviso?: string }> {
  const { supabase, tenant_id, user_id, gerente } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const f = normalizarFiltro(filtro);
  const esperado = Math.floor(Number(confirmacao?.total));
  if (!Number.isFinite(esperado) || esperado <= 0) {
    return { error: "Confirmação inválida. Recarregue a lista e selecione de novo." };
  }

  const contar = async (): Promise<number> => {
    const { query } = await consultaContatos(
      supabase, f, { gerente, userId: user_id, tenantId: tenant_id },
      { select: "id", count: "exact", head: true, ordenar: false }
    );
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  };

  let totalAgora = 0;
  try {
    totalAgora = await contar();
  } catch (e: any) {
    return { error: msgErro(e) };
  }
  if (!totalAgora) return { error: "Nenhum contato bate com esse filtro." };

  // O número mudou entre o clique e a confirmação → não apaga. A margem de 5% cobre um
  // cron mexendo na base no meio do caminho; acima disso, algo mudou de verdade.
  const desvio = Math.abs(totalAgora - esperado);
  if (desvio > Math.max(5, esperado * 0.05)) {
    return { error: `O número mudou desde que você conferiu (${esperado} → ${totalAgora}). Recarregue a lista e confirme de novo.` };
  }

  // TETO REAL: o menor entre o que foi confirmado (+margem) e o teto da chamada.
  // Sem isto, um filtro que "cresce" a cada onda poderia apagar muito além do que o
  // operador viu e confirmou.
  const limiteAbsoluto = Math.min(Math.ceil(esperado * 1.05), TETO_POR_CHAMADA);

  const semFiltro = filtroVazio(f);
  let excluidos = 0;
  const amostra: any[] = [];
  let falha: string | null = null;

  try {
    while (excluidos < limiteAbsoluto) {
      const restanteNoTeto = limiteAbsoluto - excluidos;
      const { query } = await consultaContatos(
        supabase, f, { gerente, userId: user_id, tenantId: tenant_id },
        { select: "id, name, company, email", limit: Math.min(ONDA, restanteNoTeto), ordenar: false }
      );
      const { data, error } = await query;
      if (error) { falha = msgErro(error); break; }

      const linhas = ((data as any[]) || []);
      if (!linhas.length) break;

      for (const c of linhas) {
        if (amostra.length < 50) amostra.push({ id: c.id, nome: c.name, empresa: c.company, email: c.email });
      }

      const { data: apagados, error: errDel } = await supabase
        .from("contacts").delete().eq("tenant_id", tenant_id).in("id", linhas.map((c) => c.id)).select("id");
      if (errDel) { falha = msgErro(errDel); break; }

      const n = ((apagados as any[]) || []).length;
      excluidos += n;
      // havia linhas mas nada saiu = a RLS barrou; insistir viraria laço infinito
      if (!n) break;
    }
  } catch (e: any) {
    falha = msgErro(e);
  }

  // O log vai SEMPRE que algo saiu — inclusive quando quebrou no meio. Uma exclusão
  // parcial sem registro é o pior dos mundos: some gente e ninguém sabe quem.
  if (excluidos > 0) {
    const { itens, truncado } = recortarItens(amostra);
    await logAction(supabase, {
      tenant_id,
      user_id,
      action: "contact_delete_bulk",
      entity: "contact",
      qtd: excluidos,
      detail:
        `${excluidos} contato(s) excluído(s) por filtro` +
        (semFiltro ? " — SEM filtro nenhum (base inteira)" : "") +
        (falha ? " (interrompido por erro no meio)" : "") +
        ".",
      meta: { itens, truncado, filtro: f, semFiltro, confirmado: esperado, falha },
    });
    revalidatePath("/dashboard/contatos");
    revalidatePath("/dashboard/contas");
    revalidatePath("/dashboard");
  }

  if (falha) {
    return excluidos > 0
      ? { ok: true, excluidos, aviso: `Parou no meio: ${falha}. ${excluidos} já foram excluídos e estão no registro — clique de novo para continuar.` }
      : { error: falha };
  }

  let restam = 0;
  try { restam = await contar(); } catch { /* informativo */ }
  return { ok: true, excluidos, restam };
}
