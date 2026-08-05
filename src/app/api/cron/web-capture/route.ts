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
    // sempre sem nunca ser sorteado.
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
    domain: dominioDe(c.company_domain || c.accounts?.domain || c.accounts?.website || null),
  }));
  if (!list.length) return NextResponse.json({ ok: true, capturados: 0 });

  // sem domínio → não há o que raspar
  const semDom = list.filter((c) => !c.domain);
  await Promise.all(semDom.map((c) => admin.from("contacts").update({ web_capture: "notfound" }).eq("id", c.id)));

  const comDom = list.filter((c) => c.domain);
  const prazo = Date.now() + 45_000;
  let achou = 0, whats = 0, emails = 0, redes = 0, inacessivel = 0, adiados = 0;

  let i = 0;
  const trabalhador = async () => {
    while (i < comDom.length) {
      // Estourou o tempo? O contato fica 'queued' e volta na próxima rodada — nunca
      // marcamos como "procurei e não achei" algo que não chegamos a procurar.
      if (Date.now() > prazo) { adiados++; i++; continue; }
      const c = comDom[i++];

      // O que ainda falta neste contato. Pedir só o que falta encurta a varredura:
      // com tudo preenchido, ela nem sai da home.
      const quero: any[] = [];
      if (!c.phone || c.wa_status !== "valid") quero.push("whatsapp", "telefone");
      if (!c.email) quero.push("email");
      if (!c.instagram) quero.push("instagram");
      if (!c.linkedin) quero.push("linkedin");
      if (!quero.length) {
        await admin.from("contacts").update({ web_capture: "done" }).eq("id", c.id);
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
      if (error) await admin.from("contacts").update({ web_capture: "queued" }).eq("id", c.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALELO, comDom.length) }, trabalhador));

  return NextResponse.json({ ok: true, capturados: comDom.length, achou, whats, emails, redes, inacessivel, adiados });
}
