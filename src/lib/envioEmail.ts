import "server-only";

// ============================================================
// O MOTOR DE ENVIO DE E-MAIL — um só, para os três caminhos
//
// Este arquivo existia dentro de task-actions.ts ("use server"). Ele saiu de lá quando
// o envio automático (o cron da fila) precisou do mesmo motor: num arquivo "use server"
// TODA função exportada vira uma server action chamável pelo navegador — e exportar
// `enviarUm` significaria deixar o cliente mandar um `lote` FORJADO, com uma capacidade
// inventada, furando o limite diário e o teto por hora do próprio workspace.
//
// Aqui, fora do "use server", o motor é importável pelo servidor e invisível para o
// cliente. Os três caminhos que o usam:
//   · a ação de enviar UMA tarefa (fila / ficha);
//   · o "Enviar todos" e o "Enviar marcadas" (lote com conexões reaproveitadas);
//   · o cron `fila-envio`, que roda sem ninguém logado.
//
// A SESSÃO É INJETADA (`lote.sessao`). Sem sessão, o motor usa o usuário logado e a RLS
// resolve o escopo. COM sessão (o cron, com client admin), a RLS não existe — e por
// isso todas as consultas daqui são explicitamente presas ao tenant. Sem esse cuidado,
// um `select` sem filtro alcançaria a CAIXA DE OUTRO CLIENTE: o e-mail sairia com o
// remetente errado, para o lead errado, e nada daria erro.
// ============================================================

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { scoreEvent } from "@/lib/scoring";
import { renderTemplate } from "@/lib/cadence";
import { buildEmailHtml } from "@/lib/richtext";

export type Sessao = { supabase: any; tenant_id: string | null; user_id?: string | null };

// A sessão do usuário logado (o caminho de sempre). O cron entrega a sua própria.
async function sessaoDoUsuario(): Promise<Sessao> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id ?? "").maybeSingle();
  return { supabase, tenant_id: (data?.tenant_id as string) || null, user_id: user?.id };
}

// ============================================================
// CONTEXTO DE LOTE — o que não faz sentido refazer 200 vezes
//
// Enviando um a um, cada e-mail repetia: 2 consultas de capacidade, 1 da assinatura do
// workspace, e um aperto de mão SMTP inteiro. Somado, dava ~4 segundos por mensagem —
// e o lote, com 40 segundos de orçamento, entregava 10. O contexto carrega o que é
// igual para todas as mensagens da volta e mantém a conexão aberta.
//
// A capacidade é a única parte delicada: ela precisa ANDAR durante o lote, senão as
// 200 mensagens leriam "folga 80" e passariam do limite. Por isso `usadosNoLote`.
// ============================================================
export type ContextoLote = {
  cap: Awaited<ReturnType<typeof import("@/lib/capacidadeEmail").capacidadeDeHoje>>;
  usadosNoLote: Record<string, number>;
  transportes: Map<string, any>;
  // sessão de "Enviados" por caixa, aberta na primeira cópia e reaproveitada.
  // `null` = já tentamos abrir e não deu — não insiste a cada mensagem.
  imap: Map<string, any>;
  assinaturaTenant?: string | null;
  // QUEM ESTÁ ENVIANDO. Ausente = o usuário logado, e a RLS resolve o escopo. Presente =
  // client admin com tenant explícito, que é como o cron roda. Este campo NUNCA pode vir
  // do navegador — é por isso que este tipo mora fora de qualquer arquivo "use server".
  sessao?: Sessao;
  // ONDE O TEMPO VAI. Duas respostas minhas sobre este problema foram palpite (o
  // limite da caixa, depois o SMTP). Medido, deixa de ser palpite.
  tempos: { banco: number; smtp: number; copia: number };
};

// Abre (uma vez por caixa) a sessão de "Enviados" do lote. Caixa que grava a cópia
// sozinha no servidor — Gmail, Outlook.com — não entra aqui: o APPEND criaria duplicata.
async function sessaoEnviadosDoLote(lote: ContextoLote, acct: any) {
  if (acct.provider === "gmail" || acct.save_to_sent === false) return undefined;
  if (lote.imap.has(acct.id)) {
    const s = lote.imap.get(acct.id);
    return s ? (raw: Buffer) => s.append(raw) : undefined;
  }
  const { abrirEnviados } = await import("@/lib/imap");
  const s = await abrirEnviados(acct);
  if ((s as any)?.append) {
    lote.imap.set(acct.id, s);
    return (raw: Buffer) => (s as any).append(raw);
  }
  lote.imap.set(acct.id, null);   // não tenta de novo a cada mensagem
  return undefined;
}

