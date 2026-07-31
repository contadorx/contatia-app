import "server-only";

// ============================================================
// E-MAIL DE CONVITE PARA A EQUIPE
//
// Este e-mail NÃO é o do Supabase Auth. O Supabase manda o "confirme seu cadastro"
// quando a pessoa cria a conta; este aqui é do Contatia e diz "fulano te chamou para o
// workspace X". São dois momentos diferentes e os dois precisam existir: quem recebe o
// convite ainda nem tem conta.
//
// Mesmo desenho dos modelos do Supabase (tabela de 520px, sem CSS externo, sem imagem
// remota) — cliente de e-mail não é navegador: Outlook ignora flexbox e grid, e imagem
// bloqueada por padrão faria o cabeçalho sumir. Por isso o "logo" é texto.
// ============================================================

const PAPEL_LABEL: Record<string, string> = {
  admin: "Admin — administra workspace e equipe",
  gestor: "Gestor — vê o pipeline e as cadências de todos",
  sdr: "SDR — prospecção e primeiros toques",
  vendedor: "Vendedor — trabalha a própria carteira",
};

function esc(s: string) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function assuntoConvite(workspace?: string | null) {
  const w = (workspace || "").trim();
  return w ? `Você foi convidado para o ${w} no Contatia` : "Você foi convidado para uma equipe no Contatia";
}

export function textoConvite(p: {
  link: string;
  workspace?: string | null;
  convidadoPor?: string | null;
  papel?: string | null;
  validade?: string | null;
}) {
  const quem = (p.convidadoPor || "").trim();
  const w = (p.workspace || "").trim();
  const alvo = w ? `o ${w}` : "uma equipe";   // sem nome do workspace, não sobra "o " solto
  return [
    quem ? `${quem} convidou você para ${alvo}, no Contatia.` : `Você foi convidado para ${alvo}, no Contatia.`,
    p.papel ? `Seu papel: ${PAPEL_LABEL[p.papel] || p.papel}.` : "",
    "",
    "Para entrar, abra o link abaixo. Se ainda não tiver conta, você cria na hora — leva um minuto.",
    p.link,
    "",
    p.validade ? `O convite vale até ${p.validade}.` : "",
    "Se você não esperava este convite, é só ignorar esta mensagem.",
  ].filter((l) => l !== null && l !== undefined).join("\n");
}

export function htmlConvite(p: {
  link: string;
  para: string;
  workspace?: string | null;
  convidadoPor?: string | null;
  papel?: string | null;
  validade?: string | null;
}) {
  const quem = esc((p.convidadoPor || "").trim());
  const w = esc((p.workspace || "").trim());
  const link = esc(p.link);
  const papel = p.papel ? esc(PAPEL_LABEL[p.papel] || p.papel) : "";
  const chamada = quem
    ? `<b>${quem}</b> convidou você para ${w ? `o <b>${w}</b>` : "uma equipe"}, no Contatia.`
    : `Você foi convidado para ${w ? `o <b>${w}</b>` : "uma equipe"}, no Contatia.`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Convite — Contatia</title>
</head>
<body style="margin:0;padding:0;background:#F5F6FA;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Abra o link e entre na equipe. Leva um minuto.</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F6FA;">
  <tr><td align="center" style="padding:32px 16px;">

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E4E6EF;border-radius:14px;">

      <tr><td style="padding:28px 32px 0 32px;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:#3627D6;letter-spacing:-0.3px;">Contatia</span>
      </td></tr>

      <tr><td style="padding:20px 32px 0 32px;">
        <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;font-weight:700;color:#16172A;">Você foi convidado</h1>
      </td></tr>

      <tr><td style="padding:14px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#16172A;">
        <p style="margin:0">${chamada}</p>
        ${papel ? `<p style="margin:12px 0 0 0;color:#667085;font-size:14px;">Seu papel: ${papel}.</p>` : ""}
      </td></tr>

      <tr><td style="padding:24px 32px 0 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:#4A3AFF;border-radius:10px;">
            <a href="${link}" style="display:inline-block;padding:13px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">Entrar na equipe</a>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:16px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;line-height:1.6;color:#16172A;">
        Ainda não tem conta? Você cria na hora, com este mesmo e-mail — leva um minuto.
      </td></tr>

      <tr><td style="padding:14px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#667085;">
        Se o botão não funcionar, copie e cole este endereço no navegador:<br>
        <span style="word-break:break-all;color:#3627D6;">${link}</span>
      </td></tr>

      <tr><td style="padding:26px 32px 0 32px;">
        <hr style="border:none;border-top:1px solid #E4E6EF;margin:0;">
      </td></tr>

      <tr><td style="padding:16px 32px 28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#667085;">
        ${p.validade ? `O convite vale até <b>${esc(p.validade)}</b>.<br>` : ""}
        Se você não esperava este convite, pode ignorar esta mensagem — nada acontece sem o seu clique.
      </td></tr>

    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
      <tr><td align="center" style="padding:18px 8px 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;line-height:1.6;color:#667085;">
        Contatia — prospecção e cadência B2B<br>
        Este e-mail foi enviado para ${esc(p.para)}.
      </td></tr>
    </table>

  </td></tr>
</table>
</body>
</html>`;
}
