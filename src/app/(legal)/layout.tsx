import Link from "next/link";

// ============================================================
// Moldura das páginas legais (privacidade, termos, segurança, políticas).
//
// Fora do /dashboard de propósito: quem precisa ler isto costuma ser alguém avaliando
// o Contatia ANTES de ter conta — um comitê de compras, o jurídico do cliente, ou o
// titular de um dado que recebeu uma mensagem nossa. Exigir login para ler a política
// de privacidade é o oposto do que a LGPD pede.
// ============================================================

export const metadata = {
  title: "Contatia — documentos",
  robots: { index: true, follow: true },
};

const PAGINAS = [
  { href: "/privacidade", label: "Privacidade" },
  { href: "/termos", label: "Termos de Uso" },
  { href: "/seguranca", label: "Segurança" },
  { href: "/politicas", label: "Políticas internas" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F5F6FA]">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link href="/" className="font-display text-xl font-bold text-brand-dark">Contatia</Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            {PAGINAS.map((p) => (
              <Link key={p.href} href={p.href} className="text-subtle hover:text-ink">{p.label}</Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <article className="legal rounded-2xl border border-line bg-white p-7 sm:p-10">{children}</article>

        <p className="mt-6 text-center text-xs text-subtle">
          Contatia — prospecção e cadência B2B ·{" "}
          <a href="mailto:contato@contatia.com.br" className="underline">contato@contatia.com.br</a>
        </p>
      </main>
    </div>
  );
}
