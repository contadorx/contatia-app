// ============================================================
// Contatia — Worker de descoberta/verificação de e-mail
//
// POR QUE EXISTE: a verificação de e-mail exige uma conversa SMTP na porta 25,
// que o Vercel (e a maioria dos PaaS) bloqueia na saída. Então o app chama este
// worker, hospedado num VPS com porta 25 liberada e — CRUCIAL — com rDNS/PTR
// e HELO alinhados (veja o README: sem isso, muitos servidores recusam a
// conversa e a gente conclui "não existe" quando na verdade existe = FALSO
// NEGATIVO, o bug clássico).
//
// Endpoints (auth Bearer WORKER_TOKEN):
//   POST /discover  { nome, dominio }  -> acha o e-mail do decisor pelos padrões
//   POST /verify    { email }          -> verifica um e-mail específico
//   GET  /health
//
// Sem dependências: usa só os módulos nativos do Node (http, net, dns).
// ============================================================

const http = require("http");
const net = require("net");
const dns = require("dns").promises;

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.WORKER_TOKEN || "";
// hostname anunciado no EHLO/HELO — DEVE bater com o rDNS/PTR do IP do VPS
const HELO_HOST = process.env.WORKER_HELO_HOST || "mail.example.com";
// remetente do envelope no MAIL FROM (uma caixa que exista no HELO_HOST)
const MAIL_FROM = process.env.WORKER_MAIL_FROM || `verify@${HELO_HOST}`;
const SMTP_TIMEOUT = Number(process.env.WORKER_SMTP_TIMEOUT_MS || 12000);

// provedores que NÃO permitem verificar por RCPT (aceitam tudo ou bloqueiam probe)
const BLOCKED_MX = [/google/i, /googlemail/i, /aspmx/i, /outlook/i, /microsoft/i, /protection\.outlook/i, /office365/i];

function normDomain(raw) {
  let s = String(raw || "").trim().toLowerCase();
  if (s.includes("@")) s = s.split("@").pop();
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split("/")[0].split("?")[0].replace(/:\d+$/, "");
  return /^[a-z0-9.-]+\.[a-z0-9.-]+$/.test(s) ? s : null;
}

function stripAccents(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// padrões de e-mail do decisor (BR) a partir de nome + domínio
function candidatesFor(nome, domain) {
  const parts = stripAccents(nome).toLowerCase().trim().split(/\s+/).filter(Boolean);
  const d = domain.replace(/^@/, "");
  if (!parts.length) return [];
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const set = new Set();
  if (first) set.add(`${first}@${d}`);
  if (first && last) {
    set.add(`${first}.${last}@${d}`);
    set.add(`${first}${last}@${d}`);
    set.add(`${first[0]}${last}@${d}`);
    set.add(`${first}.${last[0]}@${d}`);
    set.add(`${last}@${d}`);
    set.add(`${last}.${first}@${d}`);
  }
  return Array.from(set);
}

async function mxHosts(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (Array.isArray(mx) && mx.length) return mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
  } catch { /* sem MX */ }
  // fallback: alguns domínios recebem por A
  try {
    const a = await dns.resolve(domain);
    if (Array.isArray(a) && a.length) return [domain];
  } catch { /* nada */ }
  return [];
}

// Abre UMA sessão SMTP e testa vários RCPT. Distingue:
//   exists (250) · not_exists (550/551/553) · greylist/temp (4xx) · blocked (conversa recusada)
function smtpProbe(mxHost, from, rcpts) {
  return new Promise((resolve) => {
    const results = {}; // email -> { status, code, reason }
    let stage = 0; // 0 greet,1 ehlo,2 mailfrom, >=3 rcpt index
    let idx = 0;
    let buf = "";
    let settled = false;
    const socket = net.createConnection({ host: mxHost, port: 25 });
    socket.setTimeout(SMTP_TIMEOUT);

    const finish = (extra) => {
      if (settled) return;
      settled = true;
      try { socket.write("QUIT\r\n"); } catch {}
      try { socket.end(); } catch {}
      resolve({ results, ...(extra || {}) });
    };

    const send = (line) => { try { socket.write(line + "\r\n"); } catch {} };

    socket.on("connect", () => {});
    socket.on("timeout", () => finish({ transportError: "timeout" }));
    socket.on("error", (e) => finish({ transportError: e.code || e.message || "erro" }));

    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      // processa cada resposta completa (linha final "NNN " sem hífen)
      let m;
      while ((m = buf.match(/^(\d{3})([ -])(.*)\r?\n/))) {
        const code = Number(m[1]);
        const cont = m[2] === "-";
        buf = buf.slice(m[0].length);
        if (cont) continue; // resposta multiline: espera a linha final
        handleReply(code, m[3]);
      }
    });

    function handleReply(code, text) {
      if (stage === 0) {
        if (code !== 220) return finish({ transportError: `greet ${code}` });
        stage = 1;
        send(`EHLO ${HELO_HOST}`);
      } else if (stage === 1) {
        // alguns servidores respondem HELO com 250 multiline (já consumido acima)
        if (code !== 250) { stage = 1.5; return send(`HELO ${HELO_HOST}`); }
        stage = 2;
        send(`MAIL FROM:<${from}>`);
      } else if (stage === 1.5) {
        if (code !== 250) return finish({ transportError: `helo ${code}` });
        stage = 2;
        send(`MAIL FROM:<${from}>`);
      } else if (stage === 2) {
        if (code !== 250) return finish({ transportError: `mailfrom ${code}` });
        stage = 3;
        send(`RCPT TO:<${rcpts[0]}>`);
      } else {
        // resposta de um RCPT
        const email = rcpts[idx];
        let status = "unknown";
        if (code === 250 || code === 251) status = "exists";
        else if (code === 550 || code === 551 || code === 553 || code === 554) status = "not_exists";
        else if (code >= 400 && code < 500) status = "greylist"; // temporário
        else status = "unknown";
        results[email] = { status, code, reason: text.slice(0, 120) };
        idx++;
        if (idx < rcpts.length) send(`RCPT TO:<${rcpts[idx]}>`);
        else finish({});
      }
    }
  });
}

