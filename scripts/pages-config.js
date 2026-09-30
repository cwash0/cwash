const fs = require("node:fs");
const path = require("node:path");

function normalizeBasePath(value = "") {
  const raw = String(value).trim();
  if (!raw || raw === "/") return "/";
  const normalized = `/${raw.replace(/^\/+|\/+$/g, "")}/`;
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)+$/.test(normalized) || normalized.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("PAGES_BASE_PATH must be a repository path such as /LaundrySite/.");
  }
  return normalized;
}

function renderNotFound(html, basePath = "") {
  const base = normalizeBasePath(basePath);
  if (!/<base href="[^"]*">/.test(html)) throw new Error("404.html is missing its base URL.");
  return html.replace(/<base href="[^"]*">/, `<base href="${base}">`);
}

function configurePages(directory, basePath = "") {
  const notFound = path.join(directory, "404.html");
  const html = renderNotFound(fs.readFileSync(notFound, "utf8"), basePath);
  fs.writeFileSync(notFound, html);
  fs.writeFileSync(path.join(directory, ".nojekyll"), "");
}

if (require.main === module) {
  configurePages(path.resolve(process.argv[2] || "production/public"), process.env.PAGES_BASE_PATH || "");
}
module.exports = { configurePages, normalizeBasePath, renderNotFound };
