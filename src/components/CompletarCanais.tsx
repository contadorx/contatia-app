"use client";

// ============================================================
// COMPLETAR CANAIS — um botão, os quatro canais
//
// Antes eram três botões separados (verificar WhatsApp, descobrir e-mail, buscar
// redes), cada um com seu resultado e seu tempo. Ninguém quer decidir a ordem disso —
// quer que a base fique pronta.
//
// Aqui é um clique só, em quatro fases, na ordem do MAIS BARATO para o mais caro:
//
//   1. WhatsApp   — 60 por chamada, uma consulta só ao Evolution   (segundos)
//   2. Redes      —  8 sites por chamada, HTTP                     (~1s por site)
//   3. E-mail     —  6 por chamada, conversa SMTP com cada domínio (5–30s cada)
//
// O e-mail vai por último de propósito: é o que demora, e assim os canais rápidos já
// estão prontos quando você decidir parar no meio.
//
// O LAÇO É DO CLIENTE. Cada lote é uma requisição curta, então nada esbarra no limite
// de tempo da Vercel — que é o que derrubava operação longa antes. E dá para parar:
// o que já rodou está gravado.
// ============================================================

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { verificarWhatsAppLote } from "@/app/dashboard/contatos/wa-actions";
import { descobrirEmailsLote } from "@/app/dashboard/prospectar/actions";
import { capturarRedesDoSite } from "@/app/dashboard/contatos/social-actions";
import { enriquecerReceitaLote } from "@/app/dashboard/contatos/receita-lote-actions";

const LOTE_WA = 60;
const LOTE_RECEITA = 8;
const LOTE_REDES = 8;
const LOTE_EMAIL = 6;

export type AlvoCanal = {
  id: string;
  temEmail: boolean;
  temTelefone: boolean;
  temRede: boolean;      // já tem instagram OU linkedin
  temDominio: boolean;   // sem site não há onde procurar rede/e-mail
  temCnpj?: boolean;     // dá para consultar a Receita
  enriquecido?: boolean; // já consultada
  // tem e-mail, mas provavelmente NÃO é o da pessoa (balcão, outro domínio, outro nome)
  emailSuspeito?: boolean;
};

