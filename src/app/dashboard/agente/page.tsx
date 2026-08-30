import { createClient } from "@/lib/supabase/server";
import ConfigTabs from "@/components/ConfigTabs";
import AgenteConfig from "@/components/AgenteConfig";
import AgentePlaybook, { type PlaybookProduto } from "@/components/AgentePlaybook";
import AgenteTreino, { type ExemploLinha, type LicaoLinha } from "@/components/AgenteTreino";
import AgenteRelatorio, { type ResumoAgente } from "@/components/AgenteRelatorio";
import { custoUsd, modeloConhecido } from "@/lib/agente/custo";

export const dynamic = "force-dynamic";

// ============================================================
// AGENTE — o ambiente onde o produto entra e o agente treina
//
// Três abas, em ordem de dependência: sem playbook o agente não conduz, e sem os tetos
// da Config ele não tem contra o que validar o que promete. O treino vem por último
// porque é o que se acumula com o tempo.
//
// O motor ainda não existe. Isto é de propósito: das quatro partes do prompt de cada
// turno — regras duras (código) + playbook + exemplos + estado —, três são DADO, e dado
// leva tempo para ficar bom. Escrever o playbook enquanto o motor é construído é o que
// faz o agente chegar útil no primeiro dia em vez de genérico.
// ============================================================

