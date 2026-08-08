import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { capacidadeDeHoje } from "@/lib/capacidadeEmail";
import { enviarUm, type ContextoLote } from "@/lib/envioEmail";
import { transporteDeLote } from "@/lib/mailer";
import { logAction } from "@/lib/actionLog";
import { rotuloJanela, quandoTexto } from "@/lib/janelaEnvio";
import { diaISO } from "@/lib/datas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================
// A FILA ANDANDO SOZINHA — o que a aba aberta fazia, agora no servidor
//
// A v67 deu ritmo à fila (teto por hora + horário comercial) e fez a tela retomar
// sozinha quando a janela abre. Só que aquilo depende do navegador estar aberto: quem
// tem 800 toques e 100/h precisaria de 8 horas de aba viva. Ninguém deixa.
//
// Este cron é a mesma fila, sem ninguém olhando. E por ser sem ninguém olhando, ele é
// o lugar mais perigoso do sistema: um erro aqui manda e-mail errado, pela caixa
// errada, para o lead de outra pessoa — e ninguém está lá para interromper.
//
// AS TRAVAS, EM ORDEM:
//   1. só workspaces com `fila_automatica = true` (0115), que nasce false;
//   2. `capacidadeDeHoje(admin, tenant.id)` — o tenant é EXPLÍCITO. Sem RLS (client
//      admin), sem esse filtro a conta enxergaria as caixas de todos os clientes;
//   3. horário comercial: fora da janela, o workspace é PULADO, não adiado;
//   4. teto por hora e limite diário: a folga efetiva já é o menor dos dois, e o motor
//      recusa por conta própria se o lote passar do teto no meio;
//   5. `enviarUm` reserva a tarefa antes de enviar — duas rodadas simultâneas não
//      mandam a mesma mensagem duas vezes;
//   6. só canal `email`. WhatsApp/Instagram/LinkedIn são assistidos por decisão de
//      produto: automatizar o disparo desses é o caminho curto para perder a conta.
//
// JUSTIÇA ENTRE WORKSPACES: o orçamento é de 60 segundos por rodada. Atendendo sempre
// na mesma ordem, o último da lista nunca seria atendido — por isso a ordem é por
// `fila_auto_em` (quem esperou mais vai primeiro) e cada workspace tem um teto de tempo
// e de mensagens por rodada.
// ============================================================

