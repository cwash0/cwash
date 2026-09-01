const fs = require("fs");
const path = require("path");

const SITE_GEOGRAPHY_PATH = path.join(__dirname, "..", "data", "site-geography.json");
let cachedSiteGeography = null;
let cachedSiteGeographyMtime = -1;

const UK_BOUNDS = { west: -8.8, east: 2.1, south: 49.75, north: 60.95 };
const UK_COUNTRIES = new Set(["England", "Scotland", "Wales", "Northern Ireland"]);
const POSTCODE_PATTERN = /^(?:GIR0AA|[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/;
const NON_PRODUCTION_MARKER = /(?:^|[\s_-])(test(?:ing)?|demo|sandbox|seed(?:ed)?|sample|placeholder|development|staging)(?:$|[\s_-])/i;
const PLACEHOLDER_LOCATION = /^(unknown|n\/a|none|null|test|testing|demo|sample|placeholder|location|city|town)$/i;

function validateAnalyticsSite(site, geographyData = loadSiteGeography()) {
  const id = String(site?.id || "").trim();
  const name = String(site?.name || "").trim();
  const address = String(site?.address || "").trim();
  const geography = geographyData[id];

  if (!id || !name) return invalid("missing_site_identity");
  if (NON_PRODUCTION_MARKER.test(id) || NON_PRODUCTION_MARKER.test(name)) return invalid("non_production_site");
  if (!geography) return invalid("unresolved_location");
  if (geography.coordinateSource !== "full_postcode") return invalid("inexact_location");

  const city = String(geography.city || "").trim();
  const postcode = String(geography.postcode || "").toUpperCase().replace(/\s+/g, "");
  const latitude = Number(geography.latitude);
  const longitude = Number(geography.longitude);
  const country = String(geography.country || "").trim();

  if (!city || city.length > 80 || PLACEHOLDER_LOCATION.test(city) || NON_PRODUCTION_MARKER.test(city)) return invalid("invalid_city");
  if (!POSTCODE_PATTERN.test(postcode) || !address) return invalid("invalid_postcode");
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return invalid("invalid_coordinates");
  if (longitude < UK_BOUNDS.west || longitude > UK_BOUNDS.east || latitude < UK_BOUNDS.south || latitude > UK_BOUNDS.north) return invalid("outside_uk");
  if (!UK_COUNTRIES.has(country)) return invalid("outside_uk");

  return { valid: true, reason: "", geography };
}

function getValidatedAnalyticsSites(sites) {
  const valid = new Map();
  const invalidSites = [];
  const geographyData = loadSiteGeography();
  (sites || []).forEach((site) => {
    const result = validateAnalyticsSite(site, geographyData);
    if (result.valid) valid.set(site.id, { ...site, ...result.geography });
    else invalidSites.push({ siteId: site.id, reason: result.reason });
  });
  return { valid, invalidSites };
}

function loadSiteGeography() {
  const modifiedAt = fs.statSync(SITE_GEOGRAPHY_PATH).mtimeMs;
  if (!cachedSiteGeography || modifiedAt !== cachedSiteGeographyMtime) {
    cachedSiteGeography = JSON.parse(fs.readFileSync(SITE_GEOGRAPHY_PATH, "utf8"));
    cachedSiteGeographyMtime = modifiedAt;
  }
  return cachedSiteGeography;
}

function normalizeAnalyticsEnvironment(value) {
  const environment = String(value || "production").trim().toLowerCase();
  if (["production", "prod"].includes(environment)) return "production";
  if (["deploy-preview", "preview", "branch-deploy"].includes(environment)) return "preview";
  if (["development", "dev", "local", "test"].includes(environment)) return "development";
  return environment || "production";
}

function invalid(reason) { return { valid: false, reason, geography: null }; }

module.exports = {
  getValidatedAnalyticsSites,
  normalizeAnalyticsEnvironment,
  validateAnalyticsSite
};
