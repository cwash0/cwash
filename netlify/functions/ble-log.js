const { createDiagnosticWriter, validateAttempt } = require("../../scripts/ble-log");

let writer;
const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(body)
});

function createHandler(getWriter = () => {
  writer ||= createDiagnosticWriter(process.env.DB_LINK);
  return writer;
}) {
  return async (event) => {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
    const headers = event.headers || {};
    const host = headers.host || headers.Host;
    const origin = headers.origin || headers.Origin;
    if (!host || ![ `https://${host}`, `http://${host}` ].includes(origin)) return json(403, { error: "Forbidden origin" });
    if (!/^application\/json(?:;|$)/i.test(headers["content-type"] || headers["Content-Type"] || "")) return json(415, { error: "JSON required" });
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
    if (Buffer.byteLength(raw) > 32768) return json(413, { error: "Diagnostic too large" });
    let attempt;
    try { attempt = JSON.parse(raw); } catch { return json(400, { error: "Invalid JSON" }); }
    if (!validateAttempt(attempt)) return json(400, { error: "Invalid diagnostic" });
    const write = getWriter();
    if (!write) return json(503, { error: "DB_LINK is not configured" });
    try {
      await write(attempt);
      return json(201, { saved: true, id: attempt.id });
    } catch {
      return json(503, { error: "Database write failed" });
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
