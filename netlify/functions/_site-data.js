const fs = require("fs");
const path = require("path");

let cachedSiteMap = null;
let cachedPublicSites = null;
let cachedSiteGeography = null;

function readFirstJson(candidatePaths, expectedType, label) {
  let raw = null;
  let usedPath = null;

  for (const candidate of candidatePaths) {
    try {
      raw = fs.readFileSync(candidate, "utf8");
      usedPath = candidate;
      break;
    } catch (_) {
      // Try the next deployment/runtime path.
    }
  }

  if (!raw) {
    throw new Error(`${label} not found. Tried: ${candidatePaths.join(" | ")}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${usedPath}: ${error.message}`);
  }

  const valid = expectedType === "array"
    ? Array.isArray(parsed)
    : parsed && typeof parsed === "object" && !Array.isArray(parsed);

  if (!valid) {
    throw new Error(`${label} must contain a JSON ${expectedType}`);
  }

  return parsed;
}

function loadSiteMap() {
  if (cachedSiteMap) return cachedSiteMap;

  cachedSiteMap = readFirstJson(
    [
      path.join(process.cwd(), "netlify", "data", "access-config.json"),
      path.join(process.cwd(), "access-config.json"),
      path.join(__dirname, "..", "data", "access-config.json"),
      path.join(__dirname, "..", "..", "access-config.json"),
      "/var/task/netlify/data/access-config.json",
      "/var/task/access-config.json"
    ],
    "object",
    "access-config.json"
  );

  return cachedSiteMap;
}

function loadAddresses() {
  return readFirstJson(
    [
      path.join(process.cwd(), "addresses.json"),
      path.join(process.cwd(), "netlify", "data", "addresses.json"),
      path.join(__dirname, "..", "data", "addresses.json"),
      path.join(__dirname, "..", "..", "addresses.json"),
      "/var/task/addresses.json",
      "/var/task/netlify/data/addresses.json"
    ],
    "array",
    "addresses.json"
  );
}

function loadSiteGeography() {
  if (cachedSiteGeography) return cachedSiteGeography;
  cachedSiteGeography = readFirstJson(
    [
      path.join(process.cwd(), "netlify", "data", "site-geography.json"),
      path.join(__dirname, "..", "data", "site-geography.json"),
      "/var/task/netlify/data/site-geography.json"
    ],
    "object",
    "site-geography.json"
  );
  return cachedSiteGeography;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatAddress(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u060C\uFE50\uFF0C]/g, ",")
    .split(",")
    .map((part) => part.replace(/^[\s,]+|[\s,]+$/g, "").replace(/\s+/g, " "))
    .filter(Boolean)
    .join(", ");
}

function getPublicSites() {
  if (cachedPublicSites) return cachedPublicSites;

  const siteMap = loadSiteMap();
  const addresses = loadAddresses();
  const configByNormalizedName = new Map();

  for (const [id, entry] of Object.entries(siteMap)) {
    const name = String(entry?.siteName || id).trim();
    const normalized = normalizeName(name);
    if (!normalized) continue;

    const matches = configByNormalizedName.get(normalized) || [];
    matches.push({ id, name });
    configByNormalizedName.set(normalized, matches);
  }

  const addressByConfigId = new Map();

  for (const entry of addresses) {
    const addressName = String(entry?.site_name || "").trim();
    const address = formatAddress(entry?.address);
    if (!addressName || !address) continue;

    const matches = configByNormalizedName.get(normalizeName(addressName)) || [];

    // Only use unambiguous name matches. The opaque addresses.json site_id is
    // reference data and is not the access-config key stored in access_codes.
    if (matches.length !== 1) continue;

    const configSite = matches[0];
    if (!addressByConfigId.has(configSite.id)) {
      addressByConfigId.set(configSite.id, address);
    }
  }

  cachedPublicSites = Object.entries(siteMap)
    .map(([id, entry]) => ({
      id,
      name: String(entry?.siteName || id).trim(),
      address: addressByConfigId.get(id) || ""
    }))
    .filter((site) => site.id && site.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  return cachedPublicSites;
}

function getSiteById(siteId) {
  const id = String(siteId || "").trim();
  return getPublicSites().find((site) => site.id === id) || null;
}

function getSiteGeography(siteId) {
  const id = String(siteId || "").trim();
  const entry = loadSiteGeography()[id];
  if (!entry || typeof entry !== "object") return null;
  return {
    city: String(entry.city || "").trim(),
    postcode: String(entry.postcode || "").trim(),
    region: String(entry.region || "").trim(),
    country: String(entry.country || "").trim()
  };
}

function normalizeCity(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchPublicSites(query, mode = "all", limit = 15) {
  const term = normalizeName(query);
  const compactTerm = term.replace(/\s/g, "");
  if (term.length < 2) return [];

  const fieldScore = (value, baseScore, fuzzyScore) => {
    const source = normalizeName(value);
    if (!source) return Infinity;
    const sourceCompact = source.replace(/\s/g, "");
    const words = source.split(" ");

    if (source === term) return baseScore;
    if (source.startsWith(term)) return baseScore + 2;
    if (words.some((word) => word.startsWith(term))) return baseScore + 4;
    if (source.includes(term)) return baseScore + 6;
    if (compactTerm.length >= 2 && sourceCompact.includes(compactTerm)) return baseScore + 8;

    if (compactTerm.length >= 3) {
      const candidates = [sourceCompact, ...words];
      const distance = Math.min(...candidates.map((candidate) => levenshtein(compactTerm, candidate)));
      const tolerance = Math.max(1, Math.floor(compactTerm.length * 0.25));
      if (distance <= tolerance) return fuzzyScore + distance;
    }

    return Infinity;
  };

  return getPublicSites()
    .map((site) => {
      const nameScore = fieldScore(site.name, 0, 50);
      const addressScore = fieldScore(site.address, 30, 70);
      const score = mode === "name"
        ? nameScore
        : mode === "address"
          ? addressScore
          : Math.min(nameScore, addressScore);
      return { site, score };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.site.name.localeCompare(b.site.name))
    .slice(0, limit)
    .map(({ site }) => ({
      id: site.id,
      name: site.name,
      address: site.address
    }));
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current[rightIndex + 1] = Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

module.exports = {
  getPublicSites,
  getSiteById,
  getSiteGeography,
  normalizeCity,
  searchPublicSites
};
