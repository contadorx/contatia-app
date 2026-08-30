import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================
// O DESTILADOR — o que sobra de uma conversa depois que ela acaba
//
// Roda de madrugada e faz duas coisas com naturezas MUITO diferentes:
//
//   1. EXEMPLOS. Conversa que virou venda ou reunião vira exemplo, sozinha, sem pedir
//      licença. Pode, porque exemplo só muda TOM e ARGUMENTO — o preço continua vindo
//      do playbook e as regras duras continuam no código.
//
//   2. LIÇÕES. Padrões que mudariam REGRA. Nascem `pendente` e esperam você. É o que
//      impede o agente de aprender um vício — ou de ser "treinado" por um lead
//      mal-intencionado que repete a mesma manipulação até ela virar padrão.
//
// A DIFERENÇA ENTRE AS DUAS É A LINHA INTEIRA DO SISTEMA. Um destilador que aprovasse as
// próprias lições seria um agente que reescreve as próprias regras.
//
// SOBRE NÃO INVENTAR LIÇÃO: com 3 conversas não há padrão, há coincidência. O mínimo
// abaixo existe porque uma lição errada aprovada vira vício em todas as conversas
// seguintes — e o custo de não propor nada é zero.
// ============================================================

const MIN_CONVERSAS_PARA_LICAO = 12;
const MAX_POR_RODADA = 8;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}` && key !== secret) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SERVICE_ROLE ausente" }, { status: 500 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ ok: false, motivo: "ANTHROPIC_API_KEY ausente" });

  const { data: cfgs, error: errCfg } = await admin.from("agent_config").select("tenant_id, modelo_dialogo");
  if (errCfg) return NextResponse.json({ ok: false, motivo: "agente indisponível", detalhe: errCfg.message });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const relatorio: any[] = [];

  for (const cfg of ((cfgs as any[]) || [])) {
    const tenantId = cfg.tenant_id;

    // ---------- 1. conversas terminadas e ainda não lidas ----------
    const { data: conversas } = await admin
      .from("agent_conversas")
      .select("id, contact_id, phone, desfecho, etapa_atual, resumo_rolante")
      .eq("tenant_id", tenantId)
      .not("desfecho", "is", null)
      .is("destilado_em", null)
      .order("ultima_msg_em", { ascending: false })
      .limit(MAX_POR_RODADA);

    let exemplosNovos = 0;

    for (const c of ((conversas as any[]) || [])) {
      // Só o que deu certo vira exemplo. Recusa e opt-out são anti-padrão: interessam ao
      // relatório, mas ensinar o agente a repetir o caminho de uma recusa seria ensinar
      // exatamente a coisa errada.
      const viraExemplo = c.desfecho === "venda" || c.desfecho === "reuniao";

      if (viraExemplo) {
        const { data: msgs } = await admin
          .from("whatsapp_messages")
          .select("direction, text")
          .eq("tenant_id", tenantId)
          .eq(c.contact_id ? "contact_id" : "phone", c.contact_id || c.phone)
          .order("created_at", { ascending: true })
          .limit(40);

        const transcricao = ((msgs as any[]) || [])
          .filter((m) => m.text)
          .map((m) => `${m.direction === "in" ? "LEAD" : "NÓS"}: ${m.text}`)
          .join("\n")
          .slice(0, 12000);

        if (transcricao.length > 120) {
          try {
            const resp = await client.messages.create({
              model: cfg.modelo_dialogo || "claude-haiku-4-5",
              max_tokens: 700,
              system:
                "Você resume conversas de venda por WhatsApp para servir de exemplo a um agente. " +
                "Escreva em português do Brasil, no formato:\n" +
                "Contexto: (quem era o lead e de onde veio)\n" +
                "Movimentos: (as decisões que funcionaram, na ordem — o que foi perguntado, quando o preço entrou, como a objeção foi tratada)\n" +
                "Resultado: (como terminou)\n\n" +
                "Regras: no máximo 12 linhas; foque nas DECISÕES, não nas frases exatas; " +
                "NÃO invente nada que não esteja na conversa; não copie textos longos.",
              messages: [{ role: "user", content: transcricao }],
            });
            const caminho = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();

            if (caminho.length > 60) {
              await admin.from("agent_exemplos").insert({
                tenant_id: tenantId,
                caminho,
                origem: c.desfecho === "venda" ? "won" : "reuniao",
                // Venda pesa mais que reunião: o desfecho é mais forte, e o peso é como
                // o few-shot escolhe quem entra quando há mais exemplo que espaço.
                peso: c.desfecho === "venda" ? 6 : 4,
              });
              exemplosNovos++;
            }
          } catch { /* uma conversa que não resume não pode travar a rodada */ }
        }
      }

      await admin.from("agent_conversas")
        .update({ destilado_em: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("id", c.id);
    }

    // ---------- 2. lições, só com amostra que sustente ----------
    const { count: totalDesfechos } = await admin
      .from("agent_conversas")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .not("desfecho", "is", null);

    let licoesNovas = 0;
    if ((totalDesfechos ?? 0) >= MIN_CONVERSAS_PARA_LICAO) {
      // O padrão que dá para medir sem modelo nenhum: em que ETAPA as conversas morrem.
      // Se uma etapa concentra os silêncios, isso é evidência — não palpite.
      const { data: mortes } = await admin
        .from("agent_conversas")
        .select("etapa_atual, desfecho")
        .eq("tenant_id", tenantId)
        .not("desfecho", "is", null);

      const porEtapa: Record<string, { total: number; ruins: number }> = {};
      for (const m of ((mortes as any[]) || [])) {
        const e = m.etapa_atual || "(sem etapa)";
        porEtapa[e] ||= { total: 0, ruins: 0 };
        porEtapa[e].total++;
        if (m.desfecho === "silencio" || m.desfecho === "recusa") porEtapa[e].ruins++;
      }

      for (const [etapa, n] of Object.entries(porEtapa)) {
        if (n.total < 5) continue;
        const taxa = n.ruins / n.total;
        if (taxa < 0.6) continue;

        const texto = `A etapa "${etapa}" está perdendo ${Math.round(taxa * 100)}% das conversas (${n.ruins} de ${n.total}). Vale revisar o argumento ou a pergunta desta etapa no playbook.`;
        // Não repropõe o que já está na fila nem o que você já decidiu: uma lição
        // rejeitada voltando toda noite é a forma mais rápida de a fila virar ruído.
        const { data: jaExiste } = await admin
          .from("agent_licoes").select("id").eq("tenant_id", tenantId).eq("texto", texto).limit(1).maybeSingle();
        if (jaExiste) continue;

        await admin.from("agent_licoes").insert({
          tenant_id: tenantId,
          texto,
          evidencia: `${n.ruins} de ${n.total} conversas que passaram por "${etapa}" terminaram em silêncio ou recusa.`,
        });
        licoesNovas++;
      }
    }

    relatorio.push({
      tenant: tenantId,
      conversasLidas: ((conversas as any[]) || []).length,
      exemplosNovos,
      licoesNovas,
      ...(totalDesfechos !== null && (totalDesfechos ?? 0) < MIN_CONVERSAS_PARA_LICAO
        ? { licoes: `amostra pequena (${totalDesfechos} de ${MIN_CONVERSAS_PARA_LICAO}) — nenhuma lição proposta` }
        : {}),
    });
  }

  return NextResponse.json({ ok: true, workspaces: relatorio.length, relatorio });
}
