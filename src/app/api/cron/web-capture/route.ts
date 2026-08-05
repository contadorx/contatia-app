import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { buildCaptureUpdate, ehFixoBr } from "@/lib/webPhone";
import { varrerSite } from "@/lib/varrerSite";
import { dominioDe } from "@/lib/emailFinder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================
// UMA PASSADA NO SITE, TUDO O QUE ELE PUBLICA
//
// Esta rota fazia duas varreduras do MESMO site, uma atrás da outra: primeiro
// telefone/WhatsApp, depois e-mail. E as redes sociais eram uma terceira varredura,
// noutro lugar do app, disparada à mão.
//
// Três leituras da mesma página para responder três perguntas sobre o mesmo HTML —
// e, pior, com listas de páginas DIFERENTES: a varredura de telefone não visitava
// /sobre nem /quem-somos, então um WhatsApp publicado ali nunca era encontrado,
// embora a varredura de redes lesse exatamente aquele HTML e o descartasse.
//
// Agora é uma leitura só. Quem abre /sobre atrás do Instagram acha o WhatsApp de
// graça. Sobra orçamento de tempo, e a esteira do Radar passa a entregar telefone,
// WhatsApp, e-mail publicado, Instagram e LinkedIn numa única etapa.
// ============================================================
const BATCH = 24;
const PARALELO = 6;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}` && key !== secret) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SERVICE_ROLE ausente" }, { status: 500 });

  // select("*") no contato: instagram/linkedin nascem na 0110 e, pedidas pelo nome,
  // derrubariam a fila inteira enquanto a migration não estivesse aplicada.
  const { data: rows, error: erroFila } = await admin
    .from("contacts")
    .select("*, accounts(domain, website)")
    .eq("web_capture", "queued")
    // `limit` sem `order by` repete e PULA linhas: um contato pode ficar na fila para
    // sempre sem nunca ser sorteado. A ordem por criação também define quem é o
    // "principal" de cada empresa no agrupamento abaixo.
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (erroFila) return NextResponse.json({ error: (erroFila as any).message }, { status: 500 });

  const list = ((rows as any[]) || []).map((c) => ({
    id: c.id as string,
    tenant_id: c.tenant_id as string,
    phone: (c.phone as string | null) || null,
    email: (c.email as string | null) || null,
    wa_status: (c.wa_status as string | null) || null,
    instagram: (c.instagram as string | null) || null,
    linkedin: (c.linkedin as string | null) || null,
    account_id: (c.account_id as string | null) || null,
    domain: dominioDe(c.company_domain || c.accounts?.domain || c.accounts?.website || null),
  }));
  if (!list.length) return NextResponse.json({ ok: true, capturados: 0 });

  // sem domínio → não há o que raspar
  const semDom = list.filter((c) => !c.domain);
  await Promise.all(semDom.map((c) => admin.from("contacts").update({ web_capture: "notfound" }).eq("id", c.id)));

  const comDom = list.filter((c) => c.domain);

  // ============================================================
  // UM SITE, UMA LEITURA — MESMO COM QUATRO SÓCIOS
  //
  // A importação do Radar enfileira a captura para CADA sócio da empresa. Como todos
  // compartilham o domínio, o cron lia o mesmo site 4 vezes e gravava o MESMO telefone
  // nos 4 contatos. Uma cadência de WhatsApp depois disso gera 4 tarefas para o mesmo
  // número: 4 mensagens idênticas, do mesmo remetente, para a mesma pessoa. É pedido
  // de bloqueio.
  //
  // A regra vem de a QUEM o dado pertence:
  //
  //   DA EMPRESA (telefone, WhatsApp, e-mail publicado, Instagram, LinkedIn da página)
  //     → é um só. Vai para a EMPRESA e para UM contato — o mais antigo do grupo, que
  //       é o que a importação tratou como principal. Os irmãos ficam sem, de
  //       propósito: quem quiser falar pelo canal da empresa fala pela empresa.
  //
  //   DA PESSOA (e-mail nome@dominio confirmado no servidor)
  //     → esse sim é individual, e continua sendo descoberto um a um pela fila SMTP,
  //       que é outra etapa.
  //
  // Agrupar aqui, e não na importação, conserta também a fila que JÁ está cheia de
  // sócios enfileirados — sem migration e sem reimportar nada.
  // ============================================================
  const porDominio = new Map<string, typeof comDom>();
  for (const c of comDom) {
    const k = c.domain!;
    if (!porDominio.has(k)) porDominio.set(k, []);
    porDominio.get(k)!.push(c);
  }
  // dentro de cada empresa, o mais antigo primeiro (é ele que recebe os dados)
  const grupos = Array.from(porDominio.values()).map((g) => g.slice());

  const prazo = Date.now() + 45_000;
  let achou = 0, whats = 0, emails = 0, redes = 0, inacessivel = 0, adiados = 0, irmaosPoupados = 0;

  let i = 0;
  const trabalhador = async () => {
    while (i < grupos.length) {
      // Estourou o tempo? O contato fica 'queued' e volta na próxima rodada — nunca
      // marcamos como "procurei e não achei" algo que não chegamos a procurar.
      if (Date.now() > prazo) { adiados++; i++; continue; }
      const grupo = grupos[i++];
      const c = grupo[0];                 // o principal: recebe os dados da empresa
      const irmaos = grupo.slice(1);      // os demais sócios do mesmo site

      // O que ainda falta neste contato. Pedir só o que falta encurta a varredura:
      // com tudo preenchido, ela nem sai da home.
      const quero: any[] = [];
      if (!c.phone || c.wa_status !== "valid") quero.push("whatsapp", "telefone");
      if (!c.email) quero.push("email");
      if (!c.instagram) quero.push("instagram");
      if (!c.linkedin) quero.push("linkedin");
      // Os irmãos saem da fila agora: o site é o mesmo, e o que ele publica pertence à
      // empresa. Marcar aqui evita que a próxima rodada os leia de novo.
      const tirarIrmaosDaFila = async () => {
        if (!irmaos.length) return;
        irmaosPoupados += irmaos.length;
        await Promise.all(irmaos.map((x) => admin.from("contacts").update({ web_capture: "done" }).eq("id", x.id)));
      };

      if (!quero.length) {
        await admin.from("contacts").update({ web_capture: "done" }).eq("id", c.id);
        await tirarIrmaosDaFila();
        continue;
      }

      let r;
      try {
        r = await varrerSite(c.domain!, { quero });
      } catch {
        adiados++;   // falha de rede: tenta de novo na próxima rodada
        continue;
      }

      if (r.siteInacessivel) {
        inacessivel++;
        await admin.from("contacts").update({ web_capture: "notfound" }).eq("id", c.id);
        if (irmaos.length) {
          irmaosPoupados += irmaos.length;
          await Promise.all(irmaos.map((x) => admin.from("contacts").update({ web_capture: "notfound" }).eq("id", x.id)));
        }
        continue;
      }

      // telefone/WhatsApp: a mesma regra de antes, inclusive a de não deixar um fixo
      // receber o 9º dígito e virar o celular de um estranho.
      const upd: Record<string, unknown> = buildCaptureUpdate(
        { id: c.id, whatsapp: r.whatsapp, phone: r.telefone, source: r.fonte.whatsapp || r.fonte.telefone || null },
        c,
        new Date().toISOString()
      );
      if (r.whatsapp) { achou++; whats++; }
      else if (r.telefone && !ehFixoBr(r.telefone)) achou++;

      if (r.email && !c.email) { upd.email = r.email; emails++; }
      // As redes vêm de graça: a página já estava aberta. Antes exigiam uma varredura
      // à parte, disparada à mão, contato por contato.
      if (r.instagram && !c.instagram) { upd.instagram = r.instagram; upd.instagram_origem = "site"; upd.instagram_conferido_at = new Date().toISOString(); redes++; }
      if (r.linkedin && !c.linkedin) { upd.linkedin = r.linkedin; upd.linkedin_origem = "site"; upd.linkedin_conferido_at = new Date().toISOString(); redes++; }

      // `buildCaptureUpdate` marca 'notfound' quando não achou telefone nenhum — regra
      // dele, de quando esta etapa só procurava telefone. Agora a etapa também traz
      // e-mail e redes: se veio alguma coisa, a passada no site FOI útil e o estado é
      // 'done'. Deixar 'notfound' faria o selo da esteira mentir.
      if (upd.web_capture === "notfound" && (upd.email || upd.instagram || upd.linkedin)) {
        upd.web_capture = "done";
      }

      const { error } = await admin.from("contacts").update(upd).eq("id", c.id);
      // A escrita é conferida: sem isto, uma recusa do banco deixava o contato como
      // "capturado" sem nada gravado, e ninguém ficava sabendo.
      if (error) { await admin.from("contacts").update({ web_capture: "queued" }).eq("id", c.id); continue; }

      await tirarIrmaosDaFila();

      // O que é da EMPRESA vai para a empresa: é ali que ele serve a todos os sócios
      // sem duplicar canal de envio.
      const contaId = (c as any).account_id;
      if (contaId) {
        const daEmpresa: Record<string, unknown> = {};
        if (r.telefone) daEmpresa.phone = r.telefone;
        if (r.email) daEmpresa.email = r.email;
        if (r.instagram) daEmpresa.instagram = r.instagram;
        if (r.linkedin) daEmpresa.linkedin = r.linkedin;
        if (Object.keys(daEmpresa).length) {
          // update simples: não sobrescreve o que já existe porque o PostgREST só
          // grava as colunas enviadas, e estas só entram quando o site respondeu.
          await admin.from("accounts").update(daEmpresa).eq("id", contaId);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALELO, comDom.length) }, trabalhador));

  return NextResponse.json({
    ok: true,
    empresas: grupos.length, contatos: comDom.length,
    achou, whats, emails, redes, inacessivel, adiados,
    // quantos sócios deixaram de ser lidos por já terem sido cobertos pelo irmão —
    // é o número que mostra o tamanho do desperdício que existia
    irmaosPoupados,
  });
}