function randomLocal() {
  return "zz" + Math.random().toString(36).slice(2, 12) + "nn";
}

async function discover(nome, dominioRaw) {
  const domain = normDomain(dominioRaw);
  if (!domain) return { email: null, status: "invalid", tentativas: [] };

  const hosts = await mxHosts(domain);
  if (!hosts.length) return { email: null, status: "invalid", tentativas: [] };
  const mx = hosts[0];

  if (BLOCKED_MX.some((re) => re.test(mx))) {
    return { email: null, status: "blocked", tentativas: [] };
  }

  const cands = candidatesFor(nome, domain);
  if (!cands.length) return { email: null, status: "not_found", tentativas: [] };

  // catch-all: testa um endereço aleatório ANTES dos candidatos
  const catchAllAddr = `${randomLocal()}@${domain}`;
  const probe = await smtpProbe(mx, MAIL_FROM, [catchAllAddr, ...cands]);

  if (probe.transportError) {
    // a conversa foi recusada/expirou — NÃO é "não existe"; é incerto/bloqueado
    return { email: null, status: "blocked", reason: probe.transportError, tentativas: [] };
  }

  const catchAll = probe.results[catchAllAddr]?.status === "exists";
  const tentativas = cands.map((e) => ({ email: e, status: probe.results[e]?.status || "unknown", reason: probe.results[e]?.reason || "" }));

  if (catchAll) {
    // servidor aceita qualquer coisa → não dá para confiar
    return { email: null, status: "uncertain", tentativas };
  }

  const hit = cands.find((e) => probe.results[e]?.status === "exists");
  if (hit) return { email: hit, status: "valid", tentativas };

  // só teve temporários (greylist)? então é incerto, não "não existe"
  const anyGrey = cands.some((e) => probe.results[e]?.status === "greylist");
  const anyDefinite = cands.some((e) => probe.results[e]?.status === "not_exists");
  if (anyGrey && !anyDefinite) return { email: null, status: "uncertain", tentativas };

  return { email: null, status: "not_found", tentativas };
}

async function verifyOne(email) {
  const m = String(email || "").toLowerCase().match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/);
  if (!m) return { status: "invalid", reason: "sintaxe" };
  const domain = m[1];
  const hosts = await mxHosts(domain);
  if (!hosts.length) return { status: "invalid", reason: "sem MX" };
  const mx = hosts[0];
  if (BLOCKED_MX.some((re) => re.test(mx))) return { status: "blocked", reason: "provedor não verificável" };

  const catchAllAddr = `${randomLocal()}@${domain}`;
  const probe = await smtpProbe(mx, MAIL_FROM, [catchAllAddr, email]);
  if (probe.transportError) return { status: "blocked", reason: probe.transportError };
  if (probe.results[catchAllAddr]?.status === "exists") return { status: "uncertain", reason: "catch-all" };
  const r = probe.results[email]?.status;
  if (r === "exists") return { status: "valid" };
  if (r === "greylist") return { status: "uncertain", reason: "greylist" };
  if (r === "not_exists") return { status: "invalid", reason: "caixa não existe" };
  return { status: "uncertain", reason: "sem resposta clara" };
}

// -------------------- HTTP --------------------
function readJson(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  if (req.method === "GET" && req.url === "/health") return json(200, { ok: true });

  const auth = req.headers["authorization"] || "";
  if (!TOKEN || auth !== `Bearer ${TOKEN}`) return json(401, { error: "unauthorized" });

  if (req.method === "POST" && req.url === "/discover") {
    const body = await readJson(req);
    if (!body.nome || !body.dominio) return json(400, { error: "nome e dominio obrigatórios" });
    try { return json(200, await discover(String(body.nome), String(body.dominio))); }
    catch (e) { return json(200, { email: null, status: "error", reason: String(e && e.message || e), tentativas: [] }); }
  }

  if (req.method === "POST" && req.url === "/verify") {
    const body = await readJson(req);
    if (!body.email) return json(400, { error: "email obrigatório" });
    try { return json(200, await verifyOne(String(body.email))); }
    catch (e) { return json(200, { status: "error", reason: String(e && e.message || e) }); }
  }

  json(404, { error: "not found" });
});

server.listen(PORT, () => console.log(`[contatia-worker] ouvindo na porta ${PORT} · HELO=${HELO_HOST}`));
