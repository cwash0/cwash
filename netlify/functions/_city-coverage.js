const DAY_MS = 24 * 60 * 60 * 1000;
const RAMP_DAYS = [0, 7, 14, 30, 60, 90];

const DEFAULT_CITY_RULES = Object.freeze({
  activationUsers: 3,
  establishedUsers: 5,
  establishedActiveWeeks: 3,
  dormantDays: 30,
  takeoffDays: 30
});

function calculateOrganicSpread({
  events = [],
  users = [],
  cityBySite = {},
  siteById = {},
  periodStart = null,
  periodEnd = null,
  rules = {}
} = {}) {
  const endMs = dateMs(periodEnd, Date.now());
  const startMs = dateMs(periodStart, endMs - 30 * DAY_MS);
  const safeStartMs = Math.min(startMs, endMs - 1);
  const durationMs = Math.max(DAY_MS, endMs - safeStartMs);
  const previousStartMs = safeStartMs - durationMs;
  const cityRules = resolveCityRules(rules);
  const sourceEvents = events.length ? events : users.map((user) => ({
    userId: user?.userId,
    siteId: user?.siteId,
    occurredAt: user?.joinedAt
  }));
  const normalizedEvents = normalizeEvents(sourceEvents, endMs);
  const joinedUsers = firstJoinEvents(normalizedEvents);
  const cityStats = buildCityStats(normalizedEvents, joinedUsers, cityBySite, siteById);
  const cities = [...cityStats.values()]
    .map((stat) => buildCityDetail(stat, safeStartMs, endMs, cityRules))
    .sort(citySort);
  const cityByKey = new Map(cities.map((city) => [city.key, city]));

  const current = calculateWindowMetrics(cityStats, safeStartMs, endMs, cityRules);
  const previous = calculateWindowMetrics(cityStats, previousStartMs, safeStartMs, cityRules);
  current.activeUsers = uniqueEventUsers(normalizedEvents, safeStartMs, endMs);
  current.newJoinedUsers = joinedInWindow(joinedUsers, safeStartMs, endMs);
  previous.activeUsers = uniqueEventUsers(normalizedEvents, previousStartMs, safeStartMs);
  previous.newJoinedUsers = joinedInWindow(joinedUsers, previousStartMs, safeStartMs);
  const representedBefore = cities.filter((city) => city.firstJoinedMs < safeStartMs);
  const newCities = cities.filter((city) => city.firstJoinedMs >= safeStartMs && city.firstJoinedMs <= endMs);
  const knownLocationUsers = [...joinedUsers.values()].filter((event) => resolvedCity(cityBySite, event.siteId).normalized).length;
  const totalJoinedUsers = joinedUsers.size;
  const lifecycle = countLifecycle(cities);
  const funnel = calculateLifecycleFunnel(cities, cityRules);
  const depthDistribution = calculateDepthDistribution(cities);
  const activityConcentration = calculateConcentration(cityStats, joinedUsers, safeStartMs, endMs);
  const seedFrequency = calculateSeedFrequency(cities, safeStartMs, endMs, previousStartMs);
  const networkBenchmarks = calculateNetworkBenchmarks(cities);
  const cityCountBefore = representedBefore.length;
  const cityCountAfter = cities.length;
  const newCitiesAdded = newCities.length;
  const existingCityGrowth = current.existingCityJoinedUsers;
  const seedUsers = current.newCitySeedUsers;
  const activePreviouslyRepresentedUsers = current.activePreviouslyRepresentedUsers;

  return {
    definition: "A user's join city is determined by their first valid production site selection. City metrics measure observed diffusion, not referral or causal attribution.",
    period: {
      start: new Date(safeStartMs).toISOString(),
      end: new Date(endMs).toISOString(),
      days: Math.max(1, Math.round(durationMs / DAY_MS))
    },
    rules: cityRules,
    cityCountBefore,
    cityCountAfter,
    newCitiesAdded,
    coverageGrowthPercent: cityCountBefore > 0 ? roundPercent((newCitiesAdded / cityCountBefore) * 100) : null,
    totalJoinedUsers,
    usersBefore: [...joinedUsers.values()].filter((event) => event.occurredAt < safeStartMs).length,
    usersJoinedDuringPeriod: current.newJoinedUsers,
    knownLocationUsers,
    locationCoverage: totalJoinedUsers > 0 ? roundRatio(knownLocationUsers / totalJoinedUsers) : 0,
    overview: {
      activeUsers: current.activeUsers,
      newJoinedUsers: current.newJoinedUsers,
      representedCities: cityCountAfter,
      newCitiesSeeded: newCitiesAdded,
      activatedNewCities: current.activatedNewCities,
      matureCitySeeds: current.matureCitySeeds,
      pendingCitySeeds: current.pendingCitySeeds,
      cityActivationRate: current.cityActivationRate,
      activeCities: current.activeCities,
      activeCityGrowthPercent: percentChange(current.activeCities, previous.activeCities)
    },
    comparison: {
      activeUsers: compareValue(current.activeUsers, previous.activeUsers),
      newJoinedUsers: compareValue(current.newJoinedUsers, previous.newJoinedUsers),
      newCitiesSeeded: compareValue(current.newCitiesSeeded, previous.newCitiesSeeded),
      activatedNewCities: compareValue(current.activatedNewCities, previous.activatedNewCities),
      cityActivationRate: comparePoints(current.cityActivationRate, previous.cityActivationRate),
      activeCities: compareValue(current.activeCities, previous.activeCities),
      medianTimeToSecondDays: compareDays(current.medianTimeToSecondDays, previous.medianTimeToSecondDays),
      spreadRate: compareValue(current.observedSpreadRate, previous.observedSpreadRate),
      boundaryCrossingRatio: comparePoints(current.boundaryCrossingRatio, previous.boundaryCrossingRatio),
      seedIntervalDays: compareDays(seedFrequency.currentMedianDays, seedFrequency.previousMedianDays)
    },
    lifecycle,
    spreadQuality: lifecycle,
    spread: {
      citiesBefore: cityCountBefore,
      citiesSeeded: newCitiesAdded,
      seedActivationRate: current.cityActivationRate,
      activeCityGrowthPercent: percentChange(current.activeCities, previous.activeCities),
      observedSpreadRate: activePreviouslyRepresentedUsers > 0
        ? roundPercent((newCitiesAdded / activePreviouslyRepresentedUsers) * 100)
        : null,
      observedSpreadRateDenominator: activePreviouslyRepresentedUsers,
      boundaryCrossingRatio: current.newJoinedUsers > 0
        ? roundPercent((seedUsers / current.newJoinedUsers) * 100)
        : null,
      intraClusterExpansionRate: activePreviouslyRepresentedUsers > 0
        ? roundPercent((existingCityGrowth / activePreviouslyRepresentedUsers) * 100)
        : null,
      medianTimeToSecondDays: median(newCities.map((city) => city.timeToSecondDays).filter(Number.isFinite)),
      medianTimeToActivationDays: median(newCities.map((city) => city.timeToActivationDays).filter(Number.isFinite)),
      cityTakeoffRate: current.cityActivationRate,
      seedFrequency,
      concentration: activityConcentration
    },
    breadthDepth: {
      representedCities: cityCountAfter,
      activeCities: current.activeCities,
      medianUsersPerCity: median(cities.map((city) => city.usersNow)) || 0,
      medianSitesPerCity: median(cities.map((city) => city.sitesRepresented)) || 0,
      newCityGrowth: seedUsers,
      existingCityUserGrowth: existingCityGrowth,
      newCityShareOfGrowth: current.newJoinedUsers > 0 ? roundPercent((seedUsers / current.newJoinedUsers) * 100) : null
    },
    spreadBalance: {
      totalNewUsers: current.newJoinedUsers,
      existingCityUsers: existingCityGrowth,
      existingCityShare: current.newJoinedUsers > 0 ? roundPercent((existingCityGrowth / current.newJoinedUsers) * 100) : null,
      newCitySeedUsers: seedUsers,
      newCityShare: current.newJoinedUsers > 0 ? roundPercent((seedUsers / current.newJoinedUsers) * 100) : null,
      newCitiesSeeded: newCitiesAdded,
      activated: current.activatedNewCities,
      stillEmerging: newCities.filter((city) => city.state === "Emerging").length,
      isolated: newCities.filter((city) => city.usersNow === 1).length
    },
    funnel,
    networkBenchmarks,
    persistence: calculatePersistence(cities),
    coverageTrend: calculateOrganicSpreadTrend(cityStats, safeStartMs, endMs, cityRules),
    rampCurves: cities.filter((city) => city.firstJoinedMs >= safeStartMs).slice(0, 8).map(toRampCurve),
    cohorts: calculateCohorts(cities, cityRules),
    depthDistribution,
    migrations: calculateMigrations(cities),
    cities: cities.map(stripPrivateFields),
    newCities: newCities.map(stripPrivateFields),
    existingCityGrowth: cities.filter((city) => city.usersBefore > 0).map(stripPrivateFields)
      .sort((left, right) => right.usersJoinedDuringPeriod - left.usersJoinedDuringPeriod || right.usersNow - left.usersNow),
    cityExplorer: cities.map((city) => buildExplorerCity(city, cityStats.get(city.key), cityByKey, networkBenchmarks, safeStartMs, endMs))
  };
}

