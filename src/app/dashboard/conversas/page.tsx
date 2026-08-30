import { createClient } from "@/lib/supabase/server";
import ConversasPainel, { type ConversaLinha } from "@/components/ConversasPainel";
import { diaISO } from "@/lib/datas";

export const dynamic = "force-dynamic";

// ============================================================
// CONVERSAS — o estado, não o texto
//
// A caixa de Respostas mostra o QUE foi dito. Esta tela mostra COMO ESTÁ: quem conduz,
// há quanto tempo ele não responde, quantos follow-ups já foram, como terminou. São
// perguntas que a caixa de Respostas não responde porque ela é uma lista de mensagens,
// e a resposta está no estado — que até a 0116 não existia em lugar nenhum.
//
// É o F1 da espec do agente, e vale sozinho: dá para operar por aqui hoje, sem IA.
// Quando o motor entrar (F2), ele lê e escreve exatamente esta tabela.
// ============================================================

export default async function Conversas({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = createClient();
  const filtro = searchParams?.status || "";

  const { data: rows, error } = await supabase
    .from("agent_conversas")
    .select(
      "id, phone, status, contact_id, desfecho, etapa_atual, msgs_hoje, msgs_hoje_em, followups_sem_resposta, ultima_msg_em, ultima_msg_direcao, ultima_resposta_em, assumida_por, assumida_em, contacts(name)"
    )
    .order("ultima_msg_em", { ascending: false, nullsFirst: false })
    .limit(500);

  // MIGRATION AINDA NÃO APLICADA: a tela avisa em vez de estourar. Mesmo cuidado que a
  // caixa de Respostas toma com a 0107 — uma coluna que falta não pode virar erro
  // vermelho sem explicação.
  if (error) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold">Conversas</h1>
        <div className="card mt-6 p-6">
          <p className="font-semibold">Falta aplicar a migration 0116.</p>
          <p className="mt-2 text-sm text-subtle">
            Esta tela lê a tabela <code>agent_conversas</code>, que nasce em{" "}
            <code>supabase/migrations/0116_agente_conversas.sql</code>. Rode a migration no Supabase e recarregue.
          </p>
          <p className="mt-3 text-xs text-subtle">Detalhe técnico: {error.message}</p>
        </div>
      </div>
    );
  }

  const lista = (rows as any[]) || [];

  // Nome de quem assumiu, numa consulta só. Sem embed de `profiles` de propósito: o
  // embed depende do nome da foreign key e quebra silencioso se ela mudar — e o que
  // está em jogo é só um rótulo.
  const ids = Array.from(new Set(lista.map((c) => c.assumida_por).filter(Boolean)));
  const nomes: Record<string, string> = {};
  if (ids.length) {
    const { data: perfis } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of (perfis as any[]) || []) nomes[p.id] = p.full_name || "";
  }

  const hoje = diaISO();
  const linhas: ConversaLinha[] = lista.map((c) => ({
    id: c.id,
    nome: c.contacts?.name || null,
    phone: c.phone || "",
    contactId: c.contact_id || null,
    status: c.status,
    desfecho: c.desfecho || null,
    etapa: c.etapa_atual || null,
    // o contador só vale com a data junto — ver o comentário de msgs_hoje_em na 0116
    msgsHoje: c.msgs_hoje_em === hoje ? c.msgs_hoje || 0 : 0,
    followups: c.followups_sem_resposta || 0,
    ultimaMsgEm: c.ultima_msg_em || null,
    ultimaMsgDirecao: c.ultima_msg_direcao || null,
    ultimaRespostaEm: c.ultima_resposta_em || null,
    assumidaPor: c.assumida_por ? nomes[c.assumida_por] || "alguém do time" : null,
  }));

  const visiveis = filtro ? linhas.filter((l) => l.status === filtro) : linhas;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Conversas</h1>
      <p className="mt-1 text-sm text-subtle">
        O estado de cada conversa de WhatsApp — quem está conduzindo, há quanto tempo o lead não responde e como
        terminou. O texto das mensagens continua em <b>Respostas</b>.
      </p>
      <div className="mt-6">
        <ConversasPainel linhas={visiveis} total={linhas.length} filtro={filtro} />
      </div>
    </div>
  );
}
