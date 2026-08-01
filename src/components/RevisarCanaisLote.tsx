"use client";

// ============================================================
// REVISAR CANAIS EM LOTE — e-mail + WhatsApp, com andamento real
//
// As duas verificações já existiam separadas, e cada uma tinha o mesmo defeito: um
// clique, um tempo indeterminado, um resultado no fim. Para 200 contatos isso é
// inaceitável — a descoberta de e-mail conversa com o servidor de cada domínio por
// SMTP e processa SEIS por chamada, então 200 contatos são ~33 chamadas. Sem barra,
// a pessoa acha que travou e recarrega a página no meio.
//
// Aqui o laço é do CLIENTE: ele fatia a seleção e chama o servidor lote a lote. Três
// consequências que importam:
//
//  1. Cada lote é uma requisição curta — nada esbarra no limite de tempo da Vercel.
//  2. Dá para PARAR no meio, e o que já rodou está gravado.
//  3. A estimativa de término vem da MÉDIA MEDIDA dos lotes que já rodaram, não de uma
//     constante chutada. Domínio lento muda a conta na hora.
// ============================================================

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { verificarWhatsAppLote } from "@/app/dashboard/contatos/wa-actions";
import { descobrirEmailsLote } from "@/app/dashboard/prospectar/actions";

const LOTE_WA = 60;     // uma chamada só ao Evolution com todas as variantes
const LOTE_EMAIL = 6;   // o servidor processa 6 por chamada (SMTP é sequencial)

type Alvo = { id: string; temEmail: boolean; temTelefone: boolean };

