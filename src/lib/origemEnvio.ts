import "server-only";

// ============================================================
// DE QUAL E-MAIL VEIO ESTE SINAL
//
// "Fulano abriu o e-mail" sem dizer QUAL e-mail é meia informação: não dá para
// responder, nem para saber qual cadência está funcionando. O evento de abertura
// guardava só `{ fonte: "pixel" }`, e o de clique só a URL.
//
// A informação existe — o pixel e o link são criados no momento do envio e sabem de
// qual TAREFA e de qual CADÊNCIA saíram (colunas da 0108). O que faltava era copiar
// isso para dentro do evento, que é o que a tela lê depois.
//
// POR QUE COPIAR EM VEZ DE CONSULTAR NA HORA: o evento é histórico. Se a cadência for
// renomeada ou a tarefa apagada, o que aconteceu naquele dia continua verdadeiro.
//
// NADA AQUI PODE FALHAR PARA FORA. O pixel tem de devolver a imagem e o link tem de
// redirecionar mesmo que este enriquecimento não dê certo — inclusive se a 0108 não
// tiver sido aplicada, caso em que as colunas simplesmente não vêm e a função devolve
// um objeto vazio.
// ============================================================

export type OrigemEnvio = { assunto?: string; cadencia?: string; passo?: number };

export async function origemDoEnvio(admin: any, row: any): Promise<OrigemEnvio> {
  const o: OrigemEnvio = {};
  try {
    const passo = Number(row?.step_position);
    if (Number.isFinite(passo) && passo > 0) o.passo = passo;

    // o assunto do e-mail é o título da tarefa que o gerou
    if (row?.task_id) {
      const { data: t } = await admin.from("tasks").select("title").eq("id", row.task_id).maybeSingle();
      const titulo = ((t as any)?.title || "").trim();
      if (titulo) o.assunto = titulo;
    }

    let seqId = row?.sequence_id || null;
    if (!seqId && row?.enrollment_id) {
      const { data: e } = await admin.from("enrollments").select("sequence_id").eq("id", row.enrollment_id).maybeSingle();
      seqId = (e as any)?.sequence_id || null;
    }
    if (seqId) {
      const { data: s } = await admin.from("sequences").select("name").eq("id", seqId).maybeSingle();
      const nome = ((s as any)?.name || "").trim();
      if (nome) o.cadencia = nome;
    }
  } catch {
    /* enriquecer é opcional por construção */
  }
  return o;
}
