import "server-only";
import QRCode from "qrcode";

export type WaAccount = {
  evolution_url: string;
  api_key: string;
  instance: string;
};

// Servidor Evolution da PLATAFORMA (gerenciado por nós). Quando configurado,
// o cliente não precisa saber de URL/chave — ao ativar o modo Evolution, criamos
// a instância dele no nosso servidor e ele só escaneia o QR. Sem estas envs, o
// app cai no modo "traga seu servidor" (BYO), com os campos avançados na tela.
export function platformEvolution(): { url: string; api_key: string } | null {
  const url = process.env.EVOLUTION_URL;
  const key = process.env.EVOLUTION_API_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), api_key: key };
}

export function platformEvolutionReady(): boolean {
  return !!platformEvolution();
}

// Gera a IMAGEM do QR a partir do TEXTO, LOCALMENTE (nunca manda o código de
// pareamento — que é a credencial da sessão do cliente — para um serviço externo).
async function qrFromText(texto: string): Promise<string | undefined> {
  try {
    return await QRCode.toDataURL(texto, { width: 300, margin: 1 });
  } catch {
    return undefined;
  }
}

function normalizePhone(phone: string): string {
  let d = (phone || "").replace(/\D/g, "");
  if (d && d.length <= 11) d = "55" + d;
  return d;
}

function base(url: string) {
  return url.replace(/\/+$/, "");
}

// Envia texto. Formato Evolution API v2: POST /message/sendText/{instance}
export async function sendText(acc: WaAccount, to: string, text: string): Promise<{ ok?: boolean; error?: string }> {
  const number = normalizePhone(to);
  if (!number) return { error: "Telefone inválido." };
  try {
    const res = await fetch(`${base(acc.evolution_url)}/message/sendText/${acc.instance}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: acc.api_key },
      body: JSON.stringify({ number, text }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { error: `Evolution ${res.status}: ${t.slice(0, 160)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { error: e?.message || "Falha ao enviar WhatsApp." };
  }
}

// ============================================================
// QR para conectar a instância.
//
// A Evolution API nova EXIGE que a instância seja criada com o parâmetro
// "integration": "WHATSAPP-BAILEYS". Sem isso ela até cria a instância, mas
// NÃO gera o QR — e o app mostrava "QR indisponível" para sempre.
//
// Fluxo correto:
//   1. A instância existe? Se não, cria (com integration) — a resposta já traz o QR.
//   2. Se já existe, pede o QR em /instance/connect/{nome}.
// ============================================================
export async function getQR(acc: WaAccount): Promise<{ base64?: string; error?: string }> {
  const url = base(acc.evolution_url);
  const headers = { apikey: acc.api_key, "Content-Type": "application/json" };

  /**
   * A Evolution devolve o QR de duas formas:
   *   - base64: já é a IMAGEM pronta ("data:image/png;base64,...")
   *   - code:   é o TEXTO do QR ("2@LyVeq...") — precisa virar imagem
   * Devolvemos sempre algo que o <img> consiga exibir.
   */
  const extrairQR = async (data: any): Promise<string | undefined> => {
    const img = data?.base64 || data?.qrcode?.base64;
    if (img) return img;

    const texto = data?.qrcode?.code || data?.code;
    if (texto) {
      // gera a imagem do QR LOCALMENTE — o código de pareamento nunca sai do servidor
      return await qrFromText(texto);
    }
    return undefined;
  };

  try {
    // 1) a instância já existe?
    let existe = false;
    try {
      const lista = await fetch(`${url}/instance/fetchInstances`, { headers: { apikey: acc.api_key } });
      const arr = await lista.json().catch(() => []);
      existe = Array.isArray(arr)
        && arr.some((i: any) => (i?.name || i?.instance?.instanceName || i?.instanceName) === acc.instance);
    } catch { /* segue: tentamos criar */ }

    // 2) não existe → cria (a resposta da criação já vem com o QR)
    if (!existe) {
      const criar = await fetch(`${url}/instance/create`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          instanceName: acc.instance,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",   // ← o que faltava
        }),
      });
      const data = await criar.json().catch(() => ({}));

      const b64 = await extrairQR(data);
      if (b64) return { base64: b64 };

      // já existia (corrida) → cai para o connect abaixo
      const msg = String(data?.response?.message || data?.message || "");
      if (!/already in use|already exists/i.test(msg) && !criar.ok) {
        return { error: `Evolution: ${msg || criar.status}` };
      }
    }

    // 3) existe → pede o QR
    const res = await fetch(`${url}/instance/connect/${acc.instance}`, {
      headers: { apikey: acc.api_key },
    });
    const data = await res.json().catch(() => ({}));
    const b64 = await extrairQR(data);
    if (b64) return { base64: b64 };

    // sem QR: ou já está conectada, ou está num estado ruim
    const estado = data?.instance?.state || data?.state;
    if (estado === "open") return { error: "Este número já está conectado." };

    return {
      error: "A instância não gerou o QR. Clique em Remover e conecte de novo com um nome novo.",
    };
  } catch (e: any) {
    return { error: e?.message || "Falha ao obter QR." };
  }
}

