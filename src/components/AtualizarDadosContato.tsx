"use client";

// ============================================================
// UM BOTÃO PARA ATUALIZAR OS DADOS DO CONTATO
//
// A ficha tinha SEIS lugares que atualizavam dado de contato: o selo do e-mail no
// cabeçalho, o bloco "procurar e-mail" (que só aparecia sem e-mail), a caixa de testar
// um e-mail avulso, o painel de redes, o painel "Revisar dados" (recolhido, e era lá
// que morava o WhatsApp) e o bloco de enriquecer pelo CNPJ.
//
// Na cabeça de quem usa, porém, isso é UMA decisão: "descubra o que der sobre esta
// pessoa". Seis controles para uma decisão é o operador tendo que conhecer a
// arquitetura do sistema para trabalhar.
//
// A ORDEM NÃO É ARBITRÁRIA — cada passo alimenta o seguinte:
//
//   1. CNPJ .......... nossa base no VPS, grátis e instantânea. Pode PREENCHER o
//                      domínio e o telefone, que os passos seguintes precisam.
//   2. site .......... com o domínio em mãos, raspa telefone, e-mail publicado,
//                      Instagram e LinkedIn numa passada só.
//   3. e-mail ........ conversa SMTP no worker; precisa de nome + domínio.
//   4. WhatsApp ...... Evolution; precisa do telefone, que o passo 1 ou 2 pode ter
//                      acabado de trazer.
//
// Rodar fora dessa ordem desperdiça: verificar WhatsApp antes de descobrir o telefone
// é uma chamada garantidamente inútil.
//
// O QUE ELE NÃO FAZ: substituir os controles finos. Reverificar só o WhatsApp, testar
// um endereço específico, corrigir o Instagram na mão — tudo continua existindo,
// recolhido embaixo. O botão é o caminho comum; os controles são o caminho preciso.
// ============================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enrichContact } from "@/app/dashboard/contatos/actions";
import { capturarDoSiteLote } from "@/app/dashboard/contatos/web-capture-actions";
import { capturarRedesDoSite } from "@/app/dashboard/contatos/social-actions";
import { buscarEmailAgora } from "@/app/dashboard/contatos/discovery-actions";
import { verificarWhatsAppLote } from "@/app/dashboard/contatos/wa-actions";

type Estado = {
  temCnpj: boolean;
  enriquecido: boolean;
  temDominio: boolean;
  temEmail: boolean;
  // `contato@`, `comercial@`… tecnicamente é um e-mail, mas não é o e-mail DO DECISOR.
  // Vale procurar o pessoal mesmo já tendo este.
  emailDeBalcao: boolean;
  temTelefone: boolean;
  waStatus: string | null;
  temRede: boolean;
};

type Linha = { passo: string; texto: string; tom: "ok" | "nada" | "erro" | "pulado" };

