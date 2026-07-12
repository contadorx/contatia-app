"use client";

import { useState, useTransition } from "react";
import { setRole, toggleCalendarPermission } from "@/app/dashboard/equipe/team-actions";

// ============================================================
// Equipe: papéis e permissões de agenda.
//   Admin (owner)   → tudo; enxerga todas as agendas
//   Vendedor (partner) → própria carteira e própria agenda
//   SDR (sdr)       → prospecta e AGENDA para os vendedores que o liberarem
// O teto de usuários vem do plano; ao encher, sugerimos o plano certo.
// ============================================================

type Membro = { id: string; name: string; email: string; role: string };
type Perm = { sdr_id: string; seller_id: string; can_book: boolean };

const PAPEIS = [
  { v: "owner", t: "Admin", d: "Acesso total, cobrança e equipe" },
  { v: "partner", t: "Vendedor", d: "Própria carteira e própria agenda" },
  { v: "sdr", t: "SDR", d: "Prospecta e agenda para os vendedores" },
];

export function TeamManager({
  membros,
  permissoes,
  meuId,
  souAdmin,
  seats,
}: {
  membros: Membro[];
  permissoes: Perm[];
  meuId: string;
  souAdmin: boolean;
  seats: { usuarios: number; teto: number | null; plano: string; sugerido: string; podeAdicionar: boolean } | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const sdrs = membros.filter((m) => m.role === "sdr");
  const vendedores = membros.filter((m) => m.role === "partner" || m.role === "owner");

  const temPermissao = (sdr: string, vend: string) =>
    permissoes.some((p) => p.sdr_id === sdr && p.seller_id === vend && p.can_book);

  function mudarPapel(id: string, papel: string) {
    setMsg(null);
    start(async () => {
      const r = (await setRole(id, papel)) as any;
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
          O <b>Admin</b> controla tudo. O <b>Vendedor</b> trabalha a própria carteira.
          O <b>SDR</b> prospecta e marca reuniões nas agendas que lhe forem liberadas.
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
              {membros.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-4 py-3">
                    <p className="font-medium">{m.name}{m.id === meuId && <span className="text-subtle"> (você)</span>}</p>
                    <p className="text-xs text-subtle">{m.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {souAdmin && m.id !== meuId ? (
                      <select
                        className="input max-w-[180px] py-1.5 text-sm"
                        value={m.role}
                        disabled={pending}
                        onChange={(e) => mudarPapel(m.id, e.target.value)}
                      >
                        {PAPEIS.map((p) => <option key={p.v} value={p.v}>{p.t}</option>)}
                      </select>
                    ) : (
                      <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
                        {PAPEIS.find((p) => p.v === m.role)?.t || m.role}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
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