// Estado da conexão: GET /instance/connectionState/{instance}
export async function getStatus(acc: WaAccount): Promise<{ state?: string; error?: string }> {
  try {
    const res = await fetch(`${base(acc.evolution_url)}/instance/connectionState/${acc.instance}`, {
      headers: { apikey: acc.api_key },
    });
    const data = await res.json().catch(() => ({}));
    return { state: data?.instance?.state || data?.state || "desconhecido" };
  } catch (e: any) {
    return { error: e?.message || "Falha ao consultar status." };
  }
}

export { normalizePhone };

// ============================================================
// Apaga a instância no servidor Evolution.
// Sem isto, "Remover" no app deixava a instância órfã lá — e ao tentar
// conectar de novo com o mesmo nome, ela vinha travada.
// ============================================================
export async function deleteInstance(acc: WaAccount): Promise<{ ok?: boolean; error?: string }> {
  const url = base(acc.evolution_url);
  const headers = { apikey: acc.api_key };

  try {
    // desconecta a sessão (se estiver conectada)
    await fetch(`${url}/instance/logout/${acc.instance}`, { method: "DELETE", headers }).catch(() => {});
    // apaga a instância
    const res = await fetch(`${url}/instance/delete/${acc.instance}`, { method: "DELETE", headers });
    if (!res.ok && res.status !== 404) {
      const d = await res.json().catch(() => ({}));
      return { error: `Evolution: ${(d as any)?.message || res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { error: e?.message || "Falha ao remover a instância." };
  }
}

// ============================================================
// Configura o webhook na Evolution AUTOMATICAMENTE.
//
// Sem isto, o usuário teria que copiar a URL e colar na Evolution na mão —
// e se esquecer, a cadência NUNCA pausa quando o lead responde (você seguiria
// mandando follow-up para quem já respondeu).
//
// Escutamos MESSAGES_UPSERT (mensagem recebida) e CONNECTION_UPDATE (status).
// ============================================================
export async function setWebhook(acc: WaAccount, webhookUrl: string): Promise<{ ok?: boolean; error?: string }> {
  const url = base(acc.evolution_url);
  const headers = { apikey: acc.api_key, "Content-Type": "application/json" };

  // a Evolution mudou o formato do corpo entre versões — tentamos os dois
  const formatos = [
    {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    },
    {
      enabled: true,
      url: webhookUrl,
      webhook_by_events: false,
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
    },
  ];

  let ultimoErro = "";
  for (const body of formatos) {
    try {
      const res = await fetch(`${url}/webhook/set/${acc.instance}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true };
      const d = await res.json().catch(() => ({}));
      ultimoErro = String((d as any)?.message || (d as any)?.response?.message || res.status);
    } catch (e: any) {
      ultimoErro = e?.message || "falha de rede";
    }
  }

  return { error: `Não consegui configurar o webhook: ${ultimoErro}` };
}
