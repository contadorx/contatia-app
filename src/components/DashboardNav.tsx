"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const groups: { title?: string; items: { href: string; label: string; primary?: boolean }[] }[] = [
  {
    // OPERAÇÃO — o dia a dia. Sempre aberto. Reuniões vive aqui (é operação, não biblioteca).
    items: [
      { href: "/dashboard", label: "Hoje", primary: true },
      { href: "/dashboard/pipeline", label: "Pipeline", primary: true },
      { href: "/dashboard/respostas", label: "Respostas", primary: true },
      { href: "/dashboard/triagem", label: "Triagem", primary: true },
      { href: "/dashboard/reunioes", label: "Reuniões", primary: true },
    ],
  },
  {
    title: "Dados",
    items: [
      { href: "/dashboard/contatos", label: "Contatos" },
      { href: "/dashboard/contas", label: "Empresas" },
      { href: "/dashboard/radar", label: "Radar" },
    ],
  },
  {
    title: "Biblioteca",
    items: [
      { href: "/dashboard/cadencias", label: "Cadências" },
      { href: "/dashboard/automacoes", label: "Automações" },
      { href: "/dashboard/propostas", label: "Propostas" },
    ],
  },
  {
    title: "Gestão",
    items: [
      { href: "/dashboard/metricas", label: "Métricas" },
      { href: "/dashboard/relatorios", label: "Relatórios" },
      { href: "/dashboard/equipe", label: "Equipe" },
      { href: "/dashboard/planos", label: "Planos" },
      { href: "/dashboard/suporte", label: "Suporte" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function DashboardNav({ isSuperadmin = false, unreadReplies = 0, triageCount = 0 }: { isSuperadmin?: boolean; unreadReplies?: number; triageCount?: number }) {
  const pathname = usePathname();

  const allGroups = isSuperadmin
    ? [...groups, { title: "Plataforma", items: [{ href: "/dashboard/superadmin", label: "Superadmin" }, { href: "/dashboard/superadmin/cupons", label: "Cupons" }, { href: "/dashboard/superadmin/kb", label: "Base de conhecimento" }] }]
    : groups;

  // grupo (com título) que contém a rota ativa — fica sempre aberto para o usuário se localizar
  const activeTitle = allGroups.find((g) => g.title && g.items.some((it) => isActive(pathname, it.href)))?.title;
  // demais grupos começam fechados; o usuário abre no clique
  const [openTitles, setOpenTitles] = useState<Set<string>>(new Set());
  const toggle = (t: string) => setOpenTitles((prev) => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const renderItems = (items: { href: string; label: string; primary?: boolean }[]) => (
    <div className="space-y-0.5">
      {items.map((n) => {
        const active = isActive(pathname, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={[
              "flex items-center justify-between rounded-xl px-3 py-2 text-sm transition",
              active ? "bg-brand text-white" : n.primary ? "font-semibold text-ink hover:bg-muted" : "font-medium text-ink hover:bg-muted",
            ].join(" ")}
          >
            <span>{n.label}</span>
            {n.href === "/dashboard/respostas" && unreadReplies > 0 && (
              <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white text-brand" : "bg-signal text-white"}`}>
                {unreadReplies > 99 ? "99+" : unreadReplies}
              </span>
            )}
            {n.href === "/dashboard/triagem" && triageCount > 0 && (
              <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white text-brand" : "bg-warn text-white"}`}>
                {triageCount > 99 ? "99+" : triageCount}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );

  return (
    <nav className="mt-8 space-y-3">
      {allGroups.map((g, i) => {
        // bloco sem título (Operação): sempre visível
        if (!g.title) return <div key={i}>{renderItems(g.items)}</div>;

        const isOpen = openTitles.has(g.title) || g.title === activeTitle;
        return (
          <div key={i}>
            <button
              type="button"
              onClick={() => toggle(g.title as string)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle transition hover:text-ink"
            >
              <span>{g.title}</span>
              <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>›</span>
            </button>
            {isOpen && <div className="mt-0.5">{renderItems(g.items)}</div>}
          </div>
        );
      })}
    </nav>
  );
}