function calculateCityCoverage(options = {}) {
  return calculateOrganicSpread(options.events?.length ? options : {
    ...options,
    events: (options.users || []).map((user) => ({
      userId: user?.userId,
      siteId: user?.siteId,
      occurredAt: user?.joinedAt
    }))
  });
}

function calculateCityCoverageTrend(options = {}, bucketCount = 8) {
  const start = new Date(options.periodStart);
  const end = new Date(options.periodEnd);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return [];
  const buckets = Math.max(1, Math.min(24, Number(bucketCount) || 8));
  const width = (end.getTime() - start.getTime()) / buckets;
  return Array.from({ length: buckets }, (_, index) => {
    const bucketStart = new Date(start.getTime() + width * index);
    const bucketEnd = new Date(index === buckets - 1 ? end.getTime() : start.getTime() + width * (index + 1) - 1);
    const result = calculateCityCoverage({ ...options, periodStart: bucketStart, periodEnd: bucketEnd });
    return {
      start: bucketStart.toISOString(),
      end: bucketEnd.toISOString(),
      citiesBefore: result.cityCountBefore,
      citiesAfter: result.cityCountAfter,
      representedCities: result.cityCountAfter,
      activeCities: result.overview.activeCities,
      newCitiesAdded: result.newCitiesAdded,
      newCitiesSeeded: result.newCitiesAdded,
      usersJoined: result.usersJoinedDuringPeriod
    };
  });
}

