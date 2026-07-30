import "server-only";

// ============================================================
// Gera um convite de calendário (iCalendar / .ics) que o Gmail, o Outlook e o
// Apple Mail reconhecem como CONVITE — com botões Sim/Não e bloqueio na agenda do
// destinatário. É o que faz a reunião "travar do outro lado" mesmo sem Google conectado.
// METHOD:REQUEST = convite; STATUS:CONFIRMED; cada convidado vira uma linha ATTENDEE.
// ============================================================

export type IcsPessoa = { email: string; name?: string | null };

function pad(n: number) { return String(n).padStart(2, "0"); }

// data UTC no formato básico do iCalendar: 20260901T143000Z
function toICSDate(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

// escapa os caracteres especiais do texto iCalendar (RFC 5545)
function esc(s: string | null | undefined): string {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// dobra linhas com mais de 75 octetos (RFC 5545) — evita clientes recusarem o arquivo
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let cur = line;
  while (cur.length > 74) {
    parts.push(cur.slice(0, 74));
    cur = " " + cur.slice(74);
  }
  parts.push(cur);
  return parts.join("\r\n");
}

export function buildIcs(opts: {
  uid: string;
  summary: string;
  startISO: string;
  durationMin: number;
  organizer: IcsPessoa;
  attendees: IcsPessoa[];
  location?: string | null;
  description?: string | null;
  method?: "REQUEST" | "CANCEL";
  sequence?: number;
}): string {
  const start = new Date(opts.startISO);
  const end = new Date(start.getTime() + (opts.durationMin || 30) * 60000);
  const method = opts.method || "REQUEST";
  const status = method === "CANCEL" ? "CANCELLED" : "CONFIRMED";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Contatia//Reunioes//PT-BR",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SEQUENCE:${opts.sequence || 0}`,
    `STATUS:${status}`,
    "TRANSP:OPAQUE",
    `SUMMARY:${esc(opts.summary || "Reunião")}`,
  ];
  if (opts.description) lines.push(`DESCRIPTION:${esc(opts.description)}`);
  if (opts.location) lines.push(`LOCATION:${esc(opts.location)}`);
  lines.push(
    `ORGANIZER;CN=${esc(opts.organizer.name || opts.organizer.email)}:mailto:${opts.organizer.email}`
  );
  for (const a of opts.attendees) {
    if (!a?.email) continue;
    lines.push(
      `ATTENDEE;CN=${esc(a.name || a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(fold).join("\r\n");
}
