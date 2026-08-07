"use server";

import { msgErro } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/lib/actionLog";
import { variacoesDoPasso, escolherVariacao } from "@/lib/variacoes";
import { normalizarCondicao } from "@/lib/condicoes";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

export async function bulkAssign(contactIds: string[], userId: string | null) {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!contactIds.length) return { error: "Nenhum contato selecionado." };
  const { error } = await supabase.from("contacts").update({ assigned_to: userId }).in("id", contactIds);
  if (error) return { error: msgErro(error) };
  let nomeDono = "sem dono";
  if (userId) {
    const { data: p } = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
    nomeDono = (p?.full_name as string) || (p?.email as string) || "outro membro";
  }
  await logAction(supabase, {
    tenant_id,
    user_id,
    action: "contact_assign_bulk",
    entity: "contact",
    qtd: contactIds.length,
    detail: `Atribuiu ${contactIds.length} contato(s) a ${nomeDono}.`,
  });
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/equipe");
  return { ok: true, count: contactIds.length };
}

// ============================================================
// INSCREVER EM LOTE — reescrito para não morrer no meio
//
// O QUE ACONTECIA: este laço chamava enrollContact() UMA VEZ POR CONTATO. Cada chamada
// fazia ~10 idas ao banco (auth, perfil, contato, "já inscrito?", passos, 4 consultas
// para escolher a caixa, insert da inscrição, insert das tarefas).
//
// Com 301 contatos isso são ~3.000 idas ao banco em série. Passa dos 60 segundos da
// função da Vercel, a função é morta, e a resposta que a tela esperava nunca chega —
// `res` chegava `undefined` e a tela quebrava em `res.enrolled`.
//
// AGORA: as consultas que são IGUAIS para todo mundo (passos da cadência, pool de
// caixas) acontecem UMA vez; contatos e inscrições existentes vêm em fatias; e as
// inscrições e tarefas são inseridas em lote. Passa de ~3.000 idas para ~10.
//
// As regras do motor foram preservadas UMA A UMA — elas são o que impede o lead de
// receber duas vezes ou de entrar numa cadência que não consegue receber:
//   1. opted_out nunca é reinscrito;
//   2. quem já está active/paused nesta cadência não entra de novo;
//   3. passo de e-mail exige e-mail; whatsapp/ligação exigem telefone. O passo sem o
//      dado é PULADO, mas o cronograma continua contando os dias;
//   4. se nenhum passo for elegível, o contato NÃO é inscrito;
//   5. o texto é renderizado na criação da tarefa;
//   6. o A/B de assunto é sorteado por inscrição;
//   7. a caixa é sorteada POR CONTATO (todos os passos de um contato saem da mesma).
// ============================================================
const FATIA_CONSULTA = 150;   // ids por URL (limite do PostgREST)
const LOTE_INSERT = 300;
const TETO_INSCRICAO = 2000;  // trava de segurança por clique

type ResEnroll = {
  ok?: boolean; enrolled?: number; semDado?: number; semWhatsapp?: number; jaInscrito?: number;
  suprimidos?: number; outros?: number; tarefas?: number;
  truncado?: boolean; teto?: number; selecionados?: number; error?: string;
};

// ============================================================
// DESINSCREVER EM LOTE
//
// Tirar da cadência só existia DENTRO DA FICHA, uma inscrição por vez. Quem inscreveu
// 300 contatos na cadência errada — e isso acontece, porque inscrever é um clique —
// tinha que abrir 300 fichas. A porta de entrada era em lote; a de saída, não.
//
// O QUE ESTA AÇÃO FAZ, LITERALMENTE:
//   1. encerra as inscrições ATIVAS e PAUSADAS dos contatos selecionados
//      (status "stopped" — o mesmo de stopEnrollment, na ficha);
//   2. cancela as tarefas ainda PENDENTES dessas inscrições (status "skipped").
//
// O QUE ELA NÃO FAZ, DE PROPÓSITO:
//   - não toca em tarefa `done`: o toque saiu, o histórico é o que aconteceu, não o que
//     a gente gostaria que tivesse acontecido;
//   - não apaga a inscrição: "stopped" preserva o que o contato recebeu antes. Apagar
//     levaria as tarefas junto (FK cascade) e o relatório da cadência mentiria depois;
//   - não mexe em `replied`/`finished` — essas já acabaram sozinhas.
//
// `sequenceId` opcional: com cadência escolhida, sai só daquela; sem cadência, sai de
// TODAS. A tela pergunta antes, porque o número de toques cancelados é a parte que não
// volta.
// ============================================================
type ResDesinscrever = {
  ok?: boolean;
  encerradas?: number;    // inscrições que passaram para "stopped"
  contatos?: number;      // pessoas realmente afetadas
  tarefas?: number;       // toques pendentes cancelados
  semCadencia?: number;   // selecionados que não estavam em cadência nenhuma
  truncado?: boolean;
  teto?: number;
  selecionados?: number;
  error?: string;
};