export async function enviarUm(
  taskId: string,
  override?: { subject?: string; body?: string },
  lote?: ContextoLote
) {
  const tInicio = Date.now();
  const { sendEmail } = await import("@/lib/mailer");
  const { supabase, tenant_id, user_id } = lote?.sessao ?? (await sessaoDoUsuario());
  if (!tenant_id) return { error: "Sem workspace." };

  // se veio corpo/assunto editado, persiste na task antes de enviar
  if (override && (override.subject !== undefined || override.body !== undefined)) {
    const patch: Record<string, unknown> = {};
    if (override.subject !== undefined) patch.title = override.subject;
    if (override.body !== undefined) patch.generated_content = override.body;
    if (Object.keys(patch).length) {
      // `body_editado` (0112): texto escrito por gente não pode ser sobrescrito pela
      // reaplicação do texto da cadência. Se a coluna ainda não existe, grava sem ela —
      // um PGRST204 aqui impediria o próprio envio.
      const { error } = await supabase.from("tasks").update({ ...patch, body_editado: true }).eq("id", taskId).eq("tenant_id", tenant_id);
      if (error && ((error as any).code === "PGRST204" || (error as any).code === "42703")) {
        await supabase.from("tasks").update(patch).eq("id", taskId).eq("tenant_id", tenant_id);
      }
    }
  }

  const { data: task } = await supabase
    .from("tasks")
    // enrollment_id/step_position entram aqui para o rastreio saber DE QUAL PASSO o
    // e-mail saiu — sem isso, "cliques e aberturas por passo" é impossível de montar
    // depois: a origem só é conhecida no momento do envio.
    .select("id, channel, title, generated_content, contact_id, email_account_id, enrollment_id, step_position, condicao, assigned_to, contacts(*)")
    .eq("id", taskId)
    // ESTA É A TRAVA DE TENANT do motor. Com o usuário logado ela é redundante (a RLS já
    // faz o mesmo); com o client admin do cron ela é a única coisa entre "enviar a
    // tarefa certa" e "enviar a tarefa de outro cliente pela caixa deste". Redundância
    // barata de um lado, imprescindível do outro.
    .eq("tenant_id", tenant_id)
    .single();
  if (!task) return { error: "Tarefa não encontrada." };
  if (task.channel !== "email") return { error: "Tarefa não é de e-mail." };

  // ============================================================
  // A ÚLTIMA PORTA ANTES DO DESTINATÁRIO
  //
  // As tarefas guardam o texto JÁ MONTADO. Quem foi criado enquanto o Radar produzia
  // nomes quebrados carrega "[object Object]" dentro do corpo, e nenhum conserto no
  // render alcança o que já está gravado. Só a checagem no envio alcança.
  //
  // Recusar é a escolha certa aqui: um e-mail que sai errado não volta, e o custo de
  // segurar é uma mensagem na tela para quem pode corrigir.
  // ============================================================
  {
    const { textoTemLixo, AVISO_LIXO } = await import("@/lib/nomeValido");
    if (textoTemLixo((task as any).title) || textoTemLixo((task as any).generated_content)) {
      return { error: AVISO_LIXO };
    }
  }
  // ---- PASSO CONDICIONAL: reconfere antes de mandar ----
  // O cron já limpa a fila do dia; isto é a rede para a janela entre uma coisa e outra
  // (e para quem dispara uma tarefa de amanhã pela ficha).
  if ((task as any).condicao) {
    const { avaliarCondicao, rotuloCondicao } = await import("@/lib/condicoes");
    const r = await avaliarCondicao(supabase, (task as any).condicao, {
      contactId: (task as any).contact_id,
      enrollmentId: (task as any).enrollment_id,
      contato: (task as any).contacts || {},
    });
    if (!r.ok) {
      await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId).eq("status", "pending");
      return { error: `Passo condicional (${rotuloCondicao((task as any).condicao)}): ${r.motivo}. Toque pulado.` };
    }
  }

  const to = (task as any).contacts?.email as string | undefined;
  if (!to) {
    // contato sem e-mail: pula a tarefa (não fica pendente para sempre) — cobre também
    // tarefas criadas antes do gate de inscrição.
    await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId);
    return { error: "Contato sem e-mail. Tarefa de e-mail pulada." };
  }

  // não envia para e-mail marcado como inválido/bounce (protege reputação)
  const estatus = (task as any).contacts?.email_status as string | undefined;
  if (estatus && ["invalid", "hard_bounce", "complaint"].includes(estatus)) {
    await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId);
    return { error: `E-mail marcado como "${estatus}". Envio bloqueado para proteger sua reputação.` };
  }

  // proteção de reputação: não envia para e-mail suprimido (bounce/spam/unsubscribe)
  const { data: supp } = await supabase
    .from("email_suppressions")
    .select("reason")
    .eq("tenant_id", tenant_id)
    .eq("email", to.toLowerCase())
    .maybeSingle();
  if (supp) {
    // marca a task como pulada para não insistir e proteger o domínio
    await supabase.from("tasks").update({ status: "skipped" }).eq("id", taskId);
    return { error: `E-mail na lista de supressão (${(supp as any).reason}). Envio bloqueado para proteger sua reputação.` };
  }

  // ROTAÇÃO DE CAIXAS: quem sabe quanto cada caixa ainda pode enviar hoje é
  // capacidadeDeHoje — a MESMA conta que o relatório do lote mostra na tela. Antes esta
  // conta morava aqui dentro e a tela tinha a sua; quando as duas discordassem, o
  // operador leria uma capacidade que o envio não honra.
  const { capacidadeDeHoje } = await import("@/lib/capacidadeEmail");
  // `tenant_id` explícito: sem ele, o client admin do cron listaria as caixas de TODOS
  // os workspaces e o rodízio poderia escolher a caixa de outro cliente.
  const cap = lote?.cap ?? (await capacidadeDeHoje(supabase, tenant_id));
  const accts = cap.contas;
  if (!accts.length) {
    return { error: "Nenhuma caixa de e-mail conectada. Cadastre a sua em Configurações → Canais." };
  }
  const anyWarming = cap.algumaAquecendo;

  // ============================================================
  // TETO POR HORA DO WORKSPACE (0114)
  //
  // O teto de cada caixa já está embutido em `folga` (capacidadeEmail faz o menor entre
  // dia e hora). O que sobra para cá é o teto SOMADO — várias caixas no mesmo cPanel
  // dividem o mesmo limite do servidor, e nenhuma delas sozinha percebe isso.
  //
  // `usadosNoLote` entra na conta pelo mesmo motivo do limite diário: sem descontar o
  // que já saiu NESTA volta, as 200 mensagens leriam a folga do começo e passariam
  // direto pelo teto — que é justamente o estado que faz o provedor cortar a conexão.
  // ============================================================
  const usadosNoLoteTotal = Object.values(lote?.usadosNoLote || {}).reduce((s, n) => s + n, 0);
  if (cap.folgaHoraGeral != null && cap.folgaHoraGeral - usadosNoLoteTotal <= 0) {
    const { quandoTexto } = await import("@/lib/janelaEnvio");
    const quando = cap.liberaEm ? quandoTexto(new Date(cap.liberaEm)) : "em até 60 minutos";
    return {
      error:
        `Limite por hora do workspace atingido (${cap.capHoraGeral}/h, ${cap.usadosHora} nos últimos 60 min). ` +
        `Abre espaço ${quando} — a fila continua daí.`,
      travaHora: true,
      liberaEm: cap.liberaEm,
    };
  }

  const folgaPorId = new Map(cap.porCaixa.map((c) => [c.conta.id as string, c.folga]));
  // desconta o que JÁ saiu nesta volta: sem isto o lote leria a folga do começo em
  // todas as mensagens e passaria direto pelo limite diário.
  const folgaDe = (a: any) => (folgaPorId.get(a.id) ?? 0) - (lote?.usadosNoLote[a.id] || 0);

  // ESCOLHA POR CAMADAS: minha → do workspace → emprestada (ver lib/caixas).
  //
  // Antes isto era "a caixa com maior folga", sem olhar de quem ela é. Numa equipe isso
  // fazia um gestor sem caixa própria enviar pela caixa PESSOAL de outra pessoa, só
  // porque ela era a mais nova e portanto a mais vazia — o destinatário via o endereço
  // da colega e a resposta caía na caixa dela.
  const { escolherCaixa } = await import("@/lib/caixas");
  // Sem usuário logado (cron), a identidade que vale é a de QUEM É DONO DO TOQUE. Sem
  // isso, a camada "minha caixa" nunca casaria e o envio automático de quem só tem
  // caixa pessoal (não compartilhada) simplesmente não encontraria remetente.
  const identidade = user_id || ((task as any).assigned_to as string | undefined) || undefined;
  const escolha = escolherCaixa(accts as any[], folgaDe, identidade);
  let acct: any = escolha.caixa;
  let bestSlack = escolha.folga;

  // CAIXA DESIGNADA (produto/cadência): se a tarefa foi carimbada com uma caixa e
  // ela está ativa e com folga hoje, envia POR ELA (mantém a marca certa). Se estiver
  // inativa ou sem folga, cai no rodízio acima (degradação segura — o e-mail sai).
  const desiredBoxId = (task as any).email_account_id as string | null;
  if (desiredBoxId) {
    const d = (accts as any[]).find((a) => a.id === desiredBoxId);
    if (d) {
      const dSlack = folgaDe(d);
      if (dSlack > 0) { acct = d; bestSlack = dSlack; }
    }
  }

  if (!acct || bestSlack <= 0) {
    // ESPERAR MINUTOS OU ESPERAR UM DIA são respostas diferentes, e por muito tempo a
    // mesma frase ("tente amanhã") cobriu as duas. Quando o freio é a hora, a caixa
    // ainda tem dia sobrando — mandar a pessoa embora seria perder a tarde inteira.
    if (cap.travadoPorHora) {
      const { quandoTexto } = await import("@/lib/janelaEnvio");
      const quando = cap.liberaEm ? quandoTexto(new Date(cap.liberaEm)) : "em até 60 minutos";
      const presas = cap.porCaixa.filter((c) => c.freio === "hora");
      return {
        error:
          `Limite por hora atingido${presas.length === 1 ? ` em ${presas[0].email} (${presas[0].usadosHora}/${presas[0].capHora} na última hora)` : " nas caixas disponíveis"}. ` +
          `Abre espaço ${quando} — ainda há ${cap.folgaDia} envio(s) no limite de hoje.`,
        travaHora: true,
        liberaEm: cap.liberaEm,
      };
    }
    return { error: anyWarming
      ? "Limite de envio de hoje atingido em todas as caixas (algumas ainda em aquecimento). Tente amanhã ou conecte outra caixa."
      : "Limite diário atingido em todas as caixas (Envio Seguro). Tente amanhã ou conecte outra caixa." };
  }

  // ---- RASTREIO: links + pixel de abertura, ambos atribuídos ao passo ----
  let bodyText = task.generated_content || "";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL ? (process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`) : "";
  // a cadência de onde veio a tarefa (para o relatório por passo)
  let sequenceId: string | null = null;
  if ((task as any).enrollment_id) {
    const { data: enr } = await supabase
      .from("enrollments").select("sequence_id").eq("id", (task as any).enrollment_id).eq("tenant_id", tenant_id).maybeSingle();
    sequenceId = ((enr as any)?.sequence_id as string) || null;
  }
  const atribuicao = {
    tenantId: tenant_id,
    contactId: (task as any).contact_id ?? null,
    enrollmentId: (task as any).enrollment_id ?? null,
    sequenceId,
    taskId: (task as any).id ?? null,
    stepPosition: (task as any).step_position ?? null,
  };
  // ORDEM IMPORTA: primeiro a etiqueta {{documento:…}} vira um link /s/{token}, e só
  // depois o wrapLinks passa. Invertido, o wrapLinks embrulharia o link da proposta
  // num /l/ e o clique deixaria de contar como ABERTURA de proposta (doc_opened) —
  // trocaria o sinal forte pelo fraco.
  try {
    if (baseUrl) {
      const { expandirDocumentos, temTagDocumento } = await import("@/lib/docLink");
      if (temTagDocumento(bodyText)) {
        bodyText = await expandirDocumentos(supabase, atribuicao, bodyText, baseUrl);
      }
    }
  } catch {
    /* link de documento não deve bloquear o envio */
  }
  try {
    if (baseUrl) {
      const { wrapLinks } = await import("@/lib/linktrack");
      bodyText = await wrapLinks(supabase, { ...atribuicao, body: bodyText, baseUrl });
    }
  } catch {
    /* rastreio de link não deve bloquear o envio */
  }

  // assinatura do negócio (renderiza {{primeiro_nome}}/{{empresa}} com os dados do contato)
  const tnt = lote && lote.assinaturaTenant !== undefined
    ? { email_signature: lote.assinaturaTenant }
    // `.eq("id", tenant_id)`: sem RLS (cron), um maybeSingle() sem filtro traz UMA linha
    // qualquer de tenants — e a assinatura de outro cliente iria no rodapé do e-mail.
    : ((await supabase.from("tenants").select("email_signature").eq("id", tenant_id).maybeSingle()).data as any);
  // assinatura DA CAIXA que enviou; se vazia, cai na assinatura geral do workspace
  const boxSig = (acct as any)?.signature as string | undefined;
  const signature = (boxSig && boxSig.trim()) ? boxSig : ((tnt as any)?.email_signature as string | undefined);
  const contact = (task as any).contacts || {};
  const sigRendered = signature?.trim() ? renderTemplate(signature, { name: contact.name, company: null, ...contact }) : "";
  // Monta o corpo final (corpo + assinatura), ciente de HTML: se o corpo OU a
  // assinatura tiverem formatação, vai como HTML; senão, texto puro (legado).
  const built = buildEmailHtml(bodyText, sigRendered);
  let html = built.html;

  // ---- PIXEL DE ABERTURA ----
  // Só em e-mail HTML. Converter um corpo de texto puro em HTML só para medir seria
  // piorar o e-mail em nome de um número fraco (ver a nota em @/lib/aberturas).
  if (html && baseUrl) {
    try {
      const { tagDePixel } = await import("@/lib/aberturas");
      const tag = await tagDePixel(supabase, atribuicao, baseUrl);
      if (tag) html = html.includes("</body>") ? html.replace("</body>", `${tag}</body>`) : html + tag;
    } catch {
      /* rastreio nunca impede o envio */
    }
  }
  bodyText = built.text;

  // ============================================================
  // RESERVA ANTES DE ENVIAR — a trava contra envio duplicado
  //
  // A ordem antiga era: envia → grava cópia em Enviados (até 8s) → marca a tarefa como
  // feita → registra o evento. Se a função morresse em qualquer ponto dessa janela, o
  // e-mail estava na rua e a tarefa continuava PENDENTE — então "Enviar todos" mandava
  // de novo, e de novo. E como o evento também não era gravado, o contador do dia não
  // subia: o limite diário ficava CEGO e nunca disparava.
  //
  // Agora a tarefa é RESERVADA antes do envio, numa atualização condicional
  // (`status = 'pending'`). Se duas execuções disputarem a mesma tarefa, só uma leva —
  // o banco decide. Se o envio falhar depois, devolvemos para pendente.
  //
  // Em e-mail, mandar duas vezes é pior do que não mandar. Por isso a reserva vem antes.
  // ============================================================
  const { data: reservada } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!reservada) {
    return { error: "Esta tarefa já foi enviada (ou está sendo enviada agora). Recarregue a fila." };
  }
  const devolverParaFila = async () => {
    await supabase.from("tasks").update({ status: "pending", completed_at: null }).eq("id", taskId);
  };

  let copia: { copiaEmEnviados?: boolean; erroCopia?: string; copiar?: () => Promise<any> } = {};
  const tSmtp = Date.now();
  if (lote) lote.tempos.banco += tSmtp - tInicio;
  try {
    copia = await sendEmail(
      acct as any,
      { to, subject: task.title || "", text: bodyText, html },
      {
        adiarCopia: true,           // a cópia sai do caminho crítico (ver mailer)
        transport: lote?.transportes.get((acct as any).id),
        gravarEnviados: lote ? await sessaoEnviadosDoLote(lote, acct) : undefined,
      }
    );
  } catch (e: any) {
    await devolverParaFila();
    const { msgSmtp } = await import("@/lib/caixas");
    const ehAuth = /535|534|Invalid login|Username and Password not accepted|authentication|Incorrect authentication/i.test(String(e?.message || ""));

    // Caixa que reprova no LOGIN é marcada como não validada. Sem isso ela continuaria
    // no rodízio e derrubaria todo envio que caísse nela — que foi como uma caixa
    // quebrada virou a remetente de todo mundo sem ninguém perceber. Marcada, ela sai
    // do rodízio (só volta se não houver alternativa) e fica VERMELHA em Config.
    if (ehAuth) {
      await supabase
        .from("email_accounts")
        .update({ verified: false, verified_at: new Date().toISOString() })
        .eq("id", (acct as any).id);
      revalidatePath("/dashboard/config");
    }
    return { error: msgSmtp(e, (acct as any).from_email) };
  }

  // REGISTRA O ENVIO IMEDIATAMENTE — antes de qualquer outra coisa que possa falhar.
  // É este registro que alimenta o limite diário; enquanto ele não existe, o envio é
  // invisível e o limite não conta. A janela de risco agora é uma consulta, não oito
  // segundos de IMAP.
  const reg = await scoreEvent(supabase, {
    tenant_id,
    contact_id: (task as any).contact_id,
    type: "email_sent",
    user_id,
    email_account_id: (acct as any).id,
    meta: { to },
  });

  if (lote) {
    lote.usadosNoLote[(acct as any).id] = (lote.usadosNoLote[(acct as any).id] || 0) + 1;
    lote.tempos.smtp += Date.now() - tSmtp;
  }

  // Agora sim a cópia em "Enviados" (best-effort, fora do caminho crítico).
  if (copia.copiar) {
    const tCopia = Date.now();
    try { copia = { ...(await copia.copiar()) }; } catch { /* nunca derruba o envio */ }
    if (lote) lote.tempos.copia += Date.now() - tCopia;
  }

  // A cópia em "Enviados" falhou por login/host de IMAP? Desliga para ESTA caixa.
  // Sem isso, cada envio pagaria a espera do IMAP de novo — e a pessoa está olhando
  // a tela. O aviso volta no retorno para ela saber por que a cópia parou de aparecer.
  let avisoCopia: string | undefined;
  if (copia.copiaEmEnviados === false && copia.erroCopia) {
    const permanente = /auth|login|denied|ENOTFOUND|EAI_AGAIN|certificate|Invalid credentials/i.test(copia.erroCopia);
    if (permanente) {
      await supabase.from("email_accounts").update({ save_to_sent: false }).eq("id", (acct as any).id);
      avisoCopia =
        `O e-mail saiu normalmente, mas não consegui gravar a cópia em "Enviados" (${copia.erroCopia}). ` +
        `Desliguei a cópia para esta caixa para não atrasar os próximos envios — confira host/porta de IMAP em Configurações → Canais.`;
    } else {
      avisoCopia = `O e-mail saiu normalmente, mas a cópia em "Enviados" não foi gravada desta vez (${copia.erroCopia}).`;
    }
  }

  // no lote, quem revalida é o final da volta — 200 revalidações não adiantam nada
  if (!lote) revalidatePath("/dashboard");
  // Envio sem registro é o pior estado possível: o limite diário deixa de contá-lo e a
  // pessoa perde a noção de quanto já mandou. Se acontecer, avisa alto.
  const avisoRegistro = reg?.ok === false
    ? `ATENÇÃO: o e-mail saiu, mas o registro do envio falhou (${reg.error}). Ele NÃO entra na contagem do dia nem no limite — confira o painel "Seus envios de hoje" antes de continuar.`
    : undefined;
  return { ok: true, aviso: [avisoRegistro, avisoCopia].filter(Boolean).join(" ") || undefined, caixa: (acct as any).from_email };
}
