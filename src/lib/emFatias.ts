import "server-only";

// ============================================================
// `.in(...)` COM MUITOS IDS NÃO CABE NUMA URL
//
// O PostgREST recebe o filtro pela query string. Cada uuid ocupa 37 caracteres, então
// 1.000 ids passam de 37 KB e o servidor recusa a requisição inteira — devolvendo erro,
// que quase sempre é ignorado, e a tela fica sem o dado sem dizer por quê.
//
// Foi exatamente o que aconteceu na fila de hoje: quando a consulta de tarefas passou a
// ser paginada (v60), a lista de `enrollment_id` cresceu de algumas centenas para
// milhares. A consulta que traduz matrícula → NOME DA CADÊNCIA passou a falhar, o mapa
// veio vazio, e a caixa "Todas as cadências" — que só aparece quando existe ao menos
// um nome — simplesmente sumiu da barra de filtros. O conserto de um lugar quebrou
// outro, e nada deu erro.
//
// Este helper quebra a lista em fatias e junta os resultados. 200 por vez: é o mesmo
// tamanho que a exclusão em massa usa há meses, medido.
//
// PROPAGA O ERRO de propósito. Uma fatia que falha e vira "[]" faz o resultado parecer
// completo — e a lição desta semana inteira é que resultado errado sem erro é o pior
// estado possível.
// ============================================================

const FATIA = 200;

export async function emFatias<T = any>(
  ids: string[],
  // o builder do postgrest é "thenable", não Promise — por isso o tipo é frouxo aqui
  consulta: (fatia: string[]) => PromiseLike<{ data: any; error: any }> | any
): Promise<{ data: T[]; error: any }> {
  const unicos = Array.from(new Set((ids || []).filter(Boolean)));
  if (!unicos.length) return { data: [], error: null };

  const out: T[] = [];
  for (let i = 0; i < unicos.length; i += FATIA) {
    const { data, error } = await consulta(unicos.slice(i, i + FATIA));
    if (error) return { data: out, error };
    out.push(...(((data as T[]) || [])));
  }
  return { data: out, error: null };
}
