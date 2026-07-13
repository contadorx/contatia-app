"use client";

import { useState, useTransition } from "react";
import { setTeamRole } from "@/app/dashboard/equipe/actions";
import { toggleCalendarPermission } from "@/app/dashboard/equipe/team-actions";
import { effectiveRole, ROLE_LABEL, type Role } from "@/lib/permissions";

// ============================================================
// Equipe: papéis e permissões de agenda.
//   Dono            → tudo; cobrança e equipe (nível máximo, não editável aqui)
//   Admin           → workspace e equipe (sem cobrança)
//   Gestor          → lidera a operação: metas, métricas e pipeline de todos
//   Vendedor        → própria carteira e própria agenda
//   SDR             → prospecta e AGENDA para quem o liberar
// Fonte única do papel operacional: profiles.team_role (ver lib/permissions.ts).
// O teto de usuários vem do plano; ao encher, sugerimos o plano certo.
// ============================================================

type Membro = { id: string; name: string; email: string; role: string; team_role: string | null };
type Perm = { sdr_id: string; seller_id: string; can_book: boolean };

// Papéis atribuíveis (o Dono não se atribui — vem da titularidade da conta).
const PAPEIS = [
  { v: "admin", t: "Admin" },
  { v: "gestor", t: "Gestor" },
  { v: "vendedor", t: "Vendedor" },
  { v: "sdr", t: "SDR" },
];

// SDR "efetivo": pelo papel novo (team_role) ou pelo legado (role) — sem regressão.
const isSdr = (m: Membro) => effectiveRole(m.role, m.team_role) === "sdr" || m.role === "sdr";

export function TeamManager({
  membros,
  permissoes,
  meuId,
  souAdmin,
  canManage,
  seats,
}: {
  membros: Membro[];
  permissoes: Perm[];
  meuId: string;
  souAdmin: boolean;
  canManage: boolean;
  seats: { usuarios: number; teto: number | null; plano: string; sugerido: string; podeAdicionar: boolean } | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const sdrs = membros.filter(isSdr);
  const vendedores = membros.filter((m) => !isSdr(m)); // quem tem agenda própria para agendar

  const temPermissao = (sdr: string, vend: string) =>
    permissoes.some((p) => p.sdr_id === sdr && p.seller_id === vend && p.can_book);

  function mudarPapel(id: string, papel: string) {
    setMsg(null);
    start(async () => {
      const r = (await setTeamRole(id, papel)) as any;
      if (r?.error) setMsg(r.error);
      else window.location.reload();
    });
  }

  function alternarPermissao(sdrId: string, sellerId: string, ativar: boolean) {
    setMsg(null);
    start(async () => {
      const r = (await toggleCalendarPermission(sdrId, sellerId, ativar)) as any;
      if (r?.error) setMsg(r.error);
      else window.location.reload();
    });
  }

  return (
    <div className="space-y-6">
      {/* TETO DO PLANO */}
      {seats && (
        <div
          className={`rounded-xl p-4 text-sm ${
            seats.podeAdicionar ? "bg-muted text-subtle" : "border border-warn/30 bg-warn/10 text-warn"
          }`}
        >
          {seats.podeAdicionar ? (
            <>
              <b>{seats.usuarios}</b> de {seats.teto ?? "∞"} usuários no plano <b>{seats.plano}</b>.
            </>
          ) : (
            <>
              <p className="font-semibold">
                Seu plano {seats.plano} comporta {seats.teto} usuários — e você já tem {seats.usuarios}.
              </p>
              <p className="mt-1">
                Para adicionar mais gente, o plano <b>{seats.sugerido}</b> é o indicado.{" "}
                <a href="/dashboard/planos" className="font-semibold underline">Ver planos →</a>
              </p>
            </>
          )}
        </div>
      )}

      {msg && <p className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{msg}</p>}

      {/* PAPÉIS */}
      <div>
        <p className="font-display font-semibold">Papéis</p>
        <p className="mt-1 text-sm text-subtle">
          Cada pessoa tem <b>um papel</b>, que define o que ela enxerga e faz. O <b>Dono</b> tem controle total;
          <b> Admin</b> e <b>Gestor</b> lideram a operação; <b>Vendedor</b> trabalha a própria carteira; o <b>SDR</b> prospecta
          e marca reuniões nas agendas que lhe forem liberadas.
        </p>

        <div className="mt-3 overflow-hidden rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-subtle">
              <tr>
                <th className="px-4 py-2 font-semibold">Pessoa</th>
                <th className="px-4 py-2 font-semibold">Papel</th>
              </tr>
            </thead>
            <tbody>
              {membros.map((m) => {
                const eff = effectiveRole(m.role, m.team_role);
                const podeEditar = canManage && m.id !== meuId && eff !== "owner";
                return (
                  <tr key={m.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <p className="font-medium">{m.name}{m.id === meuId && <span className="text-subtle"> (você)</span>}</p>
                      <p className="text-xs text-subtle">{m.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      {podeEditar ? (
                        <select
                          className="input max-w-[180px] py-1.5 text-sm"
                          value={PAPEIS.some((p) => p.v === eff) ? eff : "vendedor"}
                          disabled={pending}
                          onChange={(e) => mudarPapel(m.id, e.target.value)}
                        >
                          {PAPEIS.map((p) => <option key={p.v} value={p.v}>{p.t}</option>)}
                        </select>
                      ) : (
                        <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
                          {ROLE_LABEL[eff as Role] || eff}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* PERMISSÕES DE AGENDA */}
      {sdrs.length > 0 && (
        <div>
          <p className="font-display font-semibold">Quem pode marcar na agenda de quem</p>
          <p className="mt-1 text-sm text-subtle">
            Marque para liberar o SDR a agendar na agenda do vendedor. O próprio vendedor
            também pode liberar ou revogar a agenda dele.
          </p>

          <div className="mt-3 overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-subtle">
                <tr>
                  <th className="px-4 py-2 font-semibold">SDR</th>
                  {vendedores.map((v) => (
                    <th key={v.id} className="px-4 py-2 text-center font-semibold">{v.name.split(" ")[0]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sdrs.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    {vendedores.map((v) => {
                      const marcado = temPermissao(s.id, v.id);
                      // o admin libera qualquer agenda; o vendedor libera só a própria
                      const posso = souAdmin || v.id === meuId;
                      return (
                        <td key={v.id} className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={marcado}
                            disabled={!posso || pending}
                            onChange={(e) => alternarPermissao(s.id, v.id, e.target.checked)}
                            title={posso ? "Permitir que este SDR agende nesta agenda" : "Só o admin ou o dono da agenda pode alterar"}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
