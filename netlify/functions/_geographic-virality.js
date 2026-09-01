const DEFAULT_ATTRIBUTION_DAYS = 30;
const DEFAULT_MIN_CITY_SAMPLE = 5;

function calculateGeographicVirality({
  eligibleSources = [],
  propagations = [],
  cityBySite = {},
  periodStart = null,
  periodEnd = null,
  attributionDays = DEFAULT_ATTRIBUTION_DAYS,
  minCitySample = DEFAULT_MIN_CITY_SAMPLE
} = {}) {
  const startMs = dateMs(periodStart, -Infinity);
  const endMs = dateMs(periodEnd, Infinity);
  const sourceSites = new Map();

  for (const source of eligibleSources) {
    const siteId = cleanId(source?.siteId);
    const activatedAt = dateMs(source?.activatedAt, NaN);
    if (!siteId || !Number.isFinite(activatedAt) || activatedAt < startMs || activatedAt > endMs) continue;
    const previous = sourceSites.get(siteId);
    if (!previous || activatedAt < previous.activatedAt) sourceSites.set(siteId, { siteId, activatedAt });
  }

  const cityStats = new Map();
  let knownLocationSources = 0;
  for (const source of sourceSites.values()) {
    const city = resolvedCity(cityBySite, source.siteId);
    if (!city.normalized) continue;
    knownLocationSources += 1;
    const stat = cityStats.get(city.normalized) || createCityStat(city.label);
    stat.sourceSites.add(source.siteId);
    cityStats.set(city.normalized, stat);
  }

  const uniquePairs = new Set();
  const routeTargets = new Map();
  let unknownLocationPairs = 0;
  let sameSitePairsExcluded = 0;
  let outsideWindowExcluded = 0;

  for (const propagation of propagations) {
    const sourceSiteId = cleanId(propagation?.sourceSiteId);
    const targetSiteId = cleanId(propagation?.targetSiteId);
    const source = sourceSites.get(sourceSiteId);
    const convertedAt = dateMs(propagation?.convertedAt, NaN);
    if (!source || !targetSiteId || !Number.isFinite(convertedAt)) continue;
    if (convertedAt < startMs || convertedAt > endMs) continue;
    if (convertedAt < source.activatedAt || convertedAt > source.activatedAt + attributionDays * 86400000) {
      outsideWindowExcluded += 1;
      continue;
    }
    if (sourceSiteId === targetSiteId) {
      sameSitePairsExcluded += 1;
      continue;
    }

    const pairKey = `${sourceSiteId}\u0000${targetSiteId}`;
    if (uniquePairs.has(pairKey)) continue;
    uniquePairs.add(pairKey);

    const sourceCity = resolvedCity(cityBySite, sourceSiteId);
    const targetCity = resolvedCity(cityBySite, targetSiteId);
    if (!sourceCity.normalized || !targetCity.normalized) {
      unknownLocationPairs += 1;
      continue;
    }

    const stat = cityStats.get(sourceCity.normalized) || createCityStat(sourceCity.label);
    if (sourceCity.normalized === targetCity.normalized) {
      stat.sameCityPairs.add(pairKey);
    } else {
      stat.crossCityPairs.add(pairKey);
      stat.otherCities.add(targetCity.normalized);
      const routeKey = `${sourceCity.normalized}\u0000${targetCity.normalized}`;
      const route = routeTargets.get(routeKey) || {
        sourceCity: sourceCity.label,
        targetCity: targetCity.label,
        targetSites: new Set()
      };
      route.targetSites.add(targetSiteId);
      routeTargets.set(routeKey, route);
    }
    cityStats.set(sourceCity.normalized, stat);
  }

  const cities = [...cityStats.values()]
    .map((stat) => ({
      city: stat.city,
      activeAccommodations: stat.sourceSites.size,
      sameCityAccommodationsReached: stat.sameCityPairs.size,
      withinCityK: coefficient(stat.sameCityPairs.size, stat.sourceSites.size),
      otherCitiesReached: stat.otherCities.size,
      crossCityAcquisitions: stat.crossCityPairs.size,
      crossCityK: coefficient(stat.crossCityPairs.size, stat.sourceSites.size)
    }))
    .sort((left, right) => right.activeAccommodations - left.activeAccommodations || left.city.localeCompare(right.city));

  const qualifyingCities = cities.filter((city) => city.activeAccommodations >= minCitySample);
  const withinCityVirality = qualifyingCities.length
    ? average(qualifyingCities.map((city) => city.withinCityK))
    : 0;
  const withinPairs = cities.reduce((sum, city) => sum + city.sameCityAccommodationsReached, 0);
  const crossPairs = cities.reduce((sum, city) => sum + city.crossCityAcquisitions, 0);
  const topRoutes = [...routeTargets.values()]
    .map((route) => ({
      sourceCity: route.sourceCity,
      targetCity: route.targetCity,
      accommodations: route.targetSites.size
    }))
    .sort((left, right) => right.accommodations - left.accommodations || `${left.sourceCity}${left.targetCity}`.localeCompare(`${right.sourceCity}${right.targetCity}`))
    .slice(0, 10);

  return {
    attributionDays,
    minCitySample,
    eligibleSourceAccommodations: sourceSites.size,
    knownLocationSources,
    locationCoverage: coefficient(knownLocationSources, sourceSites.size),
    qualifyingCityCount: qualifyingCities.length,
    withinCityVirality: roundCoefficient(withinCityVirality),
    withinCityOverall: coefficient(withinPairs, knownLocationSources),
    crossCityVirality: coefficient(crossPairs, knownLocationSources),
    withinCityPairs: withinPairs,
    crossCityPairs: crossPairs,
    sameSitePairsExcluded,
    unknownLocationPairs,
    outsideWindowExcluded,
    cities,
    topRoutes
  };
}

