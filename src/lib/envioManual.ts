import "server-only";

// ============================================================
// CAPTURAR O QUE VOCÊ ENVIOU NA MÃO
//
// No modo híbrido (e no assistido com número conectado) o primeiro toque sai pelo link:
// você abre o WhatsApp e manda. O app só não ficava sabendo — a tarefa continuava
// pendente, o histórico do contato não registrava o toque, o limite do dia não contava,
// e a conversa na caixa de Respostas mostrava só o lado de lá.
//
// A sessão vinculada já recebe o evento `fromMe` de graça, tenha o envio saído do
// celular ou do web.whatsapp.com. Este módulo transforma esse eco em registro.
//
// TRÊS TRAVAS, e todas importam:
//
//  1. SÓ CONTATO CONHECIDO. Quem tem WhatsApp conectado conversa com família, banco e
//     grupo de escola pelo mesmo número. Nada disso pode entrar no CRM. Se o telefone
//     não casar com um contato do workspace, a mensagem é descartada — nem gravada.
//
//  2. IDEMPOTÊNCIA POR wa_message_id. A Evolution reentrega evento; sem isso, uma
//     tarefa concluída viraria dois eventos e o limite diário passaria a mentir.
//
//  3. JANELA DE 10 MINUTOS POR TELEFONE+TEXTO. No modo automático o próprio app já
//     gravou a linha de saída (sem wa_message_id, ver task-actions) e logo em seguida
//     o eco chega pelo webhook. Só o id não resolve esse caso — os dois registros são
//     da MESMA mensagem, com origens diferentes.
//
// A pontuação é exatamente a de quem envia pela tela: `whatsapp_sent` vale 0 (enviar
// não é sinal de interesse — o score é do engajamento DELE) e `task_done` vale os
// mesmos 2 pontos de marcar a tarefa como feita na mão.
// ============================================================

const digitos = (s: any) => String(s || "").replace(/\D/g, "");

type Entrada = {
  tenantId: string;
  accountId: string;
  phone: string;
  text: string;
  waId?: string | null;
  raw?: any;
};

type Saida = {
  gravado?: boolean;
  duplicado?: boolean;
  ignorado?: string;
  tarefaConcluida?: boolean;
};

export async function capturarEnvioManual(admin: any, e: Entrada): Promise<Saida> {
  const ultimos10 = digitos(e.phone).slice(-10);
  if (ultimos10.length < 8) return { ignorado: "telefone curto demais para casar" };

  // ---- 1) é alguém da base? ----
  const { data: candidatos } = await admin
    .from("contacts")
    .select("id, phone")
    .eq("tenant_id", e.tenantId)
    .eq("phone_digits", ultimos10)
    .limit(5);

  const lista = ((candidatos as any[]) || []);
  let contato: { id: string } | null = null;
  if (lista.length === 1) contato = lista[0];
  else if (lista.length > 1) {
    // ambíguo: só aceita o casamento EXATO. Na dúvida não grava — escrever no
    // histórico do contato errado é pior do que não escrever em nenhum.
    const cheio = digitos(e.phone);
    contato = lista.find((c) => digitos(c.phone || "") === cheio) || null;
  }
  if (!contato) return { ignorado: "número fora da base (conversa pessoal não entra no CRM)" };

  // ---- 2) já registrado? ----
  if (e.waId) {
    const { data: existe } = await admin
      .from("whatsapp_messages")
      .select("id")
      .eq("tenant_id", e.tenantId)
      .eq("wa_message_id", e.waId)
      .maybeSingle();
    if (existe) return { duplicado: true };
  }

  const dezMinAtras = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recentes } = await admin
    .from("whatsapp_messages")
    .select("id, text")
    .eq("tenant_id", e.tenantId)
    .eq("contact_id", contato.id)
    .eq("direction", "out")
    .gte("created_at", dezMinAtras)
    .limit(20);
  const mesmoTexto = ((recentes as any[]) || []).some(
    (m) => String(m.text || "").trim() === String(e.text || "").trim()
  );
  if (mesmoTexto) return { duplicado: true };

  // ---- 3) grava a saída ----
  const { error: erroIns } = await admin.from("whatsapp_messages").insert({
    tenant_id: e.tenantId,
    account_id: e.accountId,
    contact_id: contato.id,
    phone: digitos(e.phone),
    direction: "out",
    text: e.text || "",
    wa_message_id: e.waId || null,
    raw: e.raw || {},
  });
  // corrida com o índice único: outro processo gravou primeiro, e está certo assim
  if (erroIns) return { duplicado: true };

  // ---- 4) fecha a tarefa de WhatsApp mais antiga que estava esperando ----
  //
  // Uma só, a mais antiga: se há duas pendentes para o mesmo contato, uma mensagem
  // enviada não fez as duas. Fechar de mais é pior do que deixar uma para a mão.
  let tarefaConcluida = false;
  const { data: pendentes } = await admin
    .from("tasks")
    .select("id")
    .eq("tenant_id", e.tenantId)
    .eq("contact_id", contato.id)
    .eq("channel", "whatsapp")
    .eq("status", "pending")
    .order("due_date", { ascending: true })
    .limit(1);
  const tarefa = ((pendentes as any[]) || [])[0];
  if (tarefa) {
    // `.eq("status","pending")` no UPDATE: se o operador marcou como feita no mesmo
    // segundo, quem chegou primeiro vence e não geramos um segundo evento.
    const { data: fechada } = await admin
      .from("tasks")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", tarefa.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    tarefaConcluida = !!fechada;
  }

  // ---- 5) histórico + último toque ----
  // scoreEvent (e não insert direto): é ele que sabe gravar o autor e que tolera a
  // coluna user_id ainda não existir. Sem autor: quem enviou foi o celular, não a tela.
  const { scoreEvent } = await import("@/lib/scoring");
  await scoreEvent(admin, {
    tenant_id: e.tenantId,
    contact_id: contato.id,
    type: "whatsapp_sent",
    meta: { manual: true, texto: String(e.text || "").slice(0, 280) },
  });
  if (tarefaConcluida) {
    await scoreEvent(admin, { tenant_id: e.tenantId, contact_id: contato.id, type: "task_done", meta: { manual: true } });
  }
  // o `last_activity_at` já é carimbado pelo scoreEvent — não repetir a escrita aqui

  return { gravado: true, tarefaConcluida };
}
