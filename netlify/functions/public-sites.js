const { searchPublicSites } = require("./_site-data");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    let body;
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (_) {
      return json({ ok: false, error: "bad_request" }, 400);
    }

    const query = String(body.query || "").trim();
    const mode = body.mode === "address" || body.mode === "name" ? body.mode : "all";

    if (query.length < 2 || query.length > 100) {
      return json({ ok: false, error: "invalid_query" }, 400);
    }

    return json({ ok: true, sites: searchPublicSites(query, mode) });
  } catch (error) {
    console.error("[public-sites] fatal:", error?.stack || error);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

function json(value, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(value)
  };
}
