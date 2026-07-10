import { CAPABILITIES, ROLE_LABEL, ROLE_SUMMARY, type Role } from "@/lib/permissions";

const ORDER: Role[] = ["owner", "admin", "gestor", "sdr", "vendedor"];

export default function PermissionMatrix() {
  return (
    <div>
      {/* Resumo por papel */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {ORDER.map((r) => (
          <div key={r} className="rounded-xl border border-line bg-surface p-3">
            <p className="text-sm font-bold">{ROLE_LABEL[r]}</p>
            <p className="mt-1 text-xs text-subtle">{ROLE_SUMMARY[r]}</p>
          </div>
        ))}
      </div>

      {/* Matriz papel × capacidade */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 640 }}>
          <thead className="border-b border-line text-left text-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">O que pode fazer</th>
              {ORDER.map((r) => (
                <th key={r} className="px-3 py-2 text-center font-medium">{ROLE_LABEL[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((cap) => (
              <tr key={cap.key} className="border-b border-line last:border-0">
                <td className="px-3 py-2">{cap.label}</td>
                {ORDER.map((r) => (
                  <td key={r} className="px-3 py-2 text-center">
                    {cap.roles.includes(r) ? <span className="text-signal">✓</span> : <span className="text-line">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-subtle">O <b>Dono</b> tem controle total (incl. cobrança). Papéis de <b>gestão</b> (Dono, Admin, Gestor) enxergam a operação inteira; <b>SDR</b> e <b>Vendedor</b> trabalham a própria carteira.</p>
    </div>
  );
}
