import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { podeEnviarAgora, tomarSlot, registrarSucesso, registrarFalha } from "@/lib/agente/ritmoWhatsapp";
import { enviarTarefaWa } from "@/lib/envioWhatsapp";
import { envioAutomatico } from "@/lib/waModo";
import { logAction } from "@/lib/actionLog";
import { quandoTexto } from "@/lib/janelaEnvio";
import { diaISO } from "@/lib/datas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================
// A FILA DE WHATSAPP ANDANDO SOZINHA
//
// O cron irmão (`fila-envio`) tem escrito, na trava número 6, que só e-mail sai sozinho
// — *"automatizar o disparo desses é o caminho curto para perder a conta"*. Este arquivo
// é a exceção pedida pelo dono do número, que a ligou sabendo do preço.
//
// A DIFERENÇA DE DESENHO EM RELAÇÃO AO E-MAIL, e ela é o arquivo inteiro:
//
//   o cron de e-mail manda ATÉ 80 POR RODADA, o mais rápido que a caixa aguentar.
//   este manda NO MÁXIMO UMA, e só se o relógio deixar.
//
// Porque o que queima um número de WhatsApp não é o volume do dia — é a cadência. Vinte
// mensagens em dez horas é gente trabalhando; vinte em dois minutos é um robô, e o
// outro lado lê isso em minutos. Um lote, aqui, é a própria falha.
//
// Então este cron não tem orçamento de tempo nem teto por rodada: ele pergunta ao ritmo
// se pode mandar UMA, manda, e vai embora. O ritmo é quem sabe de janela, cap diário,
// jitter e saúde do chip (`lib/agente/ritmoWhatsapp.ts`).
//
// ORDEM DAS COISAS, e cada passo existe por um motivo:
//   1. autentica (CRON_SECRET) — sem isso a URL é um botão de disparo público;
//   2. workspaces com `fila_wa_automatica = true`, mais antigo primeiro (justiça);
//   3. modo precisa ser `evolution` — no assistido/híbrido o primeiro toque é manual
//      POR DECISÃO, e a fila não pode furar essa decisão pelas costas;
//   4. o ritmo diz se pode;
//   5. TOMA O SLOT antes de enviar — é o que impede a mensagem dupla;
//   6. escolhe UM toque vencido, de contato que não se provou sem WhatsApp;
//   7. envia pelo motor compartilhado com o clique;
//   8. registra: sucesso zera falhas, falha soma (e no teto pausa o chip).
// ============================================================

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

  // Se a 0117 ainda não foi aplicada, o PostgREST recusa a coluna e o certo é NÃO
  // enviar nada. O padrão seguro aqui é o silêncio — nunca "manda para todo mundo".
  const { data: tenants, error: errT } = await admin
    .from("tenants")
    .select("id, name, whatsapp_mode, fila_wa_auto_em")
    .eq("fila_wa_automatica", true)
    .order("fila_wa_auto_em", { ascending: true, nullsFirst: true })
    .limit(50);

  if (errT) {
    return NextResponse.json({
      ok: false,
      motivo: "fila de WhatsApp indisponível",
      detalhe: (errT as any).message,
      dica: "aplique a migration 0117_fila_whatsapp.sql",
    });
  }
  if (!tenants?.length) {
    return NextResponse.json({ ok: true, workspaces: 0, motivo: "nenhum workspace com fila de WhatsApp ligada" });
  }

  const agora = new Date();
  const hoje = diaISO(agora);
  const relatorio: any[] = [];

  for (const t of (tenants as any[])) {
    // carimba a passagem: se esta rodada morrer, o workspace não vira o "mais antigo"
    // para sempre e não monopoliza as rodadas seguintes.
    await admin.from("tenants").update({ fila_wa_auto_em: agora.toISOString() }).eq("id", t.id);

    if (!envioAutomatico(t.whatsapp_mode)) {
      relatorio.push({ workspace: t.name, pulado: "modo não é automático (o primeiro toque é manual por decisão)" });
      continue;
    }

    const v = await podeEnviarAgora(admin, t.id, agora);
    if (!v.pode) {
      relatorio.push({
        workspace: t.name,
        pulado: v.motivo,
        volta: v.volta ? quandoTexto(new Date(v.volta), agora) : null,
      });
      continue;
    }

    // ---- UM toque vencido, do mais atrasado para o mais novo ----
    // `wa_status` diferente de 'invalid': quem já se provou sem WhatsApp não volta
    // amanhã com o mesmo erro (é a marca que `marcarSemWhatsapp` grava).
    // `opted_out` fora: quem pediu para parar não recebe porque a tarefa é antiga.
    const { data: tarefas, error: errTasks } = await admin
      .from("tasks")
      .select("id, due_date, contacts!inner(id, opted_out, wa_status)")
      .eq("tenant_id", t.id)
      .eq("channel", "whatsapp")
      .eq("status", "pending")
      .lte("due_date", hoje)
      .not("contacts.wa_status", "eq", "invalid")
      .not("contacts.opted_out", "is", true)
      // due_date + id: sem a segunda chave a ordem empata e a fila repete linhas.
      .order("due_date", { ascending: true })
      .order("id", { ascending: true })
      .limit(1);

    if (errTasks) {
      relatorio.push({ workspace: t.name, erro: `fila: ${(errTasks as any).message}` });
      continue;
    }
    const tarefa = ((tarefas as any[]) || [])[0];
    if (!tarefa) {
      relatorio.push({ workspace: t.name, nada: "nenhum toque de WhatsApp vencido" });
      continue;
    }

    // ---- o slot, ANTES do envio ----
    const slot = await tomarSlot(admin, t.id, agora);
    if (!slot) {
      relatorio.push({ workspace: t.name, pulado: "outra rodada levou o slot" });
      continue;
    }

    const r = await enviarTarefaWa(admin, {
      tenantId: t.id,
      userId: null,
      taskId: tarefa.id,
      acc: v.chip as any,
      automatico: true,
    });

    if (r.ok) {
      await registrarSucesso(admin, t.id, v.chip.id);
      await logAction(admin, {
        tenant_id: t.id,
        user_id: null,
        action: "fila_wa_envio",
        entity: "task",
        entity_id: tarefa.id,
        qtd: 1,
        detail: `Fila automática de WhatsApp: 1 toque enviado para ${r.phone || "o contato"}.`,
        meta: { taskId: tarefa.id, chip: v.chip.instance, usadosHoje: v.usadosHoje + 1, folga: v.folga - 1, proximo: slot },
      });
      relatorio.push({ workspace: t.name, enviado: 1, para: r.phone, usadosHoje: v.usadosHoje + 1, proximo: quandoTexto(new Date(slot), agora) });
      continue;
    }

    // ---- falhou ----
    const saude = r.pulado
      ? { pausou: false, falhas: v.chip.falhas_seguidas || 0 }   // pulo não é falha do chip
      : await registrarFalha(admin, t.id, v.chip, r.error || "erro desconhecido");

    await logAction(admin, {
      tenant_id: t.id,
      user_id: null,
      action: "fila_wa_falha",
      entity: "task",
      entity_id: tarefa.id,
      qtd: 0,
      detail:
        `Fila automática de WhatsApp: ${r.pulado ? "toque pulado" : "falha no envio"} — ${r.error || "sem detalhe"}` +
        (saude.pausou ? " · NÚMERO PAUSADO por falhas seguidas." : "") + ".",
      meta: { taskId: tarefa.id, chip: v.chip.instance, erro: r.error, pulado: !!r.pulado, semWhatsapp: !!r.semWhatsapp, falhasSeguidas: saude.falhas },
    });

    relatorio.push({
      workspace: t.name,
      falha: r.error,
      pulado: !!r.pulado,
      falhasSeguidas: saude.falhas,
      chipPausado: saude.pausou,
    });
  }

  return NextResponse.json({
    ok: true,
    duracaoMs: Date.now() - agora.getTime(),
    workspaces: relatorio.length,
    enviados: relatorio.reduce((s, r) => s + (r.enviado || 0), 0),
    relatorio,
  });
}