export default async function Agente() {
  const supabase = createClient();

  const [{ data: cfg, error: errCfg }, { data: produtos }, { data: playbooks }, { data: exemplos }, { data: licoes }] =
    await Promise.all([
      supabase.from("agent_config").select("*").maybeSingle(),
      supabase.from("products").select("id, name, price, billing, active").order("name"),
      supabase.from("agent_playbooks").select("*"),
      supabase.from("agent_exemplos").select("id, produto_id, caminho, origem, peso, ativo, created_at").order("created_at", { ascending: false }).limit(200),
      supabase.from("agent_licoes").select("id, texto, evidencia, status, created_at").eq("status", "pendente").order("created_at", { ascending: false }).limit(100),
    ]);

  // ---------- números do relatório ----------
  // Consultas à parte e com erro engolido: a aba de relatório não pode derrubar a tela
  // de playbook se a 0119/0120 ainda não subiram.
  const [{ data: convs }, { data: decisoes }, { data: opps }] = await Promise.all([
    supabase.from("agent_conversas").select("status, desfecho, etapa_atual"),
    supabase.from("agent_decisoes").select("modelo, tokens_in, tokens_out, erro").limit(5000),
    supabase.from("opportunities").select("value_mrr, status").eq("origem", "agente"),
  ]);

  const listaConvs = (convs as any[]) || [];
  const listaDec = (decisoes as any[]) || [];
  const listaOpp = ((opps as any[]) || []).filter((o) => o.status === "won");

  const porStatus: Record<string, number> = {};
  const porDesfecho: Record<string, number> = {};
  const etapas: Record<string, { total: number; perdidas: number }> = {};
  for (const c of listaConvs) {
    porStatus[c.status] = (porStatus[c.status] || 0) + 1;
    if (c.desfecho) {
      porDesfecho[c.desfecho] = (porDesfecho[c.desfecho] || 0) + 1;
      const e = c.etapa_atual || "(sem etapa)";
      etapas[e] ||= { total: 0, perdidas: 0 };
      etapas[e].total++;
      if (c.desfecho === "silencio" || c.desfecho === "recusa") etapas[e].perdidas++;
    }
  }

  const resumo: ResumoAgente = {
    conversas: listaConvs.length,
    porStatus,
    porDesfecho,
    porEtapa: Object.entries(etapas)
      .map(([etapa, n]) => ({ etapa, ...n }))
      .sort((a, b) => b.perdidas / (b.total || 1) - a.perdidas / (a.total || 1)),
    turnos: listaDec.length,
    turnosComErro: listaDec.filter((d) => d.erro).length,
    tokensIn: listaDec.reduce((s, d) => s + (d.tokens_in || 0), 0),
    tokensOut: listaDec.reduce((s, d) => s + (d.tokens_out || 0), 0),
    custoUsd: listaDec.reduce((s, d) => s + custoUsd(d.modelo, d.tokens_in || 0, d.tokens_out || 0), 0),
    vendas: listaOpp.length,
    receita: listaOpp.reduce((s, o) => s + (Number(o.value_mrr) || 0), 0),
    reunioes: porDesfecho["reuniao"] || 0,
    // Só conta como desconhecido quando houve turno COM tokens naquele modelo: um gatilho
    // (modelo nulo, zero token) não deve pintar o relatório de aviso.
    modeloDesconhecido: listaDec.some((d) => (d.tokens_in || d.tokens_out) && !modeloConhecido(d.modelo)),
  };

  // MIGRATION AINDA NÃO APLICADA: a tela explica em vez de estourar — mesmo cuidado que
  // Conversas toma com a 0116.
  if (errCfg) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold">Agente</h1>
        <div className="card mt-6 p-6">
          <p className="font-semibold">Falta aplicar a migration 0118.</p>
          <p className="mt-2 text-sm text-subtle">
            Esta tela lê <code>agent_config</code>, <code>agent_playbooks</code>, <code>agent_exemplos</code> e{" "}
            <code>agent_licoes</code>, que nascem em <code>supabase/migrations/0118_agente_playbook.sql</code>.
          </p>
          <p className="mt-3 text-xs text-subtle">Detalhe técnico: {errCfg.message}</p>
        </div>
      </div>
    );
  }

  const pbPorProduto = new Map<string, any>();
  for (const p of ((playbooks as any[]) || [])) pbPorProduto.set(p.produto_id, p);

  const lista: PlaybookProduto[] = ((produtos as any[]) || [])
    .filter((p) => p.active)
    .map((p) => {
      const pb = pbPorProduto.get(p.id);
      return {
        produtoId: p.id,
        nome: p.name,
        preco: Number(p.price) || 0,
        billing: p.billing,
        etapas: (pb?.etapas as any[]) || [],
        argumentos: (pb?.argumentos as any[]) || [],
        objecoes: (pb?.objecoes as any[]) || [],
        precos: (pb?.precos as any[]) || [],
        regrasDuras: (pb?.regras_duras as string[]) || [],
        publicado: !!pb?.ativo,
        existe: !!pb,
      };
    });

  const nomeProduto = new Map<string, string>(lista.map((p) => [p.produtoId, p.nome]));

  const exemplosLinhas: ExemploLinha[] = ((exemplos as any[]) || []).map((e) => ({
    id: e.id,
    produto: e.produto_id ? nomeProduto.get(e.produto_id) || null : null,
    caminho: e.caminho,
    origem: e.origem,
    peso: e.peso,
    ativo: e.ativo,
  }));

  const licoesLinhas: LicaoLinha[] = ((licoes as any[]) || []).map((l) => ({
    id: l.id,
    texto: l.texto,
    evidencia: l.evidencia || null,
    criadoEm: l.created_at,
  }));

  const publicados = lista.filter((p) => p.publicado).length;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Agente</h1>
      <p className="mt-1 max-w-3xl text-sm text-subtle">
        Onde o produto entra e o agente treina. O que você escreve aqui é o que ele vai saber: a estratégia por
        produto, os limites de dinheiro e os exemplos de conversa que deram certo.
      </p>

      <div className="mt-6">
        <ConfigTabs tabs={["Agente", `Playbook (${publicados}/${lista.length})`, "Treino", "Resultados"]}>
          <AgenteConfig
            cfg={{
              ativo: !!(cfg as any)?.ativo,
              personaNome: (cfg as any)?.persona_nome || "",
              personaCargo: (cfg as any)?.persona_cargo || "",
              modeloDialogo: (cfg as any)?.modelo_dialogo || "claude-haiku-4-5",
              modeloNegociacao: (cfg as any)?.modelo_negociacao || "claude-sonnet-5",
              horaInicio: Number((cfg as any)?.wa_hora_inicio ?? 9),
              horaFim: Number((cfg as any)?.wa_hora_fim ?? 18),
              dias: String((cfg as any)?.wa_dias ?? "1,2,3,4,5"),
              delayMin: Number((cfg as any)?.delay_min_s ?? 45),
              delayMax: Number((cfg as any)?.delay_max_s ?? 240),
              maxMsgsDia: Number((cfg as any)?.max_msgs_dia_por_conversa ?? 6),
              maxFollowups: Number((cfg as any)?.max_followups_sem_resposta ?? 3),
              valorMaxFechar: (cfg as any)?.valor_max_fechar ?? null,
              tetoDescontoPct: Number((cfg as any)?.teto_desconto_pct ?? 0),
            }}
            playbooksPublicados={publicados}
          />

          <AgentePlaybook produtos={lista} />

          <AgenteTreino
            exemplos={exemplosLinhas}
            licoes={licoesLinhas}
            produtos={lista.map((p) => ({ id: p.produtoId, nome: p.nome }))}
          />

          <AgenteRelatorio r={resumo} />
        </ConfigTabs>
      </div>
    </div>
  );
}