function resolveCityRules(rules = {}) {
  return {
    activationUsers: positiveInteger(rules.activationUsers, DEFAULT_CITY_RULES.activationUsers),
    establishedUsers: positiveInteger(rules.establishedUsers, DEFAULT_CITY_RULES.establishedUsers),
    establishedActiveWeeks: positiveInteger(rules.establishedActiveWeeks, DEFAULT_CITY_RULES.establishedActiveWeeks),
    dormantDays: positiveInteger(rules.dormantDays, DEFAULT_CITY_RULES.dormantDays),
    takeoffDays: positiveInteger(rules.takeoffDays, DEFAULT_CITY_RULES.takeoffDays)
  };
}

function normalizeEvents(events, endMs) {
  const seen = new Set();
  const normalized = [];
  for (const event of events || []) {
    const userId = cleanId(event?.userId || event?.user_id || event?.visitorId);
    const siteId = cleanId(event?.siteId || event?.site_id);
    const occurredAt = dateMs(event?.occurredAt || event?.createdAt || event?.created_at || event?.joinedAt, NaN);
    if (!userId || !siteId || !Number.isFinite(occurredAt) || occurredAt > endMs) continue;
    const key = `${userId}|${siteId}|${occurredAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ userId, siteId, occurredAt });
  }
  return normalized.sort((left, right) => left.occurredAt - right.occurredAt || left.userId.localeCompare(right.userId));
}

function firstJoinEvents(events) {
  const result = new Map();
  for (const event of events) if (!result.has(event.userId)) result.set(event.userId, event);
  return result;
}

function uniqueEventUsers(events, startMs, endMs) {
  return new Set(events.filter((event) => event.occurredAt >= startMs && event.occurredAt <= endMs).map((event) => event.userId)).size;
}

function joinedInWindow(joinedUsers, startMs, endMs) {
  return [...joinedUsers.values()].filter((event) => event.occurredAt >= startMs && event.occurredAt <= endMs).length;
}

function buildCityStats(events, joinedUsers, cityBySite, siteById) {
  const stats = new Map();
  for (const join of joinedUsers.values()) {
    const city = resolvedCity(cityBySite, join.siteId);
    if (!city.normalized) continue;
    const stat = stats.get(city.normalized) || createCityStat(city.label, city.normalized);
    stat.joins.push(join);
    stat.userIds.add(join.userId);
    addSite(stat, join.siteId, join.userId, join.occurredAt, siteById);
    stats.set(city.normalized, stat);
  }

  for (const event of events) {
    const join = joinedUsers.get(event.userId);
    if (!join) continue;
    const city = resolvedCity(cityBySite, join.siteId);
    const stat = stats.get(city.normalized);
    if (!stat) continue;
    stat.activity.push(event);
    const eventSiteCity = resolvedCity(cityBySite, event.siteId);
    if (eventSiteCity.normalized === city.normalized) addSiteActivity(stat, event.siteId, event.userId, event.occurredAt, siteById);
  }

  for (const stat of stats.values()) {
    stat.joins.sort((left, right) => left.occurredAt - right.occurredAt);
    stat.activity.sort((left, right) => left.occurredAt - right.occurredAt);
  }
  return stats;
}

function createCityStat(city, key) {
  return { city, key, joins: [], activity: [], userIds: new Set(), sites: new Map() };
}

function addSite(stat, siteId, userId, occurredAt, siteById) {
  const site = ensureSite(stat, siteId, siteById);
  site.joinUserIds.add(userId);
  site.firstJoinedAt = Math.min(site.firstJoinedAt, occurredAt);
}

function addSiteActivity(stat, siteId, userId, occurredAt, siteById) {
  const site = ensureSite(stat, siteId, siteById);
  site.activeUserIds.add(userId);
  site.activity.push({ userId, occurredAt });
  site.firstActivityAt = Math.min(site.firstActivityAt, occurredAt);
  site.lastActivityAt = Math.max(site.lastActivityAt, occurredAt);
}

function ensureSite(stat, siteId, siteById) {
  if (!stat.sites.has(siteId)) {
    const source = typeof siteById === "function" ? siteById(siteId) : siteById?.[siteId];
    stat.sites.set(siteId, {
      id: siteId,
      name: cleanId(source?.name || source?.label || siteId),
      joinUserIds: new Set(),
      activeUserIds: new Set(),
      activity: [],
      firstJoinedAt: Infinity,
      firstActivityAt: Infinity,
      lastActivityAt: -Infinity
    });
  }
  return stat.sites.get(siteId);
}

function buildCityDetail(stat, startMs, endMs, rules) {
  const firstJoinedMs = stat.joins[0]?.occurredAt ?? Infinity;
  const joinsAsOf = stat.joins.filter((join) => join.occurredAt <= endMs);
  const activityAsOf = stat.activity.filter((event) => event.occurredAt <= endMs);
  const joinsBefore = joinsAsOf.filter((join) => join.occurredAt < startMs);
  const joinsInWindow = joinsAsOf.filter((join) => join.occurredAt >= startMs);
  const activityInWindow = activityAsOf.filter((event) => event.occurredAt >= startMs);
  const activeUsers = new Set(activityInWindow.map((event) => event.userId));
  const sites = [...stat.sites.values()].map((site) => {
    const representedAt = Math.min(site.firstJoinedAt, site.firstActivityAt);
    const siteActivityAsOf = site.activity.filter((event) => event.occurredAt <= endMs);
    const siteActivity = siteActivityAsOf.filter((event) => event.occurredAt >= startMs);
    return {
      id: site.id,
      name: site.name,
      users: new Set(siteActivityAsOf.map((event) => event.userId)).size,
      activeUsers: new Set(siteActivity.map((event) => event.userId)).size,
      selections: siteActivity.length,
      firstRepresentedAt: finiteIso(representedAt),
      newlyRepresented: representedAt >= startMs && representedAt <= endMs,
      representedAt
    };
  }).filter((site) => site.representedAt <= endMs)
    .sort((left, right) => right.users - left.users || left.name.localeCompare(right.name));
  const ramp = {};
  for (const day of RAMP_DAYS) {
    const mature = endMs >= firstJoinedMs + day * DAY_MS;
    ramp[`d${day}`] = mature
      ? stat.joins.filter((join) => join.occurredAt <= firstJoinedMs + day * DAY_MS).length
      : null;
  }
  const milestones = buildMilestones(joinsAsOf, firstJoinedMs);
  const timeToSecondDays = milestoneDays(joinsAsOf[1]?.occurredAt, firstJoinedMs);
  const activationEvent = joinsAsOf[rules.activationUsers - 1];
  const timeToActivationDays = milestoneDays(activationEvent?.occurredAt, firstJoinedMs);
  const usersNow = joinsAsOf.length;
  const state = lifecycleState(stat, endMs, startMs, rules);
  const stateBefore = firstJoinedMs < startMs ? lifecycleState(stat, startMs - 1, Math.max(firstJoinedMs, startMs - (endMs - startMs)), rules) : "Unrepresented";
  const persistence = {};
  for (const day of [7, 30, 60, 90]) {
    const milestoneAt = firstJoinedMs + day * DAY_MS;
    persistence[`d${day}`] = endMs < milestoneAt
      ? null
      : activityAsOf.some((event) => event.occurredAt >= milestoneAt);
  }

  return {
    key: stat.key,
    city: stat.city,
    firstJoinedMs,
    firstJoinedAt: finiteIso(firstJoinedMs),
    newlyRepresented: firstJoinedMs >= startMs && firstJoinedMs <= endMs,
    ageDays: Math.max(0, Math.floor((endMs - firstJoinedMs) / DAY_MS)),
    usersBefore: joinsBefore.length,
    usersJoinedDuringPeriod: joinsInWindow.length,
    usersAfter: usersNow,
    usersNow,
    activeUsers: activeUsers.size,
    selections: activityInWindow.length,
    sitesRepresented: sites.length,
    activeSites: sites.filter((site) => site.selections > 0).length,
    newSites: sites.filter((site) => site.newlyRepresented).length,
    usersPerSite: sites.length ? roundRatio(usersNow / sites.length) : 0,
    siteExpansionRate: sites.filter((site) => !site.newlyRepresented).length
      ? roundPercent((sites.filter((site) => site.newlyRepresented).length / sites.filter((site) => !site.newlyRepresented).length) * 100)
      : null,
    growthPercent: joinsBefore.length ? roundPercent((joinsInWindow.length / joinsBefore.length) * 100) : null,
    state,
    stateBefore,
    activeWeeks: activeWeekCount(activityAsOf),
    lastActiveAt: finiteIso(activityAsOf.at(-1)?.occurredAt),
    timeToSecondDays,
    timeToActivationDays,
    activatedWithinTakeoff: Number.isFinite(timeToActivationDays) && timeToActivationDays <= rules.takeoffDays,
    matureForTakeoff: endMs >= firstJoinedMs + rules.takeoffDays * DAY_MS || Number.isFinite(timeToActivationDays),
    ramp,
    milestones,
    persistence,
    sites: sites.map(({ representedAt, ...site }) => site)
  };
}

function lifecycleState(stat, asOfMs, windowStartMs, rules) {
  const joins = stat.joins.filter((join) => join.occurredAt <= asOfMs);
  if (!joins.length) return "Unrepresented";
  const activity = stat.activity.filter((event) => event.occurredAt <= asOfMs);
  const lastActiveAt = activity.at(-1)?.occurredAt ?? joins.at(-1).occurredAt;
  const recentCutoff = asOfMs - rules.dormantDays * DAY_MS;
  if (asOfMs - joins[0].occurredAt >= rules.dormantDays * DAY_MS && lastActiveAt < recentCutoff) return "Dormant";
  const weeks = activeWeekCount(activity);
  if (joins.length >= rules.establishedUsers && weeks >= rules.establishedActiveWeeks && asOfMs - joins[0].occurredAt >= 30 * DAY_MS) return "Established";
  const joinedRecently = joins.some((join) => join.occurredAt >= windowStartMs);
  const sitesBefore = new Set(joins.filter((join) => join.occurredAt < windowStartMs).map((join) => join.siteId));
  const expandedSites = joins.some((join) => join.occurredAt >= windowStartMs && !sitesBefore.has(join.siteId));
  if (joins.length >= rules.activationUsers && (joinedRecently || expandedSites)) return "Growing";
  if (joins.length >= rules.activationUsers) return "Activated";
  if (joins.length >= 2) return "Emerging";
  return "Seeded";
}

function calculateWindowMetrics(stats, startMs, endMs, rules) {
  const cityDetails = [...stats.values()].filter((stat) => stat.joins[0]?.occurredAt <= endMs)
    .map((stat) => buildCityDetail(stat, startMs, endMs, rules));
  const activeUsers = new Set();
  const activePreviouslyRepresentedUsers = new Set();
  let newJoinedUsers = 0;
  let existingCityJoinedUsers = 0;
  let newCitySeedUsers = 0;

  for (const stat of stats.values()) {
    const firstJoinedAt = stat.joins[0]?.occurredAt ?? Infinity;
    for (const event of stat.activity) {
      if (event.occurredAt < startMs || event.occurredAt > endMs) continue;
      activeUsers.add(event.userId);
      if (firstJoinedAt < startMs) activePreviouslyRepresentedUsers.add(event.userId);
    }
    for (const join of stat.joins) {
      if (join.occurredAt < startMs || join.occurredAt > endMs) continue;
      newJoinedUsers += 1;
      if (firstJoinedAt < startMs) existingCityJoinedUsers += 1;
      else if (join.occurredAt === firstJoinedAt) newCitySeedUsers += 1;
      else existingCityJoinedUsers += 1;
    }
  }

  const newCities = cityDetails.filter((city) => city.firstJoinedMs >= startMs && city.firstJoinedMs <= endMs);
  const matureSeeds = newCities.filter((city) => city.matureForTakeoff);
  const activated = newCities.filter((city) => city.activatedWithinTakeoff);
  const activeCities = cityDetails.filter((city) => city.activeUsers > 0 && city.usersNow >= rules.activationUsers).length;
  return {
    activeUsers: activeUsers.size,
    activePreviouslyRepresentedUsers: activePreviouslyRepresentedUsers.size,
    newJoinedUsers,
    existingCityJoinedUsers,
    newCitySeedUsers,
    newCitiesSeeded: newCities.length,
    activatedNewCities: activated.length,
    matureCitySeeds: matureSeeds.length,
    pendingCitySeeds: newCities.length - matureSeeds.length,
    cityActivationRate: matureSeeds.length ? roundPercent((activated.length / matureSeeds.length) * 100) : null,
    activeCities,
    observedSpreadRate: activePreviouslyRepresentedUsers.size
      ? roundPercent((newCities.length / activePreviouslyRepresentedUsers.size) * 100)
      : null,
    boundaryCrossingRatio: newJoinedUsers ? roundPercent((newCitySeedUsers / newJoinedUsers) * 100) : null,
    medianTimeToSecondDays: median(newCities.map((city) => city.timeToSecondDays).filter(Number.isFinite))
  };
}

function calculateOrganicSpreadTrend(stats, startMs, endMs, rules, targetBuckets = null) {
  const duration = Math.max(DAY_MS, endMs - startMs);
  const durationDays = Math.max(1, Math.ceil(duration / DAY_MS));
  const desiredBuckets = targetBuckets || (durationDays <= 14
    ? durationDays
    : durationDays <= 120
      ? Math.ceil(durationDays / 7)
      : durationDays <= 240
        ? Math.ceil(durationDays / 14)
        : Math.ceil(durationDays / 30));
  const bucketCount = Math.max(1, Math.min(24, desiredBuckets));
  const width = duration / bucketCount;
  const rows = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const bucketStart = startMs + width * index;
    const bucketEnd = index === bucketCount - 1 ? endMs : startMs + width * (index + 1) - 1;
    const details = [...stats.values()].filter((stat) => stat.joins[0]?.occurredAt <= bucketEnd)
      .map((stat) => buildCityDetail(stat, bucketStart, bucketEnd, rules));
    const newCities = details.filter((city) => city.firstJoinedMs >= bucketStart && city.firstJoinedMs <= bucketEnd);
    let existingCityUsers = 0;
    let seedUsers = 0;
    for (const city of details) {
      if (city.newlyRepresented) {
        seedUsers += city.usersJoinedDuringPeriod > 0 ? 1 : 0;
        existingCityUsers += Math.max(0, city.usersJoinedDuringPeriod - 1);
      } else existingCityUsers += city.usersJoinedDuringPeriod;
    }
    rows.push({
      start: new Date(bucketStart).toISOString(),
      end: new Date(bucketEnd).toISOString(),
      citiesBefore: details.filter((city) => city.firstJoinedMs < bucketStart).length,
      citiesAfter: details.length,
      representedCities: details.length,
      activeCities: details.filter((city) => city.activeUsers > 0 && city.usersNow >= rules.activationUsers).length,
      newCitiesAdded: newCities.length,
      newCitiesSeeded: newCities.length,
      usersJoined: existingCityUsers + seedUsers,
      existingCityUsers,
      newCitySeedUsers: seedUsers
    });
  }
  return rows;
}

function countLifecycle(cities) {
  const result = { Seeded: 0, Emerging: 0, Activated: 0, Growing: 0, Established: 0, Dormant: 0 };
  for (const city of cities) if (Object.hasOwn(result, city.state)) result[city.state] += 1;
  return result;
}

function calculateLifecycleFunnel(cities, rules) {
  const seeded = cities.length;
  const reachedSecond = cities.filter((city) => city.usersNow >= 2).length;
  const activated = cities.filter((city) => city.usersNow >= rules.activationUsers).length;
  const mature30 = cities.filter((city) => city.persistence.d30 !== null);
  const active30 = mature30.filter((city) => city.persistence.d30).length;
  const established = cities.filter((city) => city.state === "Established").length;
  return [
    funnelStage("Cities seeded", seeded, seeded),
    funnelStage("Reached 2 users", reachedSecond, seeded),
    funnelStage("Activated", activated, reachedSecond),
    { ...funnelStage("Still active after 30d", active30, activated), eligible: mature30.length, pending: seeded - mature30.length },
    funnelStage("Established", established, active30)
  ];
}

function funnelStage(label, value, previousValue) {
  return { label, value, conversion: previousValue > 0 ? roundPercent((value / previousValue) * 100) : null };
}

function calculateDepthDistribution(cities) {
  const buckets = [
    { label: "1 user", min: 1, max: 1, cities: 0 },
    { label: "2–3 users", min: 2, max: 3, cities: 0 },
    { label: "4–10 users", min: 4, max: 10, cities: 0 },
    { label: "11–25 users", min: 11, max: 25, cities: 0 },
    { label: "25+ users", min: 26, max: Infinity, cities: 0 }
  ];
  for (const city of cities) {
    const bucket = buckets.find((item) => city.usersNow >= item.min && city.usersNow <= item.max);
    if (bucket) bucket.cities += 1;
  }
  return buckets.map(({ label, cities: count }) => ({ label, cities: count }));
}

function calculateMigrations(cities) {
  const migrations = new Map();
  for (const city of cities) {
    if (city.stateBefore === city.state) continue;
    const key = `${city.stateBefore} → ${city.state}`;
    migrations.set(key, (migrations.get(key) || 0) + 1);
  }
  return [...migrations.entries()].map(([transition, count]) => ({ transition, cities: count }))
    .sort((left, right) => right.cities - left.cities || left.transition.localeCompare(right.transition));
}

function calculateConcentration(stats, joinedUsers, startMs, endMs) {
  const activityByCity = [];
  const usersByCity = [];
  for (const stat of stats.values()) {
    const events = stat.activity.filter((event) => event.occurredAt >= startMs && event.occurredAt <= endMs);
    const selections = events.length;
    const users = new Set(events.map((event) => event.userId)).size;
    if (selections > 0) activityByCity.push({ city: stat.city, value: selections });
    if (users > 0) usersByCity.push({ city: stat.city, value: users });
  }
  activityByCity.sort((left, right) => right.value - left.value);
  usersByCity.sort((left, right) => right.value - left.value);
  const totalSelections = sum(activityByCity.map((item) => item.value));
  const totalUsers = sum(usersByCity.map((item) => item.value));
  const topSelection = activityByCity[0];
  const topUser = usersByCity[0];
  return {
    topCity: topSelection?.city || topUser?.city || null,
    topCitySelectionShare: totalSelections ? roundPercent(((topSelection?.value || 0) / totalSelections) * 100) : null,
    topThreeSelectionShare: totalSelections ? roundPercent((sum(activityByCity.slice(0, 3).map((item) => item.value)) / totalSelections) * 100) : null,
    activityOutsideLargestCity: totalSelections ? roundPercent((1 - (topSelection?.value || 0) / totalSelections) * 100) : null,
    geographicDiversification: totalUsers ? roundPercent((1 - (topUser?.value || 0) / totalUsers) * 100) : null,
    activeUsers: totalUsers,
    totalSelections,
    knownJoinedUsers: joinedUsers.size
  };
}

function calculateSeedFrequency(cities, startMs, endMs, previousStartMs) {
  const inRange = (from, to) => cities.map((city) => city.firstJoinedMs).filter((time) => time >= from && time <= to).sort((a, b) => a - b);
  const intervals = (times) => times.slice(1).map((time, index) => (time - times[index]) / DAY_MS);
  const currentTimes = inRange(startMs, endMs);
  const currentIntervals = intervals(currentTimes);
  const previousIntervals = intervals(inRange(previousStartMs, startMs));
  return {
    currentMedianDays: median(currentIntervals),
    fastestDays: currentIntervals.length ? roundDecimal(Math.min(...currentIntervals)) : null,
    previousMedianDays: median(previousIntervals),
    seedsInPeriod: currentTimes.length
  };
}

function calculatePersistence(cities) {
  const result = {};
  for (const day of [7, 30, 60, 90]) {
    const key = `d${day}`;
    const mature = cities.filter((city) => city.persistence[key] !== null);
    const active = mature.filter((city) => city.persistence[key]).length;
    result[key] = { active, eligible: mature.length, pending: cities.length - mature.length, rate: mature.length ? roundPercent((active / mature.length) * 100) : null };
  }
  return result;
}

function calculateNetworkBenchmarks(cities) {
  const result = {};
  for (const day of RAMP_DAYS) {
    const values = cities.map((city) => city.ramp[`d${day}`]).filter(Number.isFinite);
    result[`d${day}Users`] = median(values);
  }
  result.timeToSecondDays = median(cities.map((city) => city.timeToSecondDays).filter(Number.isFinite));
  result.timeToActivationDays = median(cities.map((city) => city.timeToActivationDays).filter(Number.isFinite));
  result.sitesPerCity = median(cities.map((city) => city.sitesRepresented));
  result.d30PersistenceRate = calculatePersistence(cities).d30.rate;
  return result;
}

function calculateCohorts(cities, rules) {
  const cohorts = new Map();
  for (const city of cities) {
    const date = new Date(city.firstJoinedMs);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(city);
  }
  return [...cohorts.entries()].map(([cohort, members]) => {
    const mature30 = members.filter((city) => city.ramp.d30 !== null);
    const activationEligible = members.filter((city) => city.matureForTakeoff);
    const activated = activationEligible.filter((city) => city.activatedWithinTakeoff).length;
    return {
      cohort,
      label: new Date(`${cohort}-01T00:00:00.000Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }),
      cities: members.length,
      activated,
      activationEligible: activationEligible.length,
      activationRate: activationEligible.length ? roundPercent((activated / activationEligible.length) * 100) : null,
      active30: mature30.filter((city) => city.persistence.d30).length,
      active30Eligible: mature30.length,
      medianD30Users: median(mature30.map((city) => city.ramp.d30).filter(Number.isFinite)),
      pending: members.length - mature30.length,
      activationThreshold: rules.activationUsers
    };
  }).sort((left, right) => right.cohort.localeCompare(left.cohort));
}

