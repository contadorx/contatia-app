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
import { apagarLote } from "@/lib/apagarLote";

// O PostgREST devolve no máximo 1.000 linhas por consulta — é o tamanho da busca.
// Quem apaga é apagarLote(): pela função do banco (0102) é UMA ida por 1.000; sem ela,
// cai para pedaços de 200 por causa do limite de tamanho da URL.
const ONDA_BUSCA = 1000;
// Teto por CHAMADA. A tela chama de novo sozinha até zerar, então isto não é mais o
// limite do que dá para apagar — é só o tamanho de cada volta.
const TETO_POR_CHAMADA = 20000;
// Orçamento de tempo: a função morre aos 60s (maxDuration da página). Saindo aos 40s
// devolvemos um resultado honesto ("saíram X, faltam Y") em vez de sermos mortos no
// meio — que é exatamente o que fazia a exclusão parar nos ~4.000 sem explicar nada.
const ORCAMENTO_MS = 40_000;

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
): Promise<{ ok?: boolean; excluidos?: number; restam?: number; incompleto?: boolean; error?: string; aviso?: string }> {
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

  // Só recusa quando o conjunto CRESCEU além do que foi confirmado — é aí que mora o
  // perigo (apagar mais gente do que a pessoa viu). ENCOLHER é normal e esperado: apagar
  // uma base grande leva várias chamadas, e a tela reenvia como confirmação o total que
  // SOBROU. A versão anterior usava o valor absoluto da diferença e por isso recusava a
  // continuação — a segunda volta batia em "o número mudou" e a exclusão empacava.
  if (totalAgora > esperado + Math.max(5, esperado * 0.05)) {
    return { error: `O filtro passou a pegar mais gente do que você conferiu (${esperado} → ${totalAgora}). Recarregue a lista e confirme de novo.` };
  }

  // TETO REAL: o menor entre o que foi confirmado (+margem) e o teto da chamada.
  // Sem isto, um filtro que "cresce" a cada onda poderia apagar muito além do que o
  // operador viu e confirmou.
  const limiteAbsoluto = Math.min(Math.ceil(esperado * 1.05), TETO_POR_CHAMADA);

  const semFiltro = filtroVazio(f);
  const inicio = Date.now();
  let excluidos = 0;
  const amostra: any[] = [];
  let falha: string | null = null;
  let tempoEsgotado = false;

  try {
    while (excluidos < limiteAbsoluto) {
      if (Date.now() - inicio > ORCAMENTO_MS) { tempoEsgotado = true; break; }

      const restanteNoTeto = limiteAbsoluto - excluidos;
      const { query } = await consultaContatos(
        supabase, f, { gerente, userId: user_id, tenantId: tenant_id },
        { select: "id, name, company, email", limit: Math.min(ONDA_BUSCA, restanteNoTeto), ordenar: false }
      );
      const { data, error } = await query;
      if (error) { falha = msgErro(error); break; }

      const linhas = ((data as any[]) || []);
      if (!linhas.length) break;

      for (const c of linhas) {
        if (amostra.length < 50) amostra.push({ id: c.id, nome: c.name, empresa: c.company, email: c.email });
      }

      const r = await apagarLote(supabase, "contacts", tenant_id, linhas.map((c) => c.id));
      excluidos += r.n;
      if (r.erro) { falha = r.erro; break; }
      // havia linhas mas nada saiu = a RLS barrou; insistir viraria laço infinito
      if (!r.n) break;
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
        (tempoEsgotado ? " (volta parcial: orçamento de tempo)" : "") +
        ".",
      meta: { itens, truncado, filtro: f, semFiltro, confirmado: esperado, falha, tempoEsgotado },
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
  // `incompleto` é o que faz a tela chamar de novo sozinha até zerar.
  return { ok: true, excluidos, restam, incompleto: restam > 0 && excluidos > 0 };
}

// ============================================================
// EXPORTAR CSV do que bate com o filtro
//
// Mesma consulta da tela e da exclusão — se você exporta antes de apagar, o arquivo é
// exatamente o conjunto que vai sair. Era a rede de segurança que faltava.
//
// As CINCO primeiras colunas são, de propósito, as que o importador do Contatia espera
// (Nome, E-mail, Telefone, Empresa, Origem): o arquivo exportado volta para dentro do
// sistema sem edição nenhuma.
// ============================================================
const TETO_EXPORT = 20000;

export async function exportarContatosPorFiltro(
  filtro: FiltroContatos,
  opts?: { ids?: string[] }
): Promise<{ csv?: string; linhas?: number; truncado?: boolean; teto?: number; error?: string }> {
  const { supabase, tenant_id, user_id, gerente } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };

  const { montarCsv, dataCsv } = await import("@/lib/csv");
  const f = normalizarFiltro(filtro);
  const selecao = (opts?.ids || []).filter(Boolean);

  const SELECT =
    "id, name, email, phone, company, cnpj, role_title, origin, status, score, " +
    "wa_status, wa_number, company_domain, last_activity_at, created_at, " +
    "contact_tags(tags(name)), profiles:assigned_to(full_name, email)";

  const linhas: any[] = [];
  let truncado = false;

  try {
    if (selecao.length) {
      // exportar SÓ os marcados: fatia de 200 para não estourar o tamanho da URL
      for (let i = 0; i < selecao.length && linhas.length < TETO_EXPORT; i += 200) {
        const { data, error } = await supabase
          .from("contacts").select(SELECT).eq("tenant_id", tenant_id).in("id", selecao.slice(i, i + 200));
        if (error) return { error: msgErro(error) };
        linhas.push(...(((data as any[]) || [])));
      }
    } else {
      // exportar TUDO que bate com o filtro, em páginas (o PostgREST corta em 1.000)
      for (let pagina = 0; pagina * 1000 < TETO_EXPORT; pagina++) {
        const { query } = await consultaContatos(
          supabase, f, { gerente, userId: user_id, tenantId: tenant_id },
          { select: SELECT }
        );
        const { data, error } = await query.range(pagina * 1000, pagina * 1000 + 999);
        if (error) return { error: msgErro(error) };
        const lote = ((data as any[]) || []);
        linhas.push(...lote);
        if (lote.length < 1000) break;
        if (linhas.length >= TETO_EXPORT) { truncado = true; break; }
      }
    }
  } catch (e: any) {
    return { error: msgErro(e) };
  }

  if (!linhas.length) return { error: "Nada para exportar com esse filtro." };

  const WA: Record<string, string> = { valid: "Sim", invalid: "Não", queued: "Verificando", error: "Erro" };
  const csv = montarCsv(
    ["Nome", "E-mail", "Telefone", "Empresa", "Origem", "CNPJ", "Cargo", "Situação", "Score",
     "WhatsApp", "Número WhatsApp", "Domínio", "Tags", "Responsável", "Último toque", "Criado em"],
    linhas.slice(0, TETO_EXPORT).map((c) => [
      c.name, c.email, c.phone, c.company, c.origin, c.cnpj, c.role_title, c.status, c.score,
      WA[c.wa_status as string] || "", c.wa_number, c.company_domain,
      ((c.contact_tags as any[]) || []).map((t) => t?.tags?.name).filter(Boolean).join(", "),
      c.profiles?.full_name || c.profiles?.email || "",
      dataCsv(c.last_activity_at), dataCsv(c.created_at),
    ])
  );

  return { csv, linhas: Math.min(linhas.length, TETO_EXPORT), truncado, teto: TETO_EXPORT };
}
