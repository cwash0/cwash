const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createDiagnosticWriter, validateAttempt } = require("./ble-log");
const { parseBtsnoop, findSecureCaptures, ascii } = require("../boulevard-replay-core");

const publicRoot = path.resolve(__dirname, "..");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

function normalizeBasePath(value = "") {
  const raw = String(value).trim();
  if (!raw || raw === "/") return "/";
  const normalized = `/${raw.replace(/^\/+|\/+$/g, "")}/`;
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)+$/.test(normalized) || normalized.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("PAGES_BASE_PATH must be a repository path such as /cwash/.");
  }
  return normalized;
}

function renderNotFound(html, basePath = "") {
  return html.replace(/<base href="[^"]*">/, `<base href="${normalizeBasePath(basePath)}">`);
}

const boulevardLogs = {
  washer2: process.env.BOULEVARD_WASHER_LOG || path.join(os.homedir(), "Downloads", "bugreport-walleye-OPM1.171019.019-2026-10-17-02-47-27", "FS", "data", "misc", "bluetooth", "logs", "btsnoop_hci.log"),
  dryer1: process.env.BOULEVARD_DRYER_LOG || path.join(os.homedir(), "Downloads", "dryer", "FS", "data", "misc", "bluetooth", "logs", "btsnoop_hci.log")
};

async function boulevardCaptures() {
  const siteData = JSON.parse(await fs.readFile(path.join(publicRoot, "assets", "data", "sites-25.json"), "utf8"));
  const machines = siteData.the_boulevard_b_block;
  const result = [];
  for (const [id, logPath, cycleKey] of [
    ["washer2", boulevardLogs.washer2, "standardEco"],
    ["dryer1", boulevardLogs.dryer1, "min15"]
  ]) {
    const machine = machines.find((item) => item.id === id);
    if (!machine) throw new Error(`Boulevard ${id} is missing from the local site catalog.`);
    const events = parseBtsnoop(await fs.readFile(logPath));
    const capture = findSecureCaptures(events).find((item) => item.identifier === machine.bluetoothName);
    if (!capture || capture.packetSequence !== capture.currentSequence + 1 ||
        capture.chunks.length !== 5 || capture.writeOpcodes.some((opcode) => opcode !== 0x52) ||
        capture.preludeOpcodes.some((opcode) => opcode !== 0x52) ||
        capture.prelude.length !== 3 || ascii(capture.prelude[0]) !== "[VERSION]" ||
        ascii(capture.prelude[2]) !== "[GET:SEQ]") {
      throw new Error(`No matching, complete secure capture found for Boulevard ${id}.`);
    }
    result.push({ id, name: machine.name, bluetoothName: machine.bluetoothName,
      cycleKey, cycleLabel: machine.cycles.find((cycle) => cycle.key === cycleKey)?.label || cycleKey,
      capturedAt: new Date(capture.atMs).toISOString(), capturedSequence: capture.currentSequence,
      packetCounter: capture.packetSequence, prelude: capture.prelude.map((value) => Buffer.from(value).toString("hex")),
      preludeDelaysMs: capture.preludeDelaysMs,
      chunks: capture.chunks.map((value) => Buffer.from(value).toString("hex")),
      interChunkMs: capture.interChunkMs });
  }
  return result;
}

function createServer({ basePath = process.env.PAGES_BASE_PATH || "", logWriter = createDiagnosticWriter() } = {}) {
  const base = normalizeBasePath(basePath);
  return http.createServer(async (request, response) => {
    const send = (status, body, type = "text/plain; charset=utf-8") => {
      response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    try {
      const notFound = async () => send(404, renderNotFound(await fs.readFile(path.join(publicRoot, "404.html"), "utf8"), base), types[".html"]);
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === `${base}api/ble-log` || pathname === `${base}.netlify/functions/ble-log`) {
        if (request.method !== "POST") { send(405, "Method not allowed"); return; }
        if (!logWriter) { send(503, JSON.stringify({ error: "Database is not configured" }), "application/json; charset=utf-8"); return; }
        if (request.headers.origin !== `http://${request.headers.host}`) { send(403, "Forbidden origin"); return; }
        if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")) { send(415, "JSON required"); return; }
        try {
          let body = "";
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 32768) { send(413, "Diagnostic too large"); return; }
          }
          let attempt;
          try { attempt = JSON.parse(body); } catch { send(400, "Invalid JSON"); return; }
          if (!validateAttempt(attempt)) { send(400, "Invalid diagnostic"); return; }
          await logWriter(attempt);
          send(201, JSON.stringify({ saved: true, id: attempt.id }), "application/json; charset=utf-8");
        } catch {
          send(503, JSON.stringify({ error: "Database write failed" }), "application/json; charset=utf-8");
        }
        return;
      }
      if (!["GET", "HEAD"].includes(request.method)) { send(405, "Method not allowed"); return; }
      if (base !== "/" && pathname === base.slice(0, -1)) {
        response.writeHead(301, { Location: base + new URL(request.url, "http://localhost").search });
        response.end(); return;
      }
      if (!pathname.startsWith(base)) { await notFound(); return; }
      const relative = pathname.slice(base.length) || "index.html";
      const file = path.resolve(publicRoot, relative);
      const isPublic = ["index.html", "activate.html", "404.html", "boulevard-replay.html", "boulevard-replay.js", "boulevard-replay-core.js", "boulevard-captures.json"].includes(relative) || relative.startsWith("assets/");
      if (!isPublic || !file.startsWith(publicRoot + path.sep) || relative.split(/[\\/]/).some((part) => part.startsWith("."))) {
        await notFound(); return;
      }
      try { send(200, await fs.readFile(file), types[path.extname(file)]); }
      catch { await notFound(); }
    } catch { send(400, "Bad request"); }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(Number(process.env.PORT || 8888), "127.0.0.1", () => console.log(`GitHub Pages preview: http://127.0.0.1:${server.address().port}${normalizeBasePath(process.env.PAGES_BASE_PATH || "")}`));
}
module.exports = { createServer, normalizeBasePath, renderNotFound, boulevardCaptures };
