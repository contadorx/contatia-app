import "server-only";

// ============================================================
// Registro de ações (action_log) — trilha de auditoria do OPERADOR.
//
// Diferença de `events`: events é a trilha do LEAD (abriu, clicou, respondeu) e
// alimenta o score; action_log é "quem apagou o quê, quando". Nunca mexe em score
// e sobrevive à exclusão do registro (entity_id é uuid sem FK, de propósito).
//
// REGRA DE OURO: logar é BEST-EFFORT. Se o log falhar, a ação do usuário NÃO pode
// falhar por causa disso — a gente engole o erro. O contrário (perder a exclusão
// porque o log deu erro) seria pior para o operador.
//
// Ordem de uso: capture o "antes" (títulos, nomes) ANTES do delete, depois apague,
// depois logue. Sem o antes, o log fica só com ids inúteis.
// ============================================================

export type AcaoLog =
  | "task_delete"
  | "task_complete_bulk"
  | "task_skip_bulk"
  | "contact_delete"
  | "contact_delete_bulk"
  | "account_delete"
  | "account_delete_bulk"
  | "contact_tag_bulk"
  | "contact_assign_bulk"
  | "contact_enroll_bulk"
  | "account_tag_bulk"
  | "account_assign_bulk"
  | "radar_import";

// Rótulos em PT-BR — fonte única para a tela de Registro e para o `detail`.
export const ACAO_LABEL: Record<string, string> = {
  task_delete: "Excluiu tarefas",
  task_complete_bulk: "Concluiu tarefas em lote",
  task_skip_bulk: "Pulou tarefas em lote",
  contact_delete: "Excluiu contato",
  contact_delete_bulk: "Excluiu contatos em lote",
  account_delete: "Excluiu empresa",
  account_delete_bulk: "Excluiu empresas em lote",
  contact_tag_bulk: "Aplicou tags em lote",
  contact_assign_bulk: "Atribuiu contatos em lote",
  contact_enroll_bulk: "Inscreveu em cadência em lote",
  account_tag_bulk: "Aplicou tags em empresas",
  account_assign_bulk: "Atribuiu empresas em lote",
  radar_import: "Gravou empresas do Radar",
};

// Ações que a tela de Registro destaca como destrutivas (não dá pra desfazer).
export const ACOES_DESTRUTIVAS = [
  "task_delete",
  "contact_delete",
  "contact_delete_bulk",
  "account_delete",
  "account_delete_bulk",
];

export function labelAcao(a?: string | null): string {
  if (!a) return "Ação";
  return ACAO_LABEL[a] || a;
}

type LogInput = {
  tenant_id: string | null | undefined;
  user_id?: string | null;
  action: AcaoLog | string;
  entity?: string;
  entity_id?: string | null;
  qtd?: number;
  detail?: string | null;
  meta?: Record<string, any>;
};

// Limite do meta para não inflar a linha: guardamos no máximo 50 itens.
const MAX_ITENS_META = 50;

export function recortarItens<T>(itens: T[]): { itens: T[]; truncado: number } {
  if (itens.length <= MAX_ITENS_META) return { itens, truncado: 0 };
  return { itens: itens.slice(0, MAX_ITENS_META), truncado: itens.length - MAX_ITENS_META };
}

export async function logAction(supabase: any, input: LogInput): Promise<void> {
  try {
    if (!input.tenant_id || !input.action) return;

    // Nome do autor congelado no momento da ação: se o membro sair do workspace, o
    // log continua legível (user_id vira null pelo ON DELETE SET NULL, o nome fica).
    let user_name: string | null = null;
    if (input.user_id) {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", input.user_id)
        .maybeSingle();
      user_name = (data?.full_name as string) || (data?.email as string) || null;
    }

    await supabase.from("action_log").insert({
      tenant_id: input.tenant_id,
      user_id: input.user_id || null,
      user_name,
      action: input.action,
      entity: input.entity || "outro",
      entity_id: input.entity_id || null,
      qtd: Math.max(0, Math.round(input.qtd ?? 1)),
      detail: input.detail || null,
      meta: input.meta || {},
    });
  } catch {
    // silêncio proposital: log quebrado não derruba a ação do usuário.
  }
}
