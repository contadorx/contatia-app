"use client";

// ============================================================
// Identificação técnica do workspace (aba Negócio).
//
// Existe por um motivo concreto: quando a lista de Contatos ou Empresas aparece
// vazia, a primeira pergunta é "os dados sumiram do banco ou só não estão sendo
// mostrados?". Este painel responde isso sem abrir o Supabase: mostra o ID do
// workspace, o estado da assinatura e QUANTOS registros o banco tem agora.
//
// Também é daqui que sai o ID quando algum suporte pedir.
// ============================================================

import { useState } from "react";
import { dataHora } from "@/lib/datas";

type Props = {
  id: string | null;
  nome: string | null;
  status: string | null;
  suspensoEm: string | null;
  arquivadoEm: string | null;
  seuEmail: string | null;
  seuPapel: string | null;
  contatos: number | null;   // null = a contagem falhou (não é zero!)
  empresas: number | null;
  erroContagem: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  trial: "Teste",
  active: "Ativa",
  pending: "Aguardando pagamento",
  past_due: "Fatura em atraso",
  suspended: "Suspensa",
  canceled: "Cancelada",
  archived: "Arquivada",
};

function dataBr(iso: string | null) {
  if (!iso) return null;
  return dataHora(iso);
}

export default function WorkspaceInfo(p: Props) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    if (!p.id) return;
    try {
      await navigator.clipboard.writeText(p.id);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* navegador sem permissão de área de transferência: o ID está visível para copiar à mão */
    }
  }

  const status = (p.status || "").toLowerCase();
  const emRisco = status === "suspended" || status === "archived";

  return (
    <div className="card p-5">
      <p className="label">ID do workspace</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <code className="select-all rounded-lg bg-muted px-2.5 py-1.5 font-mono text-sm">{p.id || "—"}</code>
        <button type="button" className="btn-ghost py-1 text-xs" onClick={copiar} disabled={!p.id}>
          {copiado ? "copiado ✓" : "copiar"}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-subtle">
        É o identificador do seu workspace no banco (<code>tenants.id</code>). Todo registro seu — contatos, empresas,
        tarefas — carrega esse ID.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="label">Workspace</p>
          <p className="mt-0.5 text-sm font-medium">{p.nome || "—"}</p>
        </div>
        <div>
          <p className="label">Assinatura</p>
          <p className={`mt-0.5 text-sm font-medium ${emRisco ? "text-danger" : ""}`}>
            {STATUS_LABEL[status] || p.status || "—"}
            {p.suspensoEm && <span className="font-normal text-subtle"> · suspensa em {dataBr(p.suspensoEm)}</span>}
            {p.arquivadoEm && <span className="font-normal text-subtle"> · arquivada em {dataBr(p.arquivadoEm)}</span>}
          </p>
        </div>
        <div>
          <p className="label">Você</p>
          <p className="mt-0.5 text-sm">{p.seuEmail || "—"} <span className="text-subtle">({p.seuPapel || "—"})</span></p>
        </div>
        <div>
          <p className="label">No banco, agora</p>
          <p className="mt-0.5 text-sm">
            {p.erroContagem ? (
              <span className="text-danger">não consegui contar: {p.erroContagem}</span>
            ) : (
              <>
                <b>{p.contatos ?? "—"}</b> contatos · <b>{p.empresas ?? "—"}</b> empresas
              </>
            )}
          </p>
        </div>
      </div>

      {emRisco && (
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <b>Atenção.</b> Um workspace {status === "archived" ? "arquivado" : "suspenso"} entra na régua de retenção:
          aos 60 dias de suspensão, o robô diário <b>apaga os dados de leads</b> (contatos, empresas, tarefas), mantendo
          conta e faturas. Se isso aqui não deveria estar assim, resolva o estado da assinatura antes do próximo ciclo.
        </p>
      )}

      {!p.erroContagem && (p.contatos ?? 0) > 0 && (
        <p className="mt-3 text-xs text-subtle">
          Se o banco mostra registros aqui mas a lista de Contatos ou Empresas aparece vazia, o problema é de{" "}
          <b>exibição</b> (consulta lenta demais ou filtro/visão preso na URL), não de dados perdidos.
        </p>
      )}
    </div>
  );
}
