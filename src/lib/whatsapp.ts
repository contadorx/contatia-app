import "server-only";

export type WaAccount = {
  evolution_url: string;
  api_key: string;
  instance: string;
};

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

// QR para conectar a instância: GET /instance/connect/{instance}
export async function getQR(acc: WaAccount): Promise<{ base64?: string; error?: string }> {
  try {
    const res = await fetch(`${base(acc.evolution_url)}/instance/connect/${acc.instance}`, {
      headers: { apikey: acc.api_key },
    });
    const data = await res.json().catch(() => ({}));
    const b64 = data?.base64 || data?.qrcode?.base64 || data?.qrcode?.code;
    if (b64) return { base64: b64 };
    return { error: "Instância já conectada ou QR indisponível." };
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
