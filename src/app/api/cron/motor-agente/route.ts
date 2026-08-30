import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { processarTurno } from "@/lib/agente/motor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================
// O CRON DO AGENTE
//
// Varre os turnos vencidos e processa um por um. É o lugar mais perigoso do sistema
// depois da fila de WhatsApp: aqui um modelo fala com o cliente do cliente, sozinho.
//
// LOCK POR INSTANTE, NÃO POR FLAG. Um turno é assumido gravando `lock_em = agora`, e a
// tomada é um UPDATE CONDICIONAL: só leva quem encontrou o lock livre ou vencido. Duas
// rodadas sobrepostas — e elas se sobrepõem, porque um turno com delay humanizado leva
// minutos — nunca respondem a mesma mensagem duas vezes.
//
// Lock VENCE em 5 minutos. A Vercel mata a função aos 60s sem avisar; um lock eterno
// deixaria a conversa muda para sempre, esperando uma rodada morta que não volta.
//
// ORÇAMENTO: o turno tem espera humanizada de até 4 minutos por dentro, o que estoura
// os 60s da função de propósito — a resposta sai da própria execução, e se ela for morta
// no meio, o lock vence e outra rodada retoma. Por isso o teto aqui é de POUCAS
// conversas por rodada: melhor terminar duas direito do que começar dez pela metade.
// ============================================================

const LOCK_VENCE_MS = 5 * 60_000;
const MAX_CONVERSAS_POR_RODADA = 2;

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
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, motivo: "ANTHROPIC_API_KEY ausente — o agente não roda sem ela" });
  }

  const agora = new Date();
  const rodada = `${agora.toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
  const limiteLock = new Date(agora.getTime() - LOCK_VENCE_MS).toISOString();

  // Só workspaces com o agente ligado. Se a 0118/0119 não foram aplicadas, o PostgREST
  // recusa a coluna e o certo é não fazer nada — silêncio é o padrão seguro.
  const { data: cfgs, error: errCfg } = await admin
    .from("agent_config")
    .select("tenant_id")
    .eq("ativo", true);

  if (errCfg) {
    return NextResponse.json({ ok: false, motivo: "agente indisponível", detalhe: errCfg.message, dica: "aplique 0118 e 0119" });
  }
  const tenants = ((cfgs as any[]) || []).map((c) => c.tenant_id);
  if (!tenants.length) return NextResponse.json({ ok: true, turnos: 0, motivo: "nenhum workspace com o agente ligado" });

  const { data: pendentes, error: errConv } = await admin
    .from("agent_conversas")
    .select("id, tenant_id, phone, account_id, status, lock_em")
    .in("tenant_id", tenants)
    .in("status", ["agente", "sombra"])
    .not("due_at", "is", null)
    .lte("due_at", agora.toISOString())
    .order("due_at", { ascending: true })
    .limit(20);

  if (errConv) return NextResponse.json({ ok: false, motivo: "fila indisponível", detalhe: errConv.message });

  const fila = ((pendentes as any[]) || []).filter((c) => !c.lock_em || c.lock_em <= limiteLock);
  if (!fila.length) return NextResponse.json({ ok: true, turnos: 0, motivo: "nenhum turno vencido" });

  const relatorio: any[] = [];

  for (const c of fila.slice(0, MAX_CONVERSAS_POR_RODADA)) {
    // ---- toma o turno ----
    const { data: tomou } = await admin
      .from("agent_conversas")
      .update({ lock_em: agora.toISOString(), lock_por: rodada })
      .eq("tenant_id", c.tenant_id)
      .eq("id", c.id)
      .or(`lock_em.is.null,lock_em.lte.${limiteLock}`)
      .select("id");

    if (!((tomou as any[]) || []).length) {
      relatorio.push({ conversa: c.id, pulado: "outra rodada assumiu" });
      continue;
    }

    // ---- o envio de verdade, só fora do modo sombra ----
    const sombra = c.status === "sombra";
    let enviarReal: ((t: string) => Promise<{ ok?: boolean; error?: string }>) | null = null;
    let presenca: ((ms: number) => Promise<void>) | undefined;

    if (!sombra) {
      const { data: chip } = await admin
        .from("whatsapp_accounts")
        .select("id, evolution_url, api_key, instance, pausado_em")
        .eq("tenant_id", c.tenant_id)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!chip || (chip as any).pausado_em) {
        await admin.from("agent_conversas")
          .update({ lock_em: null, lock_por: null, due_at: new Date(agora.getTime() + 30 * 60_000).toISOString() })
          .eq("tenant_id", c.tenant_id).eq("id", c.id);
        relatorio.push({ conversa: c.id, pulado: chip ? "número pausado" : "sem número ativo" });
        continue;
      }

      const { sendText, sendPresence } = await import("@/lib/whatsapp");
      enviarReal = async (texto: string) => sendText(chip as any, c.phone, texto);
      presenca = async (ms: number) => sendPresence(chip as any, c.phone, "composing", ms);
    }

    try {
      const r = await processarTurno(admin, {
        conversaId: c.id,
        tenantId: c.tenant_id,
        agora,
        enviarReal,
        presenca,
      });
      relatorio.push({ conversa: c.id, sombra, ...r });
    } catch (e: any) {
      // Nunca deixa o lock preso por uma exceção que escapou.
      await admin.from("agent_conversas")
        .update({ lock_em: null, lock_por: null })
        .eq("tenant_id", c.tenant_id).eq("id", c.id);
      relatorio.push({ conversa: c.id, erro: e?.message || String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    duracaoMs: Date.now() - agora.getTime(),
    naFila: fila.length,
    processados: relatorio.length,
    relatorio,
  });
}
