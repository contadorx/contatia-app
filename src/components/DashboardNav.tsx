"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const groups: { title?: string; items: { href: string; label: string; primary?: boolean }[] }[] = [
  {
    items: [
      { href: "/dashboard", label: "Hoje", primary: true },
      { href: "/dashboard/pipeline", label: "Pipeline", primary: true },
      { href: "/dashboard/respostas", label: "Respostas", primary: true },
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
      { href: "/dashboard/reunioes", label: "Reuniões" },
    ],
  },
  {
    title: "Gestão",    items: [
      { href: "/dashboard/metricas", label: "Métricas" },
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

export default function DashboardNav({ isSuperadmin = false, unreadReplies = 0 }: { isSuperadmin?: boolean; unreadReplies?: number }) {
  const pathname = usePathname();

  const allGroups = isSuperadmin
    ? [...groups, { title: "Plataforma", items: [{ href: "/dashboard/superadmin", label: "Superadmin" }, { href: "/dashboard/superadmin/kb", label: "Base de conhecimento" }] }]
    : groups;

  return (
    <nav className="mt-8 space-y-5">
      {allGroups.map((g, i) => (
        <div key={i}>
          {g.title && <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">{g.title}</p>}
          <div className="space-y-0.5">
            {g.items.map((n) => {
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
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