function calculateGeographicViralityTrend(options = {}, bucketCount = 8) {
  const start = new Date(options.periodStart);
  const end = new Date(options.periodEnd);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return [];
  const buckets = Math.max(1, Math.min(12, Number(bucketCount) || 8));
  const width = (end.getTime() - start.getTime()) / buckets;
  const trend = [];

  for (let index = 0; index < buckets; index += 1) {
    const bucketStart = new Date(start.getTime() + width * index);
    const bucketEnd = new Date(index === buckets - 1 ? end.getTime() : start.getTime() + width * (index + 1) - 1);
    const result = calculateGeographicVirality({ ...options, periodStart: bucketStart, periodEnd: bucketEnd });
    trend.push({
      start: bucketStart.toISOString(),
      end: bucketEnd.toISOString(),
      withinCityVirality: result.withinCityVirality,
      crossCityVirality: result.crossCityVirality,
      eligibleSourceAccommodations: result.eligibleSourceAccommodations
    });
  }
  return trend;
}

function createCityStat(city) {
  return {
    city,
    sourceSites: new Set(),
    sameCityPairs: new Set(),
    crossCityPairs: new Set(),
    otherCities: new Set()
  };
}

function resolvedCity(cityBySite, siteId) {
  const raw = typeof cityBySite === "function" ? cityBySite(siteId) : cityBySite?.[siteId];
  const value = typeof raw === "string" ? raw : raw?.city;
  const label = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  return {
    label,
    normalized: label.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  };
}

function cleanId(value) {
  return String(value || "").trim();
}

function dateMs(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : fallback;
}

function coefficient(numerator, denominator) {
  return denominator > 0 ? roundCoefficient(numerator / denominator) : 0;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function roundCoefficient(value) {
  return Number((Number(value) || 0).toFixed(4));
}

module.exports = {
  DEFAULT_ATTRIBUTION_DAYS,
  DEFAULT_MIN_CITY_SAMPLE,
  calculateGeographicVirality,
  calculateGeographicViralityTrend
};
