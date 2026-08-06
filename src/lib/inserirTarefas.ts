import "server-only";

// ============================================================
// INSERIR TAREFAS SEM DEPENDER DA MIGRATION JÁ ESTAR APLICADA
//
// O app é publicado pela Vercel; a migration é aplicada à mão, depois. Entre uma coisa
// e outra existe uma janela em que o código conhece uma coluna que o banco ainda não
// tem — e o PostgREST, nesse caso, **recusa o insert inteiro** com `PGRST204`. Não é
// hipótese: foi assim que 257 envios deixaram de ser registrados quando `user_id`
// entrou em `events` (a lição está em Contatia_Licao_PGRST204_eventos_perdidos).
//
// Aqui o estrago seria maior: sem o insert, a INSCRIÇÃO fica sem tarefas — a pessoa vê
// "inscrito" e a fila não tem nada. Por isso a primeira tentativa leva `body_variant`
// (0111) e, se o banco não conhecer a coluna, a segunda vai sem ela. A cadência
// funciona; só o número da variação não é guardado até a migration entrar.
//
// O teste é pelo CÓDIGO do erro, não pelo texto: `PGRST204` é o do PostgREST e `42703`
// o do Postgres. Testar a mensagem quebra na primeira tradução.
// ============================================================

const LOTE = 300;

export async function inserirTarefas(
  supabase: any,
  linhas: any[]
): Promise<{ inseridas: number; error?: string; semVariacao?: boolean }> {
  if (!linhas.length) return { inseridas: 0 };

  let semVariacao = false;
  let inseridas = 0;

  for (let i = 0; i < linhas.length; i += LOTE) {
    const fatia = linhas.slice(i, i + LOTE);
    const enviar = semVariacao ? fatia.map(({ body_variant, ...resto }: any) => resto) : fatia;

    const { error } = await supabase.from("tasks").insert(enviar);
    if (!error) { inseridas += fatia.length; continue; }

    const code = String((error as any)?.code || "");
    const colunaDesconhecida = code === "PGRST204" || code === "42703";
    if (!colunaDesconhecida || semVariacao) {
      return { inseridas, error: (error as any)?.message || "Falha ao criar as tarefas.", semVariacao };
    }

    // segunda e última tentativa desta fatia, sem a coluna nova
    semVariacao = true;
    const { error: erro2 } = await supabase.from("tasks").insert(
      fatia.map(({ body_variant, ...resto }: any) => resto)
    );
    if (erro2) return { inseridas, error: (erro2 as any)?.message || "Falha ao criar as tarefas.", semVariacao };
    inseridas += fatia.length;
  }

  return { inseridas, semVariacao };
}
