"use client";

// ============================================================
// O BLOCO, AGORA SEM MEMÓRIA PRÓPRIA
//
// A versão anterior guardava aqui o que sabia do contato e decidia os passos com base
// nisso. Como cada passo MUDA o contato (o CNPJ traz o domínio, o site traz o telefone),
// as decisões seguintes saíam de uma foto velha: o WhatsApp nem entrava no plano e a
// busca de e-mail se comportava diferente do controle individual — que sempre leu o
// estado real do banco.
//
// Agora este componente não decide nada. Ele percorre os passos, e o SERVIDOR relê o
// contato antes de cada um e devolve o estado novo. A tela só desenha. Não há mais nada
// aqui que possa envelhecer.
// ============================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rodarPasso } from "@/app/dashboard/contatos/atualizar-actions";
import { atualizarWhatsAppDoSite } from "@/app/dashboard/contatos/wa-actions";
import { buscarEmailAgora } from "@/app/dashboard/contatos/discovery-actions";
import {
  passosPendentes,
  ORDEM_PASSOS,
  ROTULO_PASSO as ROTULO,
  type EstadoContato,
  type PassoId,
  type ResultadoPasso,
} from "@/lib/passosContato";

const EM_ANDAMENTO: Record<PassoId, string> = {
  cnpj: "Consultando o CNPJ na base da Receita…",
  site: "Lendo o site da empresa…",
  email: "Procurando o e-mail (conversa com o servidor do domínio, pode demorar)…",
  whatsapp: "Verificando o WhatsApp…",
};


