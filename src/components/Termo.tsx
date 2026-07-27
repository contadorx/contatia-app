// Termo com definição no hover (tooltip nativo) — desmistifica o jargão do produto
// (cadência, score…) pro usuário menos técnico, sem custo de JS.
export function Termo({ children, def }: { children: React.ReactNode; def: string }) {
  return (
    <span title={def} className="cursor-help border-b border-dotted border-subtle/70">
      {children}
    </span>
  );
}