export default function AtualizarDadosContato({
  contactId,
  dominio,
  estado,
}: {
  contactId: string;
  dominio: string;                 // domínio corporativo conhecido (pode vir vazio)
  estado: Estado;
}) {
  const router = useRouter();
  const [rodando, setRodando] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [pronto, setPronto] = useState(false);

  // ============================================================
  // O QUE HÁ PARA FAZER — e o que NÃO há
  //
  // O botão só promete trabalho que existe. Quatro regras, cada uma achada testando:
  //
  // · o CNPJ ainda não enriquecido pode CRIAR o domínio, então site e e-mail entram no
  //   plano mesmo sem domínio hoje — passam a ser possíveis depois do passo 1;
  // · o site só entra se ainda falta algo que ele saiba dar (e-mail, telefone ou rede).
  //   Num contato completo, visitar o site é gastar tempo para reescrever o que já
  //   está lá;
  // · ter `contato@` NÃO é ter o e-mail do decisor. Tratar os dois como "já tem e-mail"
  //   fazia o botão parar de procurar justamente quando mais valia procurar;
  // · WhatsApp `invalid` é resposta, não ausência de resposta. Já sabemos que o número
  //   não tem WhatsApp. Reverificar continua possível no controle fino, para quando o
  //   telefone mudou.
  // ============================================================
  const podeTerDominio = estado.temDominio || (estado.temCnpj && !estado.enriquecido);
  const faltaAlgoDoSite = !estado.temEmail || !estado.temTelefone || !estado.temRede;
  const waRespondido = estado.waStatus === "valid" || estado.waStatus === "invalid";
  const valeProcurarEmail = !estado.temEmail || estado.emailDeBalcao;

  const passos = [
    estado.temCnpj && !estado.enriquecido && "CNPJ",
    podeTerDominio && faltaAlgoDoSite && "site",
    valeProcurarEmail && podeTerDominio && "e-mail",
    estado.temTelefone && !waRespondido && "WhatsApp",
  ].filter(Boolean) as string[];

  const nadaAFazer = passos.length === 0;

  function add(l: Linha) { setLinhas((prev) => [...prev, l]); }

  async function rodar() {
    setLinhas([]);
    setPronto(false);
    // `dominioAtual` acompanha o que o passo 1 descobrir: sem isso, os passos 2 e 3
    // usariam o domínio que a página carregou ANTES do enriquecimento — e o contato que
    // mais precisa deles é justamente o que ainda não tinha domínio nenhum.
    let dominioAtual = dominio;
    let temTelefone = estado.temTelefone;

    try {
      // 1) CNPJ — nossa base, grátis
      if (estado.temCnpj && !estado.enriquecido) {
        setRodando("Consultando o CNPJ na base da Receita…");
        const r: any = await enrichContact(contactId);
        if (r?.error) add({ passo: "CNPJ", texto: r.error, tom: "erro" });
        else {
          add({ passo: "CNPJ", texto: "dados cadastrais atualizados", tom: "ok" });
          if (r?.dominio) dominioAtual = r.dominio;
          if (r?.telefone) temTelefone = true;
        }
      } else if (estado.temCnpj) {
        add({ passo: "CNPJ", texto: "já enriquecido — não repeti", tom: "pulado" });
      }

      // 2) site — telefone, e-mail publicado, Instagram e LinkedIn
      if ((dominioAtual || estado.temCnpj) && faltaAlgoDoSite) {
        setRodando("Lendo o site da empresa…");
        const [web, redes]: any[] = await Promise.all([
          capturarDoSiteLote([contactId]),
          capturarRedesDoSite([contactId]),
        ]);
        const achou: string[] = [];
        if (web?.achou) achou.push("e-mail ou telefone");
        if (web?.whats) achou.push("WhatsApp confirmado pelo wa.me");
        if (redes?.comIg) achou.push("Instagram");
        if (redes?.comLi) achou.push("LinkedIn");
        if (web?.error || redes?.error) {
          add({ passo: "site", texto: web?.error || redes?.error, tom: "erro" });
        } else if (achou.length) {
          add({ passo: "site", texto: achou.join(" · "), tom: "ok" });
          if (web?.achou) temTelefone = true;
        } else if (web?.semDominio || redes?.semDominio) {
          add({ passo: "site", texto: "sem domínio corporativo para visitar", tom: "pulado" });
        } else {
          add({ passo: "site", texto: "o site não publica esses dados", tom: "nada" });
        }
      }

      // 3) e-mail — conversa SMTP no worker
      if (valeProcurarEmail && (dominioAtual || estado.temCnpj)) {
        setRodando(
          estado.emailDeBalcao
            ? "Procurando o e-mail do decisor (o atual é caixa compartilhada)…"
            : "Procurando o e-mail (isso conversa com o servidor do domínio)…"
        );
        // forcar = true quando já existe um endereço: é o modo revisão, que só
        // substitui se o servidor do domínio confirmar um endereço diferente.
        const r: any = await buscarEmailAgora(contactId, dominioAtual || "", estado.temEmail);
        if (r?.ok && r?.email) add({ passo: "e-mail", texto: `achei ${r.email}`, tom: "ok" });
        else if (r?.error) add({ passo: "e-mail", texto: r.error, tom: "erro" });
        else add({ passo: "e-mail", texto: r?.detalhe || r?.titulo || "nenhum endereço confirmado", tom: "nada" });
      } else if (estado.temEmail) {
        add({ passo: "e-mail", texto: "já tem o e-mail do decisor — não procurei outro", tom: "pulado" });
      }

      // 4) WhatsApp — precisa do telefone que os passos acima podem ter trazido
      if (temTelefone && !waRespondido) {
        setRodando("Verificando o WhatsApp…");
        const r: any = await verificarWhatsAppLote([contactId]);
        if (r?.error) add({ passo: "WhatsApp", texto: r.error, tom: "erro" });
        else if (r?.comWa) add({ passo: "WhatsApp", texto: "número tem WhatsApp", tom: "ok" });
        else if (r?.semWa) add({ passo: "WhatsApp", texto: "número não tem WhatsApp", tom: "nada" });
        else if (r?.enfileirados) add({ passo: "WhatsApp", texto: "entrou na fila — o robô confere em até 1h", tom: "pulado" });
        else add({ passo: "WhatsApp", texto: "sem resposta da verificação", tom: "nada" });
      } else if (!temTelefone) {
        add({ passo: "WhatsApp", texto: "sem telefone para verificar", tom: "pulado" });
      } else {
        add({
          passo: "WhatsApp",
          texto: estado.waStatus === "valid"
            ? "já confirmado — não repeti"
            : "já verificado: este número não tem WhatsApp",
          tom: "pulado",
        });
      }
    } catch (e: any) {
      add({ passo: "erro", texto: e?.message || "algo falhou no meio do caminho", tom: "erro" });
    } finally {
      setRodando(null);
      setPronto(true);
      router.refresh();
    }
  }

  const cor = (t: Linha["tom"]) =>
    t === "ok" ? "text-brand-dark" : t === "erro" ? "text-danger" : "text-subtle";
  const icone = (t: Linha["tom"]) =>
    t === "ok" ? "✓" : t === "erro" ? "✕" : t === "nada" ? "—" : "·";

  return (
    <div className="rounded-lg border border-line bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-brand py-1.5 text-sm disabled:opacity-50"
          onClick={rodar}
          disabled={!!rodando || nadaAFazer}
          title={
            nadaAFazer
              ? "Não há por onde: ou já está tudo preenchido, ou falta CNPJ e domínio — sem um dos dois não há o que consultar."
              : `Roda em ordem: ${passos.join(" → ")}. Cada passo alimenta o seguinte.`
          }
        >
          {rodando ? "Atualizando…" : nadaAFazer ? "✓ Nada a descobrir" : `⟳ Atualizar dados (${passos.length})`}
        </button>
        {!rodando && !nadaAFazer && (
          <span className="text-xs text-subtle">{passos.join(" → ")}</span>
        )}
        {rodando && <span className="text-xs text-subtle">{rodando}</span>}
      </div>

      {estado.emailDeBalcao && !rodando && (
        <p className="mt-2 text-xs text-warn">
          O e-mail atual é de caixa compartilhada. Vou procurar o endereço do decisor no
          mesmo domínio — e só troco se o servidor confirmar.
        </p>
      )}

      {linhas.length > 0 && (
        <ul className="mt-3 space-y-1">
          {linhas.map((l, i) => (
            <li key={i} className={`text-xs ${cor(l.tom)}`}>
              <span className="inline-block w-4">{icone(l.tom)}</span>
              <b className="font-medium">{l.passo}</b>: {l.texto}
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