function buildExplorerCity(city, stat, cityByKey, networkBenchmarks, startMs, endMs) {
  const duration = Math.max(DAY_MS, endMs - startMs);
  const bucketCount = Math.max(1, Math.min(10, Math.ceil(duration / (7 * DAY_MS))));
  const width = duration / bucketCount;
  const activityTrend = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const bucketStart = startMs + index * width;
    const bucketEnd = index === bucketCount - 1 ? endMs : startMs + (index + 1) * width - 1;
    const events = stat.activity.filter((event) => event.occurredAt >= bucketStart && event.occurredAt <= bucketEnd);
    const representedSites = new Set(stat.joins.filter((join) => join.occurredAt <= bucketEnd).map((join) => join.siteId));
    activityTrend.push({
      start: new Date(bucketStart).toISOString(),
      end: new Date(bucketEnd).toISOString(),
      activeUsers: new Set(events.map((event) => event.userId)).size,
      selections: events.length,
      representedSites: representedSites.size
    });
  }
  return {
    ...stripPrivateFields(city),
    activityTrend,
    compare: {
      city: {
        d7Users: city.ramp.d7,
        d30Users: city.ramp.d30,
        timeToSecondDays: city.timeToSecondDays,
        sitesAtD30: sitesAtDay(stat, city.firstJoinedMs, 30),
        d30PersistenceRate: city.persistence.d30 === null ? null : city.persistence.d30 ? 100 : 0
      },
      networkMedian: {
        d7Users: networkBenchmarks.d7Users,
        d30Users: networkBenchmarks.d30Users,
        timeToSecondDays: networkBenchmarks.timeToSecondDays,
        sitesAtD30: median([...cityByKey.values()].map((entry) => entry.ramp.d30 === null ? null : entry.sitesRepresented).filter(Number.isFinite)),
        d30PersistenceRate: networkBenchmarks.d30PersistenceRate
      }
    }
  };
}