export async function desinscreverLote(
  contactIds: string[],
  sequenceId?: string | null
): Promise<ResDesinscrever> {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!contactIds?.length) return { error: "Nenhum contato selecionado." };

  const ids = Array.from(new Set(contactIds.filter(Boolean))).slice(0, TETO_INSCRICAO);
  const truncado = contactIds.length > ids.length;

  try {
    // ---------- 1) quais inscrições estão de pé, em fatias ----------
    const inscricoes: { id: string; contact_id: string; sequence_id: string }[] = [];
    for (let i = 0; i < ids.length; i += FATIA_CONSULTA) {
      let q = supabase
        .from("enrollments")
        .select("id, contact_id, sequence_id")
        .eq("tenant_id", tenant_id)
        .in("status", ["active", "paused"])
        .in("contact_id", ids.slice(i, i + FATIA_CONSULTA));
      if (sequenceId) q = q.eq("sequence_id", sequenceId);
      const { data, error } = await q;
      // erro aqui NÃO pode virar "[]": encerraria zero e a tela diria "pronto"
      if (error) return { error: msgErro(error) };
      inscricoes.push(...((data as any[]) || []));
    }

    const contatosAfetados = new Set(inscricoes.map((e) => e.contact_id));
    const semCadencia = ids.length - contatosAfetados.size;

    if (!inscricoes.length) {
      return {
        ok: true, encerradas: 0, contatos: 0, tarefas: 0,
        semCadencia, truncado, teto: TETO_INSCRICAO, selecionados: ids.length,
      };
    }

    const enrIds = inscricoes.map((e) => e.id);

    // ---------- 2) conta os toques pendentes ANTES de cancelar ----------
    // Depois do update eles já não são "pending" — contar depois devolveria zero e o
    // relatório diria "nenhum toque cancelado" justamente quando cancelou centenas.
    let tarefas = 0;
    for (let i = 0; i < enrIds.length; i += FATIA_CONSULTA) {
      const { count, error } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .in("enrollment_id", enrIds.slice(i, i + FATIA_CONSULTA));
      if (error) return { error: msgErro(error) };
      tarefas += count ?? 0;
    }

    // ---------- 3) cancela as tarefas, depois encerra as inscrições ----------
    // Nesta ordem de propósito: se parar no meio, sobra inscrição ativa sem tarefa
    // (visível e corrigível) em vez de tarefa órfã disparando de cadência encerrada.
    for (let i = 0; i < enrIds.length; i += FATIA_CONSULTA) {
      const fatia = enrIds.slice(i, i + FATIA_CONSULTA);
      const { error: errT } = await supabase
        .from("tasks")
        .update({ status: "skipped" })
        .eq("status", "pending")
        .in("enrollment_id", fatia);
      if (errT) return { error: msgErro(errT) };
    }

    let encerradas = 0;
    for (let i = 0; i < enrIds.length; i += FATIA_CONSULTA) {
      const fatia = enrIds.slice(i, i + FATIA_CONSULTA);
      const { data, error: errE } = await supabase
        .from("enrollments")
        .update({ status: "stopped" })
        .in("id", fatia)
        .select("id");
      if (errE) return { error: msgErro(errE) };
      encerradas += ((data as any[]) || []).length;
    }

    let nomeCad = "todas as cadências";
    if (sequenceId) {
      const { data: seq } = await supabase.from("sequences").select("name").eq("id", sequenceId).maybeSingle();
      nomeCad = `a cadência "${(seq?.name as string) || "?"}"`;
    }
    await logAction(supabase, {
      tenant_id, user_id,
      action: "contact_unenroll_bulk", entity: "contact", entity_id: sequenceId || null,
      qtd: encerradas,
      detail:
        `Tirou ${contatosAfetados.size} contato(s) de ${nomeCad}: ${encerradas} inscrição(ões) encerrada(s) ` +
        `e ${tarefas} toque(s) pendente(s) cancelado(s).`,
      meta: {
        cadencia: sequenceId ? nomeCad : null, encerradas, contatos: contatosAfetados.size,
        tarefas, semCadencia, selecionados: ids.length,
      },
    });

    revalidatePath("/dashboard/contatos");
    revalidatePath("/dashboard");
    return {
      ok: true, encerradas, contatos: contatosAfetados.size, tarefas,
      semCadencia, truncado, teto: TETO_INSCRICAO, selecionados: ids.length,
    };
  } catch (e: any) {
    return { error: msgErro(e) };
  }
}