function tempo(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}min ${String(s % 60).padStart(2, "0")}s`;
}

export default function RevisarCanaisLote({
  alvos,
  onFim,
}: {
  alvos: Alvo[];
  onFim?: () => void;
}) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [fase, setFase] = useState<"wa" | "email" | null>(null);
  const [feitos, setFeitos] = useState(0);
  const [total, setTotal] = useState(0);
  const [inicio, setInicio] = useState(0);
  const [agora, setAgora] = useState(0);
  const [placar, setPlacar] = useState({ comWa: 0, semWa: 0, achou: 0, semEmail: 0 });
  const [erro, setErro] = useState<string | null>(null);
  const [fim, setFim] = useState<string | null>(null);
  const pararRef = useRef(false);

  // quem entra em cada fase — declarado aqui para o botão já dizer o tamanho do trabalho
  const paraWa = alvos.filter((a) => a.temTelefone);
  const paraEmail = alvos.filter((a) => !a.temEmail);
  const totalPrevisto = paraWa.length + paraEmail.length;

  async function rodar() {
    if (!totalPrevisto) { setErro("Nenhum contato selecionado precisa de revisão: todos já têm e-mail e nenhum tem telefone para verificar."); return; }
    pararRef.current = false;
    setRodando(true);
    setErro(null);
    setFim(null);
    setFeitos(0);
    setTotal(totalPrevisto);
    setPlacar({ comWa: 0, semWa: 0, achou: 0, semEmail: 0 });
    const t0 = Date.now();
    setInicio(t0);
    setAgora(t0);
    const relogio = setInterval(() => setAgora(Date.now()), 1000);

    let processados = 0;
    const acc = { comWa: 0, semWa: 0, achou: 0, semEmail: 0 };

    try {
      // ---- FASE 1: WhatsApp (rápida, lotes de 60) ----
      setFase("wa");
      for (let i = 0; i < paraWa.length && !pararRef.current; i += LOTE_WA) {
        const fatia = paraWa.slice(i, i + LOTE_WA).map((a) => a.id);
        const r: any = await verificarWhatsAppLote(fatia);
        if (r?.error) {
          // Erro de configuração (modo assistido, instância fora) não é falha de um
          // lote: é o mesmo em todos. Avisa e passa direto para a fase de e-mail em
          // vez de repetir a mesma mensagem 4 vezes.
          setErro(`WhatsApp: ${r.error}`);
          processados += paraWa.length - i;
          setFeitos(processados);
          break;
        }
        acc.comWa += r?.comWa || 0;
        acc.semWa += r?.semWa || 0;
        processados += fatia.length;
        setFeitos(processados);
        setPlacar({ ...acc });
      }

      // ---- FASE 2: e-mail (lenta, lotes de 6) ----
      setFase("email");
      for (let i = 0; i < paraEmail.length && !pararRef.current; i += LOTE_EMAIL) {
        const fatia = paraEmail.slice(i, i + LOTE_EMAIL).map((a) => a.id);
        const r: any = await descobrirEmailsLote(fatia);
        if (r?.semWorker) { setErro("O worker de e-mail (VPS) não respondeu — a descoberta continua pelo cron."); break; }
        if (r?.error) { setErro(`E-mail: ${r.error}`); break; }
        acc.achou += (r?.achou || 0) + (r?.publicados || 0);
        acc.semEmail += r?.semEmail || 0;
        processados += fatia.length;
        setFeitos(processados);
        setPlacar({ ...acc });
      }
    } catch (e: any) {
      setErro(e?.message || "Falha de conexão no meio do lote. O que já rodou está gravado.");
    } finally {
      clearInterval(relogio);
      setRodando(false);
      setFase(null);
      const dur = tempo(Date.now() - t0);
      setFim(
        `${pararRef.current ? "Parado" : "Pronto"} em ${dur} · ` +
        `${acc.comWa} com WhatsApp · ${acc.semWa} sem WhatsApp · ` +
        `${acc.achou} e-mail(is) encontrado(s) · ${acc.semEmail} sem caixa confirmada.`
      );
      router.refresh();
      onFim?.();
    }
  }

  const pct = total ? Math.min(100, Math.round((feitos / total) * 100)) : 0;
  const decorrido = agora - inicio;
  // média MEDIDA por item já processado → estimativa que se corrige sozinha
  const restanteMs = feitos > 0 ? Math.round((decorrido / feitos) * (total - feitos)) : 0;

  return (
    <div className="w-full">
      {!rodando && (
        <button
          type="button"
          className="rounded-lg border border-signal/40 bg-signal/5 px-3 py-1.5 text-sm font-medium text-signal hover:bg-signal/10 disabled:opacity-40"
          onClick={rodar}
          disabled={!totalPrevisto}
          title={
            totalPrevisto
              ? `Verifica WhatsApp de ${paraWa.length} e procura e-mail de ${paraEmail.length}. Roda em lotes, com andamento na tela e botão de parar.`
              : "Todos os selecionados já têm e-mail e nenhum tem telefone para verificar."
          }
        >
          ⟳ Revisar canais ({totalPrevisto})
        </button>
      )}

      {rodando && (
        <div className="w-full rounded-lg border border-signal/40 bg-signal/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold text-signal">
              {fase === "wa" ? "Verificando WhatsApp…" : "Procurando e-mails no servidor de cada domínio…"}
            </span>
            <button
              type="button"
              className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium hover:bg-muted"
              onClick={() => { pararRef.current = true; }}
            >
              Parar
            </button>
          </div>

          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white">
            <div className="h-full bg-signal transition-all" style={{ width: `${pct}%` }} />
          </div>

          <p className="mt-1.5 text-xs text-subtle">
            <b className="text-ink">{feitos} de {total}</b> · {pct}% · decorrido {tempo(decorrido)}
            {feitos > 2 && total > feitos && <> · faltam ~<b className="text-ink">{tempo(restanteMs)}</b></>}
          </p>
          <p className="mt-0.5 text-[11px] text-subtle">
            {placar.comWa} com WhatsApp · {placar.achou} e-mail(is) achado(s). O que já rodou
            está gravado — parar não desfaz nada.
          </p>
        </div>
      )}

      {!rodando && fim && <p className="mt-1 text-xs font-medium text-signal">{fim}</p>}
      {erro && <p className="mt-1 text-xs font-medium text-danger">{erro}</p>}
    </div>
  );
}
