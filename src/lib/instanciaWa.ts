import "server-only";

// ============================================================
// QUAL INSTÂNCIA DE WHATSAPP USAR
//
// Três lugares escolhiam instância com o mesmo trecho copiado — "a ativa mais antiga":
//
//     .from("whatsapp_accounts").eq("is_active", true)
//     .order("created_at").limit(1).maybeSingle()
//
// Com número por pessoa (migration 0104) isso passa a estar errado: o vendedor mandaria
// mensagem pelo número do escritório e a resposta cairia na caixa de outra pessoa. Pior
// que no e-mail, porque no WhatsApp a conversa fica no aparelho de quem enviou.
//
// A ordem aqui é: número PRÓPRIO → compartilhado/do workspace → qualquer ativo.
//
// A RLS da 0104 já esconde o número privado dos outros, então o "qualquer ativo" do fim
// nunca alcança o que não é para ser alcançado — mas a preferência explícita importa:
// sem ela, quem tem número próprio E enxerga um compartilhado poderia sair pelo errado.
// ============================================================

export type InstanciaWa = {
  id: string;
  evolution_url: string;
  api_key: string;
  instance: string;
  daily_cap: number | null;
  user_id: string | null;
  is_shared: boolean | null;
};

const CAMPOS = "id, evolution_url, api_key, instance, daily_cap, user_id, is_shared";

export async function instanciaDoUsuario(
  supabase: any,
  tenant_id: string,
  user_id: string | undefined
): Promise<{ acc: InstanciaWa | null; propria: boolean }> {
  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .select(CAMPOS)
    .eq("tenant_id", tenant_id)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  // A 0104 ainda não foi aplicada (colunas não existem) → volta ao comportamento antigo.
  // O app é publicado antes da migration ser rodada à mão; quebrar o envio nesse
  // intervalo seria pior do que enviar pelo número do escritório mais um dia.
  if (error && String((error as any).code) === "42703") {
    const { data: legado } = await supabase
      .from("whatsapp_accounts")
      .select("id, evolution_url, api_key, instance, daily_cap")
      .eq("tenant_id", tenant_id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return { acc: legado ? ({ ...(legado as any), user_id: null, is_shared: true }) : null, propria: false };
  }
  if (error) throw error;

  const lista = ((data as any[]) || []) as InstanciaWa[];
  if (!lista.length) return { acc: null, propria: false };

  const minha = user_id ? lista.find((a) => a.user_id === user_id) : undefined;
  if (minha) return { acc: minha, propria: true };

  const doWorkspace = lista.find((a) => !a.user_id);
  if (doWorkspace) return { acc: doWorkspace, propria: false };

  const emprestada = lista.find((a) => a.is_shared);
  return { acc: emprestada || lista[0], propria: false };
}

// Mensagem única quando não há instância — as três telas diziam a mesma coisa de jeitos
// diferentes, e nenhuma explicava que o número pode ser SEU.
export const SEM_INSTANCIA =
  "Nenhuma instância de WhatsApp ativa para você. Em Configurações → Canais você pode " +
  "conectar o SEU número (a conversa fica no seu aparelho) ou usar um número compartilhado " +
  "do workspace, se o gestor tiver liberado um.";
