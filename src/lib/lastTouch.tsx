// Sinal de "último toque" (staleness) reutilizável em Contatos, Empresas e Pipeline.
// Pura: pode ser usada em server e client components.

export function diasSemToque(at: string | null | undefined): number | null {
  if (!at) return null;
  const ms = Date.now() - new Date(at).getTime();
  if (isNaN(ms)) return null;
  return Math.floor(ms / 86400000);
}

// Classe de cor por idade do toque (verde recente → vermelho frio → cinza nunca).
export function corToque(d: number | null): string {
  if (d === null) return "bg-muted text-subtle";
  if (d <= 7) return "bg-green-100 text-green-700";
  if (d <= 30) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

export function rotuloToque(d: number | null): string {
  if (d === null) return "nunca";
  if (d <= 0) return "hoje";
  if (d === 1) return "ontem";
  return `há ${d}d`;
}

export function UltimoToque({ at, titulo }: { at: string | null | undefined; titulo?: string }) {
  const d = diasSemToque(at);
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${corToque(d)}`}
      title={titulo || "Último toque (última atividade com este lead)"}
    >
      {rotuloToque(d)}
    </span>
  );
}
