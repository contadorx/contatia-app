// Fonte única de verdade dos papéis e do que cada um pode fazer.
// Modelo: profiles.role = 'owner' | 'member'; profiles.team_role = 'admin' | 'gestor' | 'sdr' | 'vendedor'.
// O owner é sempre o nível máximo. team_role refina o que um member pode.

export type Role = "owner" | "admin" | "gestor" | "sdr" | "vendedor";

// Papel efetivo: owner vence tudo; senão usa o team_role (default vendedor).
export function effectiveRole(role?: string | null, teamRole?: string | null): Role {
  if (role === "owner") return "owner";
  const t = (teamRole || "vendedor") as Role;
  return (["admin", "gestor", "sdr", "vendedor"] as Role[]).includes(t) ? t : "vendedor";
}

// "Gestão" = enxerga a operação inteira, gerencia equipe/metas, vê métricas de todos.
export function isManager(role?: string | null, teamRole?: string | null): boolean {
  const r = effectiveRole(role, teamRole);
  return r === "owner" || r === "admin" || r === "gestor";
}

// Capacidades por papel (para gates e para exibir a matriz ao usuário).
export const CAPABILITIES: { key: string; label: string; roles: Role[] }[] = [
  { key: "billing", label: "Cobrança, plano e faturas da conta", roles: ["owner"] },
  { key: "workspace", label: "Configurações do workspace (marca, IA, e-mail, integrações)", roles: ["owner", "admin"] },
  { key: "team", label: "Gerenciar equipe (convidar, definir papéis)", roles: ["owner", "admin"] },
  { key: "goals", label: "Definir metas da equipe", roles: ["owner", "admin", "gestor"] },
  { key: "metrics_all", label: "Ver métricas de toda a equipe", roles: ["owner", "admin", "gestor"] },
  { key: "pipeline_all", label: "Ver e editar o pipeline de todos", roles: ["owner", "admin", "gestor"] },
  { key: "cadences", label: "Criar e editar cadências", roles: ["owner", "admin", "gestor"] },
  { key: "radar", label: "Prospecção no Radar (importar/enriquecer)", roles: ["owner", "admin", "gestor", "sdr"] },
  { key: "contacts", label: "Criar e trabalhar contatos", roles: ["owner", "admin", "gestor", "sdr", "vendedor"] },
  { key: "queue", label: "Executar a fila de hoje (e-mail/WhatsApp/ligações)", roles: ["owner", "admin", "gestor", "sdr", "vendedor"] },
  { key: "own_pipeline", label: "Trabalhar as próprias oportunidades", roles: ["owner", "admin", "gestor", "sdr", "vendedor"] },
  { key: "meetings", label: "Agendar e registrar reuniões", roles: ["owner", "admin", "gestor", "sdr", "vendedor"] },
];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Dono",
  admin: "Admin",
  gestor: "Gestor",
  sdr: "SDR",
  vendedor: "Vendedor",
};

export const ROLE_SUMMARY: Record<Role, string> = {
  owner: "Controle total, incluindo cobrança e plano da conta.",
  admin: "Administra o workspace e a equipe; não mexe na cobrança.",
  gestor: "Lidera a operação: metas, métricas e pipeline de todos.",
  sdr: "Prospecção e primeiros toques; foco em Radar, contatos e fila.",
  vendedor: "Trabalha a própria carteira: contatos, fila, oportunidades e reuniões.",
};

export function can(capabilityKey: string, role?: string | null, teamRole?: string | null): boolean {
  const r = effectiveRole(role, teamRole);
  const cap = CAPABILITIES.find((c) => c.key === capabilityKey);
  return cap ? cap.roles.includes(r) : false;
}
