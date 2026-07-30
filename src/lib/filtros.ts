// ============================================================
// Filtros MULTI na URL — uma convenção só para todo o app.
//
// Duas formas chegam nos searchParams do Next e as duas são aceitas aqui:
//   1) ?tag=a,b       → barras de filtro client-side (router.push), URL curta
//   2) ?tag=a&tag=b   → <form> GET com SmartSelect multiple (inputs hidden repetidos)
//
// comoLista() normaliza as duas para string[]. Assim a página não precisa saber
// quem escreveu a URL, e um filtro single antigo (?tag=a) continua funcionando.
// ============================================================

export function comoLista(v?: string | string[] | null): string[] {
  if (v == null) return [];
  const bruto = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const item of bruto) {
    for (const parte of String(item).split(",")) {
      const p = parte.trim();
      if (p && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

// Para escrever de volta na URL (barras de filtro): vazio = remove o parâmetro.
export function paraUrl(vals: string[]): string {
  return (vals || []).filter(Boolean).join(",");
}

// Conta quantas FACETAS estão ativas (não quantos valores) — é isso que o badge
// "N filtros" deve mostrar: 3 tags marcadas ainda é UM filtro de tag.
export function contarFacetas(...facetas: (string | string[] | null | undefined)[]): number {
  return facetas.filter((f) => (Array.isArray(f) ? f.length > 0 : !!f)).length;
}
