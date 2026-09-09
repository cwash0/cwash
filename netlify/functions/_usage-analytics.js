const { normalizePeriod, paidSiteLocations } = require("./_paid-growth-analytics");

const BLUETOOTH_FAILURE_EVENTS = [
  "bluetooth_connection_failed",
  "bluetooth_activation_failed",
  "bluetooth_unexpected_disconnect"
];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyBluetoothFailures() {
  return {
    summary: {
      totalFailures: 0,
      connectionFailures: 0,
      activationFailures: 0,
      unexpectedDisconnects: 0,
      affectedSessions: 0,
      affectedSites: 0,
      affectedMachines: 0,
      latestFailureAt: null
    },
    stages: [],
    recent: []
  };
}

function emptyUsage(period, locations) {
  return {
    meta: {
      periodDays: period.days,
      periodKey: period.key,
      generatedAt: new Date().toISOString(),
      periodBasis: "whole_utc_weeks_for_access_codes",
      mappedProductionSites: locations.length
    },
    summary: {},
    history: [],
    cities: [],
    sites: [],
    bluetoothFailures: emptyBluetoothFailures()
  };
}

async function getUsageAnalytics({ pool, publicSites, periodDays }) {
  const period = normalizePeriod(periodDays);
  const locations = paidSiteLocations(publicSites);
  if (!locations.length) {
    const usage = emptyUsage(period, locations);
    usage.bluetoothFailures = await getBluetoothFailureAnalytics({ pool, period, locations });
    return usage;
  }

  const tableResult = await pool.query(`
    select
      to_regclass('public.access_codes') is not null as access_codes_exists,
      to_regclass('public.code_usage_weekly') is not null as code_usage_exists,
      to_regclass('public.free_trial_claims') is not null as trial_usage_exists
  `);
  const tables = tableResult.rows[0] || {};
  const hasCodeUsage = Boolean(tables.access_codes_exists && tables.code_usage_exists);
  const hasTrialUsage = Boolean(tables.trial_usage_exists);
  if (!hasCodeUsage && !hasTrialUsage) {
    const usage = emptyUsage(period, locations);
    usage.bluetoothFailures = await getBluetoothFailureAnalytics({ pool, period, locations });
    return usage;
  }

  const params = [
    locations.map((site) => site.siteId),
    locations.map((site) => site.siteName),
    locations.map((site) => site.city),
    locations.map((site) => site.region),
    period.days
  ];
  const ctes = usageCtes({ hasCodeUsage, hasTrialUsage });
  const [siteResult, historyResult, bluetoothFailures] = await Promise.all([
    pool.query(`
      with ${ctes}
      select
        locations.site_id,
        locations.site_name,
        locations.city,
        locations.region,
        coalesce(code_site.total_activations, 0)::int + coalesce(trial_site.total_activations, 0)::int as total_activations,
        coalesce(code_site.period_activations, 0)::int + coalesce(trial_site.period_activations, 0)::int as period_activations,
        coalesce(code_site.paid_activations, 0)::int as paid_activations,
        coalesce(code_site.period_paid_activations, 0)::int as period_paid_activations,
        coalesce(trial_site.total_activations, 0)::int as trial_activations,
        coalesce(trial_site.period_activations, 0)::int as period_trial_activations,
        coalesce(code_site.other_activations, 0)::int as other_activations,
        coalesce(code_site.period_other_activations, 0)::int as period_other_activations,
        coalesce(code_site.active_codes, 0)::int as active_codes,
        coalesce(code_site.period_active_codes, 0)::int as period_active_codes,
        least(code_site.first_used_at, trial_site.first_used_at) as first_used_at,
        greatest(code_site.last_used_at, trial_site.last_used_at) as last_used_at
      from site_locations locations
      left join code_site on code_site.site_id = locations.site_id
      left join trial_site on trial_site.site_id = locations.site_id
      where coalesce(code_site.total_activations, 0) + coalesce(trial_site.total_activations, 0) > 0
      order by period_activations desc, total_activations desc, locations.site_name
    `, params),
    pool.query(usageHistoryQuery(ctes, period, { hasCodeUsage, hasTrialUsage }), params),
    getBluetoothFailureAnalytics({ pool, period, locations })
  ]);

  const sites = siteResult.rows.map(mapSiteRow);
  const cities = aggregateCities(sites);
  const summary = sites.reduce((totals, site) => {
    totals.totalActivations += site.totalActivations;
    totals.periodActivations += site.periodActivations;
    totals.paidActivations += site.paidActivations;
    totals.periodPaidActivations += site.periodPaidActivations;
    totals.trialActivations += site.trialActivations;
    totals.periodTrialActivations += site.periodTrialActivations;
    totals.otherActivations += site.otherActivations;
    totals.periodOtherActivations += site.periodOtherActivations;
    totals.activeCodes += site.activeCodes;
    totals.periodActiveCodes += site.periodActiveCodes;
    if (site.periodActivations > 0) totals.periodSites += 1;
    return totals;
  }, {
    totalActivations: 0,
    periodActivations: 0,
    paidActivations: 0,
    periodPaidActivations: 0,
    trialActivations: 0,
    periodTrialActivations: 0,
    otherActivations: 0,
    periodOtherActivations: 0,
    activeCodes: 0,
    periodActiveCodes: 0,
    totalSites: sites.length,
    totalCities: cities.length,
    periodSites: 0,
    periodCities: cities.filter((city) => city.periodActivations > 0).length
  });

  return {
    meta: {
      periodDays: period.days,
      periodKey: period.key,
      generatedAt: new Date().toISOString(),
      periodBasis: "whole_utc_weeks_for_access_codes",
      mappedProductionSites: locations.length
    },
    summary,
    history: historyResult.rows.map((row) => ({
      period: row.period,
      totalActivations: number(row.total_activations),
      paidActivations: number(row.paid_activations),
      trialActivations: number(row.trial_activations),
      otherActivations: number(row.other_activations),
      sitesUsed: number(row.sites_used)
    })),
    cities,
    sites,
    bluetoothFailures
  };
}