export async function bulkEnroll(contactIds: string[], sequenceId: string): Promise<ResEnroll> {
  const { supabase, tenant_id, user_id } = await ctx();
  if (!tenant_id) return { error: "Sem workspace." };
  if (!contactIds?.length) return { error: "Nenhum contato selecionado." };
  if (!sequenceId) return { error: "Escolha a cadência." };

  const ids = Array.from(new Set(contactIds.filter(Boolean))).slice(0, TETO_INSCRICAO);
  const truncado = contactIds.length > ids.length;

  const { renderTemplate, addDaysISO, channelLabel } = await import("@/lib/cadence");
  const { poolDeCaixas, sortearCaixa } = await import("@/lib/caixas");

  try {
    // ---------- 1) passos da cadência (uma vez) ----------
    const { data: steps, error: errSteps } = await supabase
      .from("sequence_steps")
      // `*`: `body_variants` nasce na 0111 e, pedida pelo nome, derrubaria a inscrição
      // em lote inteira enquanto a migration não estivesse aplicada.
      .select("*")
      .eq("sequence_id", sequenceId)
      .order("position", { ascending: true });
    if (errSteps) return { error: msgErro(errSteps) };
    if (!steps?.length) return { error: "Esta cadência não tem nenhum passo. Adicione os passos antes de inscrever." };

    // ---------- 2) pool de caixas (uma vez) ----------
    const pool = await poolDeCaixas(supabase, tenant_id, sequenceId);

    // ---------- 3) contatos, em fatias ----------
    const contatos: any[] = [];
    for (let i = 0; i < ids.length; i += FATIA_CONSULTA) {
      const { data, error } = await supabase
        .from("contacts")
        // select("*"): `instagram`/`linkedin` nascem na 0110. Pedidas pelo nome, elas
        // derrubariam a INSCRIÇÃO inteira enquanto a migration não estivesse aplicada.
        .select("*")
        .eq("tenant_id", tenant_id)
        .in("id", ids.slice(i, i + FATIA_CONSULTA));
      if (error) return { error: msgErro(error) };
      contatos.push(...((data as any[]) || []));
    }

    // ---------- 4) quem JÁ está nesta cadência, em fatias ----------
    const jaTem = new Set<string>();
    for (let i = 0; i < ids.length; i += FATIA_CONSULTA) {
      const { data, error } = await supabase
        .from("enrollments")
        .select("contact_id")
        .eq("tenant_id", tenant_id)
        .eq("sequence_id", sequenceId)
        .in("status", ["active", "paused"])
        .in("contact_id", ids.slice(i, i + FATIA_CONSULTA));
      if (error) return { error: msgErro(error) };
      for (const e of ((data as any[]) || [])) jaTem.add(e.contact_id);
    }

    // ---------- 5) classifica (em memória, sem tocar o banco) ----------
    const elegiveis: any[] = [];
    let semDado = 0, jaInscrito = 0, suprimidos = 0;
    // contado à parte de propósito: "sem dado" e "o número não tem WhatsApp" pedem
    // ações diferentes — uma é cadastro incompleto, a outra é caçar outro número.
    let semWhatsapp = 0;

    // ============================================================
    // GATE DE DADO POR CANAL
    //
    // Um passo só vira tarefa se o contato TEM o dado daquele canal. Sem isso, a fila
    // encheria de tarefas impossíveis — e a pessoa gastaria o dia clicando em "pular".
    //
    // `instagram` e `linkedin` entram aqui pelo mesmo motivo dos outros: sem o perfil
    // não existe link para abrir, e o toque assistido não tem para onde ir.
    // ============================================================
    //
    // WHATSAPP TEM UMA CONDIÇÃO A MAIS: ter telefone não basta. Quando a verificação
    // (ou o próprio envio) já perguntou ao WhatsApp e a resposta foi "não existe", a
    // tarefa criada aqui só serve para dar erro no dia do disparo. Ligação continua
    // valendo — o número existe, só não serve para ESTE canal.
    const podeCanal = (
      ch: string,
      temEmail: boolean,
      temFone: boolean,
      temIg = false,
      temLi = false,
      temWa = true
    ) =>
      ch === "email" ? temEmail
      : ch === "whatsapp" ? temFone && temWa
      : ch === "call" ? temFone
      : ch === "instagram" ? temIg
      : ch === "linkedin" ? temLi
      : true;

    for (const c of contatos) {
      if (c.opted_out) { suprimidos++; continue; }
      if (jaTem.has(c.id)) { jaInscrito++; continue; }
      const temEmail = !!String(c.email || "").trim();
      const temFone = !!String(c.phone || "").trim();
      const temIg = !!String((c as any).instagram || "").trim();
      const temLi = !!String((c as any).linkedin || "").trim();
      const temWa = (c as any).wa_status !== "invalid";
      if (!steps.some((s: any) => podeCanal(s.channel, temEmail, temFone, temIg, temLi, temWa))) {
        if (!temWa && temFone) semWhatsapp++;
        else semDado++;
        continue;
      }
      elegiveis.push({ ...c, temEmail, temFone, temIg, temLi, temWa });
    }
    // contato que sumiu entre a seleção e agora
    const sumidos = ids.length - contatos.length;

    if (!elegiveis.length) {
      return {
        ok: true, enrolled: 0, semDado, semWhatsapp, jaInscrito,
        outros: suprimidos + Math.max(0, sumidos),
        suprimidos, truncado, teto: TETO_INSCRICAO, selecionados: ids.length,
      };
    }

    // ---------- 6) inscrições em lote ----------
    const inscricoes = new Map<string, string>();   // contact_id → enrollment_id
    for (let i = 0; i < elegiveis.length; i += LOTE_INSERT) {
      const bloco = elegiveis.slice(i, i + LOTE_INSERT);
      const linhas = bloco.map((c) => ({
        tenant_id, contact_id: c.id, sequence_id: sequenceId,
        assigned_to: (c.assigned_to as string) || user_id, status: "active",
      }));
      const { data, error } = await supabase.from("enrollments").insert(linhas).select("id, contact_id");
      if (!error) {
        for (const e of ((data as any[]) || [])) inscricoes.set(e.contact_id, e.id);
        continue;
      }
      // Colisão com o índice único (alguém inscreveu o mesmo contato no meio do caminho):
      // cai para um-a-um, para que UMA colisão não derrube o bloco inteiro.
      for (const c of bloco) {
        const { data: um, error: e1 } = await supabase
          .from("enrollments")
          .insert({ tenant_id, contact_id: c.id, sequence_id: sequenceId, assigned_to: (c.assigned_to as string) || user_id, status: "active" })
          .select("id, contact_id").maybeSingle();
        if (!e1 && um) inscricoes.set((um as any).contact_id, (um as any).id);
        else jaInscrito++;
      }
    }

    // ---------- 7) tarefas em lote ----------
    const hoje = new Date();
    const tarefas: any[] = [];
    for (const c of elegiveis) {
      const enrollment_id = inscricoes.get(c.id);
      if (!enrollment_id) continue;               // não conseguiu inscrever
      const caixa = sortearCaixa(pool);           // sorteio POR CONTATO
      const assigned = (c.assigned_to as string) || user_id;
      let offset = 0;
      for (const s of steps as any[]) {
        // o cronograma acumula sobre TODOS os passos; só vira tarefa o passo elegível
        offset += Number(s.delay_days) || 0;
        if (!podeCanal(s.channel, c.temEmail, c.temFone, c.temIg, c.temLi, c.temWa)) continue;
        const temB = s.channel === "email" && s.subject_b && String(s.subject_b).trim();
        const variante = temB ? (Math.random() < 0.5 ? "a" : "b") : null;
        const assunto = variante === "b" ? s.subject_b : s.subject;
        // a redação deste passo PARA ESTE CONTATO: contatos vizinhos na lista caem em
        // variações diferentes, que é o que o motor do WhatsApp observa
        const redacoes = variacoesDoPasso(s.body_template, (s as any).body_variants);
        const escolha = escolherVariacao(redacoes, `${c.id}:${s.position}`);
        tarefas.push({
          tenant_id, enrollment_id, contact_id: c.id, assigned_to: assigned,
          channel: s.channel,
          title: renderTemplate(assunto, c) || (channelLabel as any)[s.channel],
          generated_content: renderTemplate(escolha.texto || s.body_template, c),
          body_variant: escolha.indice,
          condicao: normalizarCondicao((s as any).condicao),
          due_date: addDaysISO(hoje, offset),
          status: "pending",
          step_position: s.position,
          subject_variant: variante,
          email_account_id: s.channel === "email" ? caixa : null,
        });
      }
    }

    // inserirTarefas tolera a 0111 ainda não aplicada: a primeira tentativa leva
    // `body_variant`, e se o banco não conhecer a coluna a segunda vai sem ela. Sem
    // isso, o PostgREST recusaria o insert INTEIRO e a inscrição em lote ficaria sem
    // tarefa nenhuma — o mesmo estrago do PGRST204 nos eventos.
    const { inserirTarefas } = await import("@/lib/inserirTarefas");
    const rTarefas = await inserirTarefas(supabase, tarefas);
    const falhaTarefas: string | null = rTarefas.error ? msgErro(rTarefas.error) : null;

    // Inscrição sem tarefa é pior que inscrição nenhuma: o contato aparece "em cadência"
    // e não recebe nada. Se as tarefas falharam, desfazemos as inscrições deste lote.
    if (falhaTarefas) {
      const criadas = [...inscricoes.values()];
      for (let i = 0; i < criadas.length; i += FATIA_CONSULTA) {
        await supabase.from("enrollments").delete().in("id", criadas.slice(i, i + FATIA_CONSULTA));
      }
      return { error: `Não consegui criar as tarefas (${falhaTarefas}). Nenhum contato foi inscrito — nada ficou pela metade.` };
    }

    const enrolled = inscricoes.size;
    const { data: seq } = await supabase.from("sequences").select("name").eq("id", sequenceId).maybeSingle();
    await logAction(supabase, {
      tenant_id, user_id,
      action: "contact_enroll_bulk", entity: "contact", entity_id: sequenceId, qtd: enrolled,
      detail:
        `Inscreveu ${enrolled} de ${ids.length} contato(s) na cadência "${(seq?.name as string) || "?"}" ` +
        `(${tarefas.length} tarefa(s) criadas)` +
        (semDado || semWhatsapp || jaInscrito || suprimidos
          ? ` — ${[semDado ? `${semDado} sem e-mail/telefone` : "", semWhatsapp ? `${semWhatsapp} sem WhatsApp` : "", jaInscrito ? `${jaInscrito} já inscritos` : "", suprimidos ? `${suprimidos} suprimidos` : ""].filter(Boolean).join(", ")}`
          : "") + ".",
      meta: { cadencia: seq?.name || null, enrolled, semDado, semWhatsapp, jaInscrito, suprimidos, tarefas: tarefas.length, selecionados: ids.length },
    });

    revalidatePath("/dashboard/contatos");
    revalidatePath("/dashboard");
    return {
      ok: true, enrolled, semDado, semWhatsapp, jaInscrito, suprimidos,
      outros: suprimidos + Math.max(0, sumidos),
      tarefas: tarefas.length, truncado, teto: TETO_INSCRICAO, selecionados: ids.length,
    };
  } catch (e: any) {
    return { error: msgErro(e) };
  }
}