const ORCAMENTO_TOTAL_MS = 45_000;   // sai limpo antes dos 60s da função
const ORCAMENTO_TENANT_PADRAO = 20_000;
const TETO_POR_TENANT = 80;          // por rodada; o cron roda de novo em minutos

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

  // Workspaces que pediram a fila automática. Se a 0115 ainda não foi aplicada, o
  // PostgREST recusa a coluna (42703) e o certo é NÃO enviar nada — o padrão seguro
  // aqui é o silêncio, não "manda para todo mundo".
  const { data: tenants, error: errT } = await admin
    .from("tenants")
    .select("id, name, fila_auto_em")
    .eq("fila_automatica", true)
    .order("fila_auto_em", { ascending: true, nullsFirst: true })
    .limit(50);

  if (errT) {
    return NextResponse.json({
      ok: false,
      motivo: "fila automática indisponível",
      detalhe: (errT as any).message,
      dica: "aplique a migration 0115_fila_automatica.sql",
    });
  }
  if (!tenants?.length) return NextResponse.json({ ok: true, tenants: 0, motivo: "nenhum workspace com fila automática ligada" });

  const inicio = Date.now();
  const hoje = diaISO();
  const relatorio: any[] = [];

  // Com UM workspace na fila, dividir o tempo não protege ninguém — só entrega menos.
  // O teto por workspace existe para o caso de vários; com um, ele fica com a rodada.
  const orcamentoTenant = tenants.length === 1 ? ORCAMENTO_TOTAL_MS : ORCAMENTO_TENANT_PADRAO;

  for (const t of (tenants as any[])) {
    if (Date.now() - inicio > ORCAMENTO_TOTAL_MS) {
      relatorio.push({ tenant: t.name, pulado: "orçamento da rodada esgotado — entra primeiro na próxima" });
      break;
    }

    // carimba a passagem ANTES de trabalhar: se esta rodada morrer no meio, o workspace
    // não vira o "mais antigo" para sempre e não monopoliza as rodadas seguintes.
    await admin.from("tenants").update({ fila_auto_em: new Date().toISOString() }).eq("id", t.id);

    let cap;
    try {
      cap = await capacidadeDeHoje(admin, t.id);
    } catch (e: any) {
      relatorio.push({ tenant: t.name, erro: `capacidade: ${e?.message || e}` });
      continue;
    }

    if (!cap.contas.length) { relatorio.push({ tenant: t.name, pulado: "nenhuma caixa ativa" }); continue; }
    if (!cap.dentroDoHorario) {
      relatorio.push({
        tenant: t.name,
        pulado: `fora do horário (${rotuloJanela(cap.janela)})`,
        volta: cap.abreEm ? quandoTexto(new Date(cap.abreEm)) : null,
      });
      continue;
    }
    if (cap.folga <= 0) {
      relatorio.push({
        tenant: t.name,
        pulado: cap.travadoPorHora ? "teto por hora atingido" : "limite do dia atingido",
        libera: cap.liberaEm ? quandoTexto(new Date(cap.liberaEm)) : null,
      });
      continue;
    }

    // Quantas cabem AGORA: a folga efetiva (dia ∩ hora ∩ teto geral) limitada pelo teto
    // da rodada. Pedir mais do que cabe só produziria falhas iguais e ruído no log.
    const quantas = Math.min(cap.folga, TETO_POR_TENANT);
    const { data: tarefas, error: errTasks } = await admin
      .from("tasks")
      .select("id")
      .eq("tenant_id", t.id)
      .eq("channel", "email")
      .eq("status", "pending")
      .lte("due_date", hoje)
      // due_date + id: sem a segunda chave a paginação repete e pula linhas (a lição da
      // fila de hoje). Aqui garante também que a ordem de atendimento seja a mesma da
      // tela — o toque mais atrasado sai primeiro.
      .order("due_date", { ascending: true })
      .order("id", { ascending: true })
      .limit(quantas);

    if (errTasks) { relatorio.push({ tenant: t.name, erro: `fila: ${(errTasks as any).message}` }); continue; }
    const ids = ((tarefas as any[]) || []).map((x) => x.id);
    if (!ids.length) { relatorio.push({ tenant: t.name, nada: "nenhum toque de e-mail vencido" }); continue; }

    // ---- contexto do lote, com a SESSÃO do cron (admin + tenant explícito) ----
    const { data: tenantRow } = await admin.from("tenants").select("email_signature").eq("id", t.id).maybeSingle();
    const lote: ContextoLote = {
      cap,
      usadosNoLote: {},
      transportes: new Map<string, any>(),
      imap: new Map<string, any>(),
      assinaturaTenant: ((tenantRow as any)?.email_signature as string) ?? null,
      sessao: { supabase: admin, tenant_id: t.id, user_id: null },
      tempos: { banco: 0, smtp: 0, copia: 0 },
    };
    for (const c of cap.porCaixa) {
      if (c.folga <= 0) continue;
      try { lote.transportes.set(c.conta.id as string, transporteDeLote(c.conta)); } catch { /* cai no caminho de sempre */ }
    }

    const tInicio = Date.now();
    let enviados = 0;
    let falhas = 0;
    const motivos: Record<string, number> = {};
    const porCaixa: Record<string, number> = {};
    let parou: string | null = null;

    for (const id of ids) {
      if (Date.now() - tInicio > orcamentoTenant) { parou = "tempo desta rodada"; break; }
      if (Date.now() - inicio > ORCAMENTO_TOTAL_MS) { parou = "tempo da rodada geral"; break; }
      const r = (await enviarUm(id, undefined, lote)) as
        { ok?: boolean; error?: string; caixa?: string; travaHora?: boolean };
      if (r?.ok) {
        enviados++;
        if (r.caixa) porCaixa[r.caixa] = (porCaixa[r.caixa] || 0) + 1;
        continue;
      }
      falhas++;
      if (r?.error) motivos[r.error] = (motivos[r.error] || 0) + 1;
      // teto por hora ou limite do dia: parar. Insistir vira 80 falhas iguais e, no caso
      // do teto por hora, é exatamente o que faz o provedor cortar a conexão.
      if (r?.travaHora) { parou = "teto por hora"; break; }
      if (r?.error && /[Ll]imite/.test(r.error)) { parou = "limite do dia"; break; }
    }

    for (const tr of lote.transportes.values()) { try { tr.close?.(); } catch { /* nada a fazer */ } }
    for (const s of lote.imap.values()) { if (s) { try { await s.fechar(); } catch { /* nada a fazer */ } } }

    // O registro é a única testemunha: ninguém estava olhando quando isso aconteceu.
    // Sem ele, "meu lead recebeu às 9h04 e eu não mandei" não tem resposta.
    if (enviados || falhas) {
      await logAction(admin, {
        tenant_id: t.id,
        user_id: null,
        action: "fila_auto_envio",
        entity: "task",
        qtd: enviados,
        detail:
          `Fila automática: ${enviados} e-mail(is) enviado(s)` +
          (Object.keys(porCaixa).length ? ` (${Object.entries(porCaixa).map(([c, n]) => `${n} por ${c}`).join(", ")})` : "") +
          (falhas ? ` · ${falhas} falha(s)` : "") +
          (parou ? ` · parou: ${parou}` : "") + ".",
        meta: {
          enviados, falhas, parou,
          porCaixa,
          motivos: Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n}× ${m}`).slice(0, 5),
          capHora: cap.capHoraGeral, usadosHora: cap.usadosHora, folgaDia: cap.folgaDia,
        },
      });
    }

    relatorio.push({
      tenant: t.name, enviados, falhas, parou,
      porCaixa,
      motivos: Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n}× ${m}`).slice(0, 3),
    });
  }

  return NextResponse.json({
    ok: true,
    duracaoMs: Date.now() - inicio,
    workspaces: relatorio.length,
    enviados: relatorio.reduce((s, r) => s + (r.enviados || 0), 0),
    relatorio,
  });
}
