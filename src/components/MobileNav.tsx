"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import DashboardNav from "@/components/DashboardNav";
import SignOut from "@/components/SignOut";

export function MobileNav({ isSuperadmin = false, userLabel, roleLabel }: { isSuperadmin?: boolean; userLabel?: string; roleLabel?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // fecha o menu ao trocar de página
  useEffect(() => { setOpen(false); }, [pathname]);

  // trava o scroll do fundo quando aberto
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      {/* barra superior — só no mobile */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4 md:hidden">
        <Link href="/dashboard" className="font-display text-lg font-bold">
          Contat<span className="text-brand">ia</span>
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-ink"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
        </button>
      </header>

      {/* drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[82%] flex-col overflow-y-auto bg-surface p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <p className="font-display text-xl font-bold">Contat<span className="text-brand">ia</span></p>
              <button onClick={() => setOpen(false)} aria-label="Fechar menu" className="flex h-9 w-9 items-center justify-center rounded-lg text-subtle hover:text-ink">✕</button>
            </div>

            <DashboardNav isSuperadmin={isSuperadmin} />

            <div className="mt-auto border-t border-line pt-4">
              <Link href="/dashboard/config" className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink hover:bg-muted">
                <span aria-hidden>⚙️</span> Configurações
              </Link>
              {userLabel && <p className="truncate text-sm font-medium">{userLabel}</p>}
              {roleLabel && <p className="mb-2 text-xs text-subtle">{roleLabel}</p>}
              <SignOut />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