function sitesAtDay(stat, seedMs, day) {
  if (!stat || !Number.isFinite(seedMs)) return null;
  const milestoneAt = seedMs + day * DAY_MS;
  return [...stat.sites.values()].filter((site) => Math.min(site.firstJoinedAt, site.firstActivityAt) <= milestoneAt).length;
}

function buildMilestones(joins, seedMs) {
  const result = {};
  for (const value of [1, 2, 3, 5, 10]) {
    const time = joins[value - 1]?.occurredAt;
    result[`users${value}`] = Number.isFinite(time)
      ? { reachedAt: finiteIso(time), day: roundDecimal((time - seedMs) / DAY_MS) }
      : null;
  }
  return result;
}

function toRampCurve(city) {
  return { city: city.city, firstJoinedAt: city.firstJoinedAt, state: city.state, ...city.ramp };
}

function stripPrivateFields(city) {
  const { key, firstJoinedMs, ...publicCity } = city;
  return publicCity;
}

function citySort(left, right) {
  return Number(right.newlyRepresented) - Number(left.newlyRepresented)
    || right.usersJoinedDuringPeriod - left.usersJoinedDuringPeriod
    || right.usersNow - left.usersNow
    || left.city.localeCompare(right.city);
}

function activeWeekCount(events) {
  return new Set(events.map((event) => weekKey(event.occurredAt))).size;
}

