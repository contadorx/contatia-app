import "server-only";

async function accessToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tok = (await res.json()) as { access_token?: string };
  return tok.access_token || null;
}

export async function createCalendarEvent(
  refreshToken: string,
  input: { summary: string; startISO: string; durationMin: number; attendeeEmail?: string | null; location?: string | null; description?: string | null }
): Promise<{ id?: string; link?: string; error?: string }> {
  const token = await accessToken(refreshToken);
  if (!token) return { error: "Não foi possível autenticar no Google." };

  const start = new Date(input.startISO);
  const end = new Date(start.getTime() + (input.durationMin || 30) * 60000);
  const body: any = {
    summary: input.summary,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
  if (input.location) body.location = input.location;
  if (input.description) body.description = input.description;
  if (input.attendeeEmail) body.attendees = [{ email: input.attendeeEmail }];

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
    { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }
  );
  if (!res.ok) return { error: `Google Calendar: ${res.status}` };
  const ev = (await res.json()) as { id?: string; htmlLink?: string };
  return { id: ev.id, link: ev.htmlLink };
}

export async function deleteCalendarEvent(refreshToken: string, eventId: string): Promise<void> {
  const token = await accessToken(refreshToken);
  if (!token) return;
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
}

// Consulta o free/busy do Google Calendar (agenda primária) entre duas datas.
// Retorna os períodos OCUPADOS como pares [inícioMs, fimMs], para bloquear slots
// de agendamento que conflitam com QUALQUER compromisso do Google — não só reuniões
// do Contatia. Falha silenciosa (retorna []) para nunca quebrar o agendamento público.
export async function getBusyBlocks(
  refreshToken: string,
  timeMinISO: string,
  timeMaxISO: string
): Promise<{ start: number; end: number }[]> {
  try {
    const token = await accessToken(refreshToken);
    if (!token) return [];
    const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        timeMin: timeMinISO,
        timeMax: timeMaxISO,
        items: [{ id: "primary" }],
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const busy = data?.calendars?.primary?.busy || [];
    return busy
      .map((b: any) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
      .filter((b: any) => !isNaN(b.start) && !isNaN(b.end));
  } catch {
    return [];
  }
}