export default function AtualizarDadosContato({
  contactId,
  estadoInicial,
}: {
  contactId: string;
  estadoInicial: EstadoContato;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoContato>(estadoInicial);
  const [rodando, setRodando] = useState<PassoId | null>(null);
  const [linhas, setLinhas] = useState<ResultadoPasso[]>([]);
  const [pronto, setPronto] = useState(false);

  // Botão próprio para o WhatsApp: "verificar" pergunta sobre o número que já está na
  // ficha; este vai atrás de um número DIFERENTE, no site. Estava enterrado em dois
  // painéis recolhidos e ninguém achava — subiu para cá.
  const [buscandoWa, setBuscandoWa] = useState(false);
  const [recadoWa, setRecadoWa] = useState<{ titulo: string; detalhe: string; ok?: boolean } | null>(null);

  async function buscarWaNoSite() {
    setBuscandoWa(true);
    setRecadoWa(null);
    try {
      const r: any = await atualizarWhatsAppDoSite(contactId);
      setRecadoWa({ titulo: r?.titulo || "Sem resposta", detalhe: r?.detalhe || "", ok: r?.ok });
      if (r?.ok) router.refresh();
    } catch (e: any) {
      setRecadoWa({ titulo: "Falhou", detalhe: e?.message || "erro de rede" });
    } finally {
      setBuscandoWa(false);
    }
  }

  // Conferir o e-mail contra o servidor do domínio. Existia só dentro de dois painéis
  // recolhidos e o operador não achava — mesma história do botão de WhatsApp.
  // Quando o servidor confirma, a descoberta já grava o selo "SMTP validado".
  const [conferindoEmail, setConferindoEmail] = useState(false);
  const [recadoEmail, setRecadoEmail] = useState<{ titulo: string; detalhe: string; ok?: boolean } | null>(null);

  async function conferirEmail() {
    setConferindoEmail(true);
    setRecadoEmail(null);
    try {
      // forcar = true quando já existe endereço: modo revisão, só troca se o servidor
      // confirmar um diferente.
      const r: any = await buscarEmailAgora(contactId, estado.dominio || "", estado.temEmail);
      setRecadoEmail({
        titulo: r?.titulo || (r?.email ? `Confirmado: ${r.email}` : "Sem resposta"),
        detalhe: r?.detalhe || "",
        ok: !!r?.ok,
      });
      if (r?.ok) router.refresh();
    } catch (e: any) {
      setRecadoEmail({ titulo: "Falhou", detalhe: e?.message || "erro de rede" });
    } finally {
      setConferindoEmail(false);
    }
  }

  const pendentes = passosPendentes(estado);
  const nadaAFazer = pendentes.length === 0;

  async function rodar() {
    setLinhas([]);
    setPronto(false);
    for (const passo of ORDEM_PASSOS) {
      setRodando(passo);
      // ============================================================
      // UM PASSO PODE NÃO DEVOLVER NADA
      //
      // Server action que falha no servidor pode chegar aqui como `undefined`. O
      // código antigo empurrava isso direto para a lista, e a renderização quebrava a
      // ficha inteira em `l.tom` — o contato ficava inacessível por causa de UM passo.
      //
      // Agora a falha vira uma linha normal de erro, os passos seguintes continuam, e
      // o try/catch garante que nem exceção derruba o laço.
      // ============================================================
      let r: ResultadoPasso;
      try {
        r = (await rodarPasso(contactId, passo)) as ResultadoPasso;
      } catch (e: any) {
        r = { passo, texto: e?.message || "falhou no servidor", tom: "erro" };
      }
      if (!r || typeof r !== "object") {
        r = { passo, texto: "o servidor não respondeu neste passo", tom: "erro" };
      }
      setLinhas((prev) => [...prev, r]);
      // O estado devolvido é o do banco DEPOIS do passo — é ele que decide o próximo.
      if (r.estado) setEstado(r.estado);
    }
    setRodando(null);
    setPronto(true);
    router.refresh();
  }

  const cor = (t: ResultadoPasso["tom"]) =>
    t === "ok" ? "text-brand-dark" : t === "erro" ? "text-danger" : "text-subtle";
  const icone = (t: ResultadoPasso["tom"]) =>
    t === "ok" ? "✓" : t === "erro" ? "✕" : t === "nada" ? "—" : "·";

  // ============================================================
  // O QUADRO MOSTRA O VALOR, NÃO O ADJETIVO
  //
  // Antes cada canal dizia "do decisor", "confirmado", "Instagram ou LinkedIn". Certo
  // e insuficiente: depois de descobrir, a pergunta seguinte é sempre "qual?" — e
  // responder exigia rolar até o cabeçalho, abrir o painel recolhido das redes e
  // copiar na mão. Muitos cliques para ver o que o app tinha acabado de achar.
  //
  // Agora aparece o endereço, o número e a rede, cada um clicável no lugar certo:
  // escrever o e-mail, abrir a conversa no WhatsApp, abrir o perfil. E como o
  // servidor devolve o estado NOVO depois de cada passo, o que foi descoberto aparece
  // aqui na hora, sem recarregar a página.
  // ============================================================
  const soDigitos = (t: string) => (t || "").replace(/\D+/g, "");
  const linkWa = (tel: string) => {
    const d = soDigitos(tel);
    if (d.length < 10) return null;
    return `https://wa.me/${d.startsWith("55") ? d : "55" + d}`;
  };
  const linkRede = (v: string, base: string) => {
    const t = (v || "").trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    return base + t.replace(/^@/, "");
  };
  const dia = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null;

  type Canal = {
    rotulo: string;
    valor: string;
    href?: string | null;
    nota?: string | null;
    ok: boolean;
    alerta?: boolean;
  };

  const igHref = estado.instagram ? linkRede(estado.instagram, "https://instagram.com/") : null;
  const liHref = estado.linkedin ? linkRede(estado.linkedin, "https://linkedin.com/in/") : null;
  const waHref = estado.telefone ? linkWa(estado.telefone) : null;

  const canais: Canal[] = [
    {
      rotulo: "E-mail",
      valor: estado.email || "não tem",
      href: estado.email ? `mailto:${estado.email}` : null,
      nota: !estado.email
        ? null
        : estado.emailForaDoDominio ? "domínio diferente do da empresa"
        : estado.emailDeBalcao ? "caixa compartilhada"
        : estado.emailConferido ? `SMTP validado${dia(estado.emailConferidoEm) ? ` · ${dia(estado.emailConferidoEm)}` : ""}`
        : "não conferido",
      ok: !!estado.email && !estado.emailDeBalcao && !estado.emailForaDoDominio && !!estado.emailConferido,
      alerta: !!estado.email && (estado.emailDeBalcao || estado.emailForaDoDominio),
    },
    {
      rotulo: "WhatsApp",
      valor: estado.telefone || "sem telefone",
      // o link da conversa só aparece quando o número FOI confirmado: mandar mensagem
      // para número não verificado é como o fixo virou WhatsApp de estranho semana
      // passada.
      href: estado.waStatus === "valid" ? waHref : null,
      nota:
        estado.waStatus === "valid" ? `tem WhatsApp${dia(estado.waCheckedAt) ? ` · ${dia(estado.waCheckedAt)}` : ""}`
        : estado.waStatus === "invalid" ? "este número não tem WhatsApp"
        : estado.telefone ? "não verificado"
        : null,
      ok: estado.waStatus === "valid",
      alerta: estado.waStatus === "invalid",
    },
    {
      rotulo: "Redes",
      valor: igHref && liHref ? "Instagram" : igHref ? "Instagram" : liHref ? "LinkedIn" : "não tem",
      href: igHref || liHref,
      ok: estado.temRede,
    },
    {
      rotulo: "Receita",
      valor: estado.enriquecido
        ? `enriquecido${dia(estado.enriquecidoEm) ? ` · ${dia(estado.enriquecidoEm)}` : ""}`
        : estado.temCnpj ? "não enriquecido" : "sem CNPJ",
      ok: estado.enriquecido,
    },
  ];

  return (
    <div className="rounded-lg border border-line bg-muted/30 p-3">
      {/* o quadro de canais: o que existe hoje, com o valor e o link */}
      <div className="grid gap-2 sm:grid-cols-2">
        {canais.map((c) => (
          <div key={c.rotulo} className="min-w-0 rounded-lg border border-line bg-white px-2.5 py-1.5">
            <p className="text-[11px] uppercase tracking-wide text-subtle">{c.rotulo}</p>
            <p className="truncate text-sm" title={c.valor}>
              {c.href ? (
                <a
                  href={c.href}
                  target={c.href.startsWith("mailto:") ? undefined : "_blank"}
                  rel="noreferrer"
                  className="font-medium text-brand-dark hover:underline"
                >
                  {c.valor}
                </a>
              ) : (
                <span className={c.ok ? "font-medium text-brand-dark" : "text-subtle"}>{c.valor}</span>
              )}
              {/* o segundo perfil precisa do clique dele */}
              {c.rotulo === "Redes" && igHref && liHref && (
                <a href={liHref} target="_blank" rel="noreferrer" className="ml-2 text-xs text-brand-dark hover:underline">
                  LinkedIn ↗
                </a>
              )}
            </p>
            {c.nota && (
              <p className={`truncate text-[11px] ${c.alerta ? "text-warn" : c.ok ? "text-signal" : "text-subtle"}`} title={c.nota}>
                {c.ok && !c.alerta ? "✓ " : c.alerta ? "⚠ " : ""}
                {c.nota}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          className="btn-brand py-1.5 text-sm disabled:opacity-50"
          onClick={rodar}
          disabled={!!rodando || nadaAFazer}
          title={
            nadaAFazer
              ? "Não há por onde: ou já está tudo preenchido, ou falta CNPJ e domínio."
              : `Roda em ordem: ${pendentes.map((p) => ROTULO[p]).join(" → ")}. Cada passo alimenta o seguinte.`
          }
        >
          {rodando ? "Atualizando…" : nadaAFazer ? "✓ Nada a descobrir" : `⟳ Atualizar dados (${pendentes.length})`}
        </button>
        {!rodando && !nadaAFazer && (
          <span className="text-xs text-subtle">{pendentes.map((p) => ROTULO[p]).join(" → ")}</span>
        )}
        {rodando && <span className="text-xs text-subtle">{EM_ANDAMENTO[rodando]}</span>}
        <button
          type="button"
          className="ml-auto rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40"
          disabled={buscandoWa || !!rodando}
          onClick={buscarWaNoSite}
          title="Lê o site da empresa atrás de um botão de WhatsApp. Pode trazer um número diferente do cadastrado — é o caso quando o telefone salvo é fixo."
        >
          {buscandoWa ? "Lendo o site…" : "↻ Buscar WhatsApp no site"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40"
          disabled={conferindoEmail || !!rodando}
          onClick={conferirEmail}
          title="Testa os padrões do decisor contra o servidor do domínio. Só troca se o servidor confirmar um endereço diferente — e o confirmado já vem com o selo SMTP validado."
        >
          {conferindoEmail ? "Conferindo…" : "✉ Conferir e-mail"}
        </button>
      </div>

      {recadoEmail && (
        <div className={`mt-2 rounded-lg border p-2 text-xs ${recadoEmail.ok ? "border-signal/30 bg-signal/5" : "border-line bg-white"}`}>
          <p className="font-semibold">{recadoEmail.titulo}</p>
          {recadoEmail.detalhe && <p className="mt-0.5 text-subtle">{recadoEmail.detalhe}</p>}
        </div>
      )}
      {recadoWa && (
        <div className={`mt-2 rounded-lg border p-2 text-xs ${recadoWa.ok ? "border-signal/30 bg-signal/5" : "border-line bg-white"}`}>
          <p className="font-semibold">{recadoWa.titulo}</p>
          {recadoWa.detalhe && <p className="mt-0.5 text-subtle">{recadoWa.detalhe}</p>}
        </div>
      )}

      {estado.emailForaDoDominio && !rodando && (
        <p className="mt-2 text-xs text-warn">
          O e-mail atual é de um domínio diferente do da empresa — herança de cadastro
          antigo. Vou procurar o do decisor no domínio certo; só troco se o servidor
          confirmar.
        </p>
      )}
      {estado.emailDeBalcao && !estado.emailForaDoDominio && !rodando && (
        <p className="mt-2 text-xs text-warn">
          O e-mail atual é de caixa compartilhada. Vou procurar o do decisor no mesmo
          domínio — e só troco se o servidor confirmar.
        </p>
      )}

      {linhas.length > 0 && (
        <ul className="mt-3 space-y-1">
          {linhas.filter(Boolean).map((l, i) => (
            <li key={i} className={`text-xs ${cor(l.tom)}`}>
              <span className="inline-block w-4">{icone(l.tom)}</span>
              <b className="font-medium">{ROTULO[l.passo] || l.passo}</b>: {l.texto}
            </li>
          ))}
        </ul>
      )}

      {pronto && !rodando && (
        <p className="mt-2 text-xs text-subtle">
          Terminei. O que ficou em branco ou não existe publicado, ou o servidor do
          domínio não confirma — nos dois casos insistir agora não muda o resultado.
        </p>
      )}
    </div>
  );
}