function weekKey(time) {
  const date = new Date(time);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-${String(Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7)).padStart(2, "0")}`;
}

function resolvedCity(cityBySite, siteId) {
  const raw = typeof cityBySite === "function" ? cityBySite(siteId) : cityBySite?.[siteId];
  const value = typeof raw === "string" ? raw : raw?.city;
  const label = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  return { label, normalized: label.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() };
}

function compareValue(current, previous) {
  return { current, previous, change: current - previous, percent: percentChange(current, previous) };
}

function comparePoints(current, previous) {
  return { current, previous, points: Number.isFinite(current) && Number.isFinite(previous) ? roundDecimal(current - previous) : null };
}

function compareDays(current, previous) {
  return { current, previous, days: Number.isFinite(current) && Number.isFinite(previous) ? roundDecimal(current - previous) : null };
}

function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return roundPercent(((current - previous) / previous) * 100);
}

function milestoneDays(time, start) {
  return Number.isFinite(time) && Number.isFinite(start) ? roundDecimal((time - start) / DAY_MS) : null;
}

function median(values) {
  const numbers = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  return roundDecimal(numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2);
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function cleanId(value) {
  return String(value || "").trim();
}

function dateMs(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : fallback;
}

function finiteIso(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function roundRatio(value) {
  return Number((Number(value) || 0).toFixed(4));
}

function roundPercent(value) {
  return Number((Number(value) || 0).toFixed(1));
}

function roundDecimal(value) {
  return Number((Number(value) || 0).toFixed(1));
}

module.exports = {
  DEFAULT_CITY_RULES,
  calculateOrganicSpread,
  calculateCityCoverage,
  calculateCityCoverageTrend,
  resolveCityRules
};
