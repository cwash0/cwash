const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

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

function createServer({ basePath = process.env.PAGES_BASE_PATH || "" } = {}) {
  const base = normalizeBasePath(basePath);
  return http.createServer(async (request, response) => {
    const send = (status, body, type = "text/plain; charset=utf-8") => {
      response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    if (!["GET", "HEAD"].includes(request.method)) { send(405, "Method not allowed"); return; }
    try {
      const notFound = async () => send(404, renderNotFound(await fs.readFile(path.join(publicRoot, "404.html"), "utf8"), base), types[".html"]);
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (base !== "/" && pathname === base.slice(0, -1)) {
        response.writeHead(301, { Location: base + new URL(request.url, "http://localhost").search });
        response.end(); return;
      }
      if (!pathname.startsWith(base)) { await notFound(); return; }
      const relative = pathname.slice(base.length) || "index.html";
      const file = path.resolve(publicRoot, relative);
      const isPublic = ["index.html", "activate.html", "404.html"].includes(relative) || relative.startsWith("assets/");
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
module.exports = { createServer, normalizeBasePath, renderNotFound };