async function getBluetoothFailureAnalytics({ pool, period, locations }) {
  const tableResult = await pool.query(`select to_regclass('public.funnel_events') as table_name`);
  if (!tableResult.rows[0]?.table_name) return emptyBluetoothFailures();

  const requiredColumns = [
    "site_id",
    "site_name",
    "machine_id",
    "machine_name",
    "bluetooth_device_name",
    "failure_stage",
    "error_code",
    "error_message"
  ];
  const columnResult = await pool.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'funnel_events'
      and column_name = any($1::text[])
  `, [requiredColumns]);
  if (columnResult.rows.length !== requiredColumns.length) return emptyBluetoothFailures();

  const periodClause = period.key === "all"
    ? "and $2::int >= 0"
    : "and created_at >= now() - ($2::int * interval '1 day')";
  const filters = `
    event_name = any($1::text[])
    and is_bot = false
    and is_test = false
    and environment = 'production'
    and coalesce(failure_stage, '') not in ('device_request', 'api_unavailable')
    and lower(coalesce(error_message, '')) not like '%web bluetooth%unavailable%'
    ${periodClause}
  `;
  const queryParams = [BLUETOOTH_FAILURE_EVENTS, period.days];
  const [summaryResult, stageResult, recentResult] = await Promise.all([
    pool.query(`
      select
        count(*)::int as total_failures,
        count(*) filter (where event_name = 'bluetooth_connection_failed')::int as connection_failures,
        count(*) filter (where event_name = 'bluetooth_activation_failed')::int as activation_failures,
        count(*) filter (where event_name = 'bluetooth_unexpected_disconnect')::int as unexpected_disconnects,
        count(distinct session_hash)::int as affected_sessions,
        count(distinct nullif(site_id, ''))::int as affected_sites,
        count(distinct nullif(machine_id, ''))::int as affected_machines,
        max(created_at) as latest_failure_at
      from funnel_events
      where ${filters}
    `, queryParams),
    pool.query(`
      select
        event_name,
        coalesce(nullif(failure_stage, ''), 'unknown') as failure_stage,
        count(*)::int as failures,
        max(created_at) as latest_failure_at
      from funnel_events
      where ${filters}
      group by event_name, coalesce(nullif(failure_stage, ''), 'unknown')
      order by failures desc, latest_failure_at desc
    `, queryParams),
    pool.query(`
      select
        event_name, source, device_type, site_id, site_name, machine_id, machine_name,
        bluetooth_device_name, failure_stage, error_code, error_message, created_at
      from funnel_events
      where ${filters}
      order by created_at desc
      limit 100
    `, queryParams)
  ]);

  const locationById = new Map(locations.map((location) => [location.siteId, location]));
  const summary = summaryResult.rows[0] || {};
  return {
    summary: {
      totalFailures: number(summary.total_failures),
      connectionFailures: number(summary.connection_failures),
      activationFailures: number(summary.activation_failures),
      unexpectedDisconnects: number(summary.unexpected_disconnects),
      affectedSessions: number(summary.affected_sessions),
      affectedSites: number(summary.affected_sites),
      affectedMachines: number(summary.affected_machines),
      latestFailureAt: summary.latest_failure_at || null
    },
    stages: stageResult.rows.map((row) => ({
      eventName: row.event_name,
      stage: row.failure_stage,
      failures: number(row.failures),
      latestFailureAt: row.latest_failure_at || null
    })),
    recent: recentResult.rows.map((row) => {
      const location = locationById.get(String(row.site_id || ""));
      return {
        eventName: row.event_name,
        source: row.source,
        deviceType: row.device_type,
        siteId: row.site_id,
        siteName: location?.siteName || row.site_name || row.site_id || "Unknown site",
        city: location?.city || "",
        machineId: row.machine_id,
        machineName: row.machine_name,
        bluetoothDeviceName: row.bluetooth_device_name,
        stage: row.failure_stage || "unknown",
        errorCode: row.error_code || "unknown_error",
        errorMessage: row.error_message || "No browser error detail was available.",
        createdAt: row.created_at
      };
    })
  };
}

function usageCtes({ hasCodeUsage, hasTrialUsage }) {
  const codeSite = hasCodeUsage ? `
    code_site as (
      select
        codes.site_id,
        coalesce(sum(usage.login_count), 0)::int as total_activations,
        coalesce(sum(usage.login_count) filter (
          where usage.week_start >= date_trunc('week', now() - ($5::int * interval '1 day'))::date
        ), 0)::int as period_activations,
        coalesce(sum(usage.login_count) filter (where codes.source = 'payment'), 0)::int as paid_activations,
        coalesce(sum(usage.login_count) filter (
          where codes.source = 'payment'
            and usage.week_start >= date_trunc('week', now() - ($5::int * interval '1 day'))::date
        ), 0)::int as period_paid_activations,
        coalesce(sum(usage.login_count) filter (where coalesce(codes.source, '') <> 'payment'), 0)::int as other_activations,
        coalesce(sum(usage.login_count) filter (
          where coalesce(codes.source, '') <> 'payment'
            and usage.week_start >= date_trunc('week', now() - ($5::int * interval '1 day'))::date
        ), 0)::int as period_other_activations,
        count(distinct usage.code) filter (where usage.login_count > 0)::int as active_codes,
        count(distinct usage.code) filter (
          where usage.login_count > 0
            and usage.week_start >= date_trunc('week', now() - ($5::int * interval '1 day'))::date
        )::int as period_active_codes,
        min(coalesce(usage.first_used_at, usage.week_start::timestamptz)) as first_used_at,
        max(coalesce(usage.last_used_at, usage.week_start::timestamptz)) as last_used_at
      from code_usage_weekly usage
      join access_codes codes on codes.code = usage.code
      where usage.login_count > 0
      group by codes.site_id
    )
  ` : `
    code_site as (
      select null::text as site_id, 0::int as total_activations, 0::int as period_activations,
             0::int as paid_activations, 0::int as period_paid_activations,
             0::int as other_activations, 0::int as period_other_activations,
             0::int as active_codes, 0::int as period_active_codes,
             null::timestamptz as first_used_at, null::timestamptz as last_used_at
      where false
    )
  `;
  const trialSite = hasTrialUsage ? `
    trial_site as (
      select
        site_id,
        count(*) filter (where activated_at is not null)::int as total_activations,
        count(*) filter (where activated_at >= now() - ($5::int * interval '1 day'))::int as period_activations,
        min(activated_at) filter (where activated_at is not null) as first_used_at,
        max(activated_at) filter (where activated_at is not null) as last_used_at
      from free_trial_claims
      where activated_at is not null
      group by site_id
    )
  ` : `
    trial_site as (
      select null::text as site_id, 0::int as total_activations, 0::int as period_activations,
             null::timestamptz as first_used_at, null::timestamptz as last_used_at
      where false
    )
  `;
  return `
    site_locations as (
      select *
      from unnest($1::text[], $2::text[], $3::text[], $4::text[])
        as locations(site_id, site_name, city, region)
    ),
    ${codeSite},
    ${trialSite}
  `;
}

function usageHistoryQuery(ctes, period, { hasCodeUsage, hasTrialUsage }) {
  const bucket = period.key === "all" || period.days > 180 ? "month" : "week";
  const startClause = period.key === "all"
    ? ""
    : `where occurred_at >= date_trunc('${bucket}', now() - ($5::int * interval '1 day'))`;
  const sources = [];
  if (hasCodeUsage) sources.push(`
    select date_trunc('${bucket}', usage.week_start::timestamptz) as occurred_at,
           codes.site_id,
           usage.login_count::int as activations,
           case when codes.source = 'payment' then 'paid' else 'other' end as source
    from code_usage_weekly usage
    join access_codes codes on codes.code = usage.code
    where usage.login_count > 0
  `);
  if (hasTrialUsage) sources.push(`
    select date_trunc('${bucket}', claims.activated_at) as occurred_at,
           claims.site_id,
           1::int as activations,
           'trial'::text as source
    from free_trial_claims claims
    where claims.activated_at is not null
  `);
  return `
    with ${ctes},
    usage_rows as (
      ${sources.join(" union all ")}
    ),
    filtered as (
      select rows.*
      from usage_rows rows
      join site_locations locations on locations.site_id = rows.site_id
      ${startClause}
    )
    select
      to_char(occurred_at, 'YYYY-MM-DD') as period,
      coalesce(sum(activations), 0)::int as total_activations,
      coalesce(sum(activations) filter (where source = 'paid'), 0)::int as paid_activations,
      coalesce(sum(activations) filter (where source = 'trial'), 0)::int as trial_activations,
      coalesce(sum(activations) filter (where source = 'other'), 0)::int as other_activations,
      count(distinct site_id)::int as sites_used
    from filtered
    group by occurred_at
    order by occurred_at desc
    limit 60
  `;
}

function mapSiteRow(row) {
  return {
    siteId: row.site_id,
    siteName: row.site_name,
    city: row.city,
    region: row.region,
    totalActivations: number(row.total_activations),
    periodActivations: number(row.period_activations),
    paidActivations: number(row.paid_activations),
    periodPaidActivations: number(row.period_paid_activations),
    trialActivations: number(row.trial_activations),
    periodTrialActivations: number(row.period_trial_activations),
    otherActivations: number(row.other_activations),
    periodOtherActivations: number(row.period_other_activations),
    activeCodes: number(row.active_codes),
    periodActiveCodes: number(row.period_active_codes),
    firstUsedAt: row.first_used_at,
    lastUsedAt: row.last_used_at
  };
}

function aggregateCities(sites) {
  const cities = new Map();
  sites.forEach((site) => {
    const city = cities.get(site.city) || {
      city: site.city,
      region: site.region,
      sitesUsed: 0,
      periodSitesUsed: 0,
      totalActivations: 0,
      periodActivations: 0,
      paidActivations: 0,
      periodPaidActivations: 0,
      trialActivations: 0,
      periodTrialActivations: 0,
      otherActivations: 0,
      periodOtherActivations: 0,
      activeCodes: 0,
      periodActiveCodes: 0,
      lastUsedAt: null
    };
    city.sitesUsed += 1;
    if (site.periodActivations > 0) city.periodSitesUsed += 1;
    ["totalActivations", "periodActivations", "paidActivations", "periodPaidActivations", "trialActivations", "periodTrialActivations", "otherActivations", "periodOtherActivations", "activeCodes", "periodActiveCodes"].forEach((key) => {
      city[key] += site[key];
    });
    if (!city.lastUsedAt || new Date(site.lastUsedAt).getTime() > new Date(city.lastUsedAt).getTime()) city.lastUsedAt = site.lastUsedAt;
    cities.set(site.city, city);
  });
  return [...cities.values()].sort((left, right) => right.periodActivations - left.periodActivations || right.totalActivations - left.totalActivations || left.city.localeCompare(right.city));
}

module.exports = {
  aggregateCities,
  getUsageAnalytics
};