function tempo(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, "0")}s`;
}

export default function CompletarCanais({ alvos, onFim }: { alvos: AlvoCanal[]; onFim?: () => void }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [fase, setFase] = useState<"receita" | "wa" | "redes" | "email" | null>(null);
  const [feitos, setFeitos] = useState(0);
  const [total, setTotal] = useState(0);
  const [inicio, setInicio] = useState(0);
  const [agora, setAgora] = useState(0);
  const [placar, setPlacar] = useState({ comWa: 0, semWa: 0, ig: 0, li: 0, email: 0, receita: 0, dominios: 0 });
  const [erros, setErros] = useState<string[]>([]);
  const [fim, setFim] = useState<string | null>(null);
  const pararRef = useRef(false);

  // ============================================================
  // A RECEITA VEM PRIMEIRO — É ELA QUE DESTRAVA O RESTO
  //
  // O lote começava na verificação de WhatsApp e nunca consultava a Receita. Para um
  // contato importado só com CNPJ — a maioria do que vem de planilha — isso quer
  // dizer: sem domínio, logo sem site para ler, logo sem e-mail para descobrir. As
  // fases seguintes rodavam e não achavam nada, e o operador lia "não tem dados
  // publicados" sobre uma base que nunca tinha sido consultada na origem.
  //
  // A ordem agora é a MESMA do botão individual da ficha: Receita → site → e-mail →
  // WhatsApp. Não por simetria: porque cada passo alimenta o seguinte.
  // ============================================================
  const paraReceita = alvos.filter((a) => a.temCnpj && !a.enriquecido);
  const paraWa = alvos.filter((a) => a.temTelefone);
  // Depois da Receita, contato que estava sem domínio pode passar a ter. Por isso o
  // alvo do site inclui quem VAI ser enriquecido, e não só quem já tem domínio hoje.
  const paraRedes = alvos.filter((a) => (a.temDominio || (a.temCnpj && !a.enriquecido)) && !a.temRede);
  // ============================================================
  // A CONTA DE "QUEM PRECISA DE E-MAIL" É A MESMA DO INDIVIDUAL
  //
  // Era `!a.temEmail`. Quem já tinha `contato@empresa` nem era mandado para o
  // servidor — o lote pulava antes de perguntar. Agora entra também quem tem caixa
  // de balcão, e-mail de outro domínio ou endereço que não parece ser da pessoa. O
  // servidor confere de novo (é ele que decide), mas o cliente precisa MANDAR.
  // ============================================================
  const paraEmail = alvos.filter((a) => !a.temEmail || a.emailSuspeito);
  const totalPrevisto = paraReceita.length + paraWa.length + paraRedes.length + paraEmail.length;

  const FASE_TXT: Record<string, string> = {
    receita: "Consultando o CNPJ na base da Receita…",
    wa: "Verificando WhatsApp…",
    redes: "Lendo o site (telefone, e-mail publicado, Instagram e LinkedIn)…",
    email: "Procurando e-mails no servidor de cada domínio…",
  };

  async function rodar() {
    if (!totalPrevisto) {
      setErros(["Nada a completar: os selecionados já têm o que dava para descobrir."]);
      return;
    }
    pararRef.current = false;
    setRodando(true); setErros([]); setFim(null); setFeitos(0);
    setTotal(totalPrevisto);
    setPlacar({ comWa: 0, semWa: 0, ig: 0, li: 0, email: 0, receita: 0, dominios: 0 });
    const t0 = Date.now();
    setInicio(t0); setAgora(t0);
    const relogio = setInterval(() => setAgora(Date.now()), 1000);

    let feito = 0;
    const acc = { comWa: 0, semWa: 0, ig: 0, li: 0, email: 0, receita: 0, dominios: 0 };
    const errs: string[] = [];

    // roda uma fase em lotes; devolve quantos itens foram processados
    async function faseLote<T>(
      nome: "receita" | "wa" | "redes" | "email",
      itens: AlvoCanal[],
      tamanho: number,
      exec: (ids: string[]) => Promise<any>,
      somar: (r: any) => void
    ) {
      setFase(nome);
      for (let i = 0; i < itens.length && !pararRef.current; i += tamanho) {
        const fatia = itens.slice(i, i + tamanho).map((a) => a.id);
        let r: any;
        try {
          r = await exec(fatia);
        } catch (e: any) {
          errs.push(`${nome}: falha de conexão no meio do lote.`);
          break;
        }
        if (r?.error) {
          // Erro de configuração (modo assistido, worker fora) é o mesmo em todos os
          // lotes: registra uma vez e pula a fase, em vez de repetir 30 vezes a mesma
          // mensagem e gastar 30 requisições para nada.
          errs.push(`${nome}: ${r.error}`);
          feito += itens.length - i;
          setFeitos(feito);
          break;
        }
        somar(r);
        feito += fatia.length;
        setFeitos(feito);
        setPlacar({ ...acc });
        setErros([...errs]);
      }
    }

    try {
      // 1) Receita: é o passo que pode CRIAR o domínio de quem só tinha CNPJ
      await faseLote("receita", paraReceita, LOTE_RECEITA, (ids) => enriquecerReceitaLote(ids), (r) => {
        acc.receita += r?.enriquecidos || 0;
        acc.dominios += r?.ganhouDominio || 0;
      });
      if (!pararRef.current) await faseLote("wa", paraWa, LOTE_WA, (ids) => verificarWhatsAppLote(ids), (r) => {
        acc.comWa += r?.comWa || 0; acc.semWa += r?.semWa || 0;
      });
      if (!pararRef.current) {
        await faseLote("redes", paraRedes, LOTE_REDES, (ids) => capturarRedesDoSite(ids), (r) => {
          acc.ig += r?.comIg || 0; acc.li += r?.comLi || 0;
        });
      }
      if (!pararRef.current) {
        await faseLote("email", paraEmail, LOTE_EMAIL, (ids) => descobrirEmailsLote(ids), (r) => {
          acc.email += (r?.achou || 0) + (r?.publicados || 0);
        });
      }
    } finally {
      clearInterval(relogio);
      setRodando(false); setFase(null);
      setFim(
        `${pararRef.current ? "Parado" : "Pronto"} em ${tempo(Date.now() - t0)} · ` +
        `${acc.receita} da Receita${acc.dominios ? ` (${acc.dominios} ganharam domínio)` : ""} · ` +
        `${acc.comWa} com WhatsApp · ${acc.email} e-mail(is) · ${acc.ig} Instagram · ${acc.li} LinkedIn.`
      );
      setErros([...errs]);
      router.refresh();
      onFim?.();
    }
  }

  const pct = total ? Math.min(100, Math.round((feitos / total) * 100)) : 0;
  const decorrido = agora - inicio;
  const restanteMs = feitos > 0 ? Math.round((decorrido / feitos) * (total - feitos)) : 0;

  return (
    <div className="w-full">
      {!rodando && (
        <button
          type="button"
          className="rounded-lg border border-signal/40 bg-signal/5 px-3 py-1.5 text-sm font-semibold text-signal hover:bg-signal/10 disabled:opacity-40"
          onClick={rodar}
          disabled={!totalPrevisto}
          title={
            totalPrevisto
              ? `Roda os quatro canais: WhatsApp (${paraWa.length}), redes (${paraRedes.length}) e e-mail (${paraEmail.length}). Em lotes, com andamento e botão de parar.`
              : "Os selecionados já têm o que dava para descobrir."
          }
        >
          ⟳ Completar canais ({totalPrevisto})
        </button>
      )}

      {rodando && (
        <div className="w-full rounded-lg border border-signal/40 bg-signal/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold text-signal">{fase ? FASE_TXT[fase] : "…"}</span>
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
            {placar.comWa} WhatsApp · {placar.email} e-mail · {placar.ig} Instagram · {placar.li} LinkedIn.
            O que já rodou está gravado — parar não desfaz nada.
          </p>
        </div>
      )}

      {!rodando && fim && <p className="mt-1 text-xs font-medium text-signal">{fim}</p>}
      {erros.map((e, i) => (
        <p key={i} className="mt-1 text-xs font-medium text-warn">{e}</p>
      ))}
    </div>
  );
}
