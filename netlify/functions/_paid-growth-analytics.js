const { getSiteGeography } = require("./_site-data");

const NON_PRODUCTION_MARKER = /(?:^|[\s_-])(test(?:ing)?|demo|sandbox|seed(?:ed)?|sample|placeholder|development|staging)(?:$|[\s_-])/i;

function normalizePeriod(value) {
  if (String(value || "").toLowerCase() === "all") return { days: 36500, key: "all" };
  const days = Number.parseInt(String(value || "30"), 10);
  const allowed = [7, 30, 90, 180, 365];
  const normalized = allowed.includes(days) ? days : 30;
  return { days: normalized, key: String(normalized) };
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function paidSiteLocations(publicSites) {
  return (publicSites || []).flatMap((site) => {
    const id = String(site?.id || "").trim();
    const name = String(site?.name || "").trim();
    const geography = getSiteGeography(id);
    const city = String(geography?.city || "").trim();
    const region = String(geography?.region || "").trim();
    if (!id || !name || !city || NON_PRODUCTION_MARKER.test(`${id} ${name} ${city}`)) return [];
    return [{ siteId: id, siteName: name, city, region: region || "Other" }];
  });
}

function baseCtes(adminOrderSource) {
  return `
    ${adminOrderSource},
    site_locations as (
      select *
      from unnest($1::text[], $2::text[], $3::text[], $4::text[])
        as locations(site_id, site_name, city, region)
    ),
    paid_orders as (
      select
        orders.order_id,
        orders.site_id,
        locations.site_name,
        locations.city,
        locations.region,
        case
          when nullif(trim(orders.customer_email), '') is null then null
          else lower(trim(orders.customer_email))
        end as customer_id,
        orders.amount::numeric as amount,
        coalesce(nullif(orders.currency, ''), 'GBP') as currency,
        coalesce(orders.completed_at, orders.created_at) as paid_at
      from admin_orders orders
      join site_locations locations on locations.site_id = orders.site_id
      where orders.status = 'COMPLETED'
        and orders.amount > 0
        and coalesce(orders.completed_at, orders.created_at) is not null
    ),
    customer_first as (
      select customer_id, min(paid_at) as first_paid_at
      from paid_orders
      where customer_id is not null
      group by customer_id
    ),
    site_first as (
      select site_id, min(paid_at) as first_paid_at
      from paid_orders
      group by site_id
    ),
    city_first as (
      select city, min(paid_at) as first_paid_at
      from paid_orders
      group by city
    ),
    bounds as (
      select
        now() - ($5::int * interval '1 day') as period_start,
        now() as period_end,
        now() - ($5::int * interval '2 days') as previous_start
    )
  `;
}

function emptyAnalytics(period, locations) {
  return {
    meta: {
      periodDays: period.days,
      periodKey: period.key,
      generatedAt: new Date().toISOString(),
      source: "completed_positive_value_orders",
      excludedTrialsAndBrowsing: true,
      mappedProductionSites: locations.length
    },
    summary: {},
    comparison: {},
    trend: [],
    cities: [],
    sites: []
  };
}

async function getPaidGrowthAnalytics({ pool, adminOrderSource, publicSites, periodDays }) {
  const period = normalizePeriod(periodDays);
  const locations = paidSiteLocations(publicSites);
  if (!adminOrderSource || !locations.length) return emptyAnalytics(period, locations);

  const siteIds = locations.map((site) => site.siteId);
  const siteNames = locations.map((site) => site.siteName);
  const cities = locations.map((site) => site.city);
  const regions = locations.map((site) => site.region);
  const params = [siteIds, siteNames, cities, regions, period.days];
  const ctes = baseCtes(adminOrderSource);

  const [summaryResult, trendResult, cityResult, siteResult, excludedResult] = await Promise.all([
    pool.query(`
      with ${ctes}
      select
        (select count(*)::int from customer_first) as total_customers,
        (select count(*)::int from customer_first, bounds where first_paid_at >= bounds.period_start) as new_customers,
        (select count(*)::int from paid_orders, bounds where paid_at >= bounds.period_start) as period_orders,
        (select coalesce(sum(amount), 0) from paid_orders, bounds where paid_at >= bounds.period_start) as period_revenue,
        (select count(*)::int from customer_first, bounds where first_paid_at >= bounds.previous_start and first_paid_at < bounds.period_start) as previous_new_customers,
        (select count(*)::int from paid_orders, bounds where paid_at >= bounds.previous_start and paid_at < bounds.period_start) as previous_orders,
        (select coalesce(sum(amount), 0) from paid_orders, bounds where paid_at >= bounds.previous_start and paid_at < bounds.period_start) as previous_revenue,
        (select count(*)::int from site_first) as total_sites,
        (select count(*)::int from city_first) as total_cities,
        (select count(*)::int from site_first, bounds where first_paid_at >= bounds.period_start) as new_sites,
        (select count(*)::int from city_first, bounds where first_paid_at >= bounds.period_start) as new_cities,
        (select coalesce(max(currency), 'GBP') from paid_orders) as currency,
        (select min(paid_at) from paid_orders) as first_paid_at,
        (select max(paid_at) from paid_orders) as last_paid_at,
        (select count(*)::int from paid_orders, bounds where customer_id is null and paid_at >= bounds.period_start) as orders_without_customer
    `, params),
    pool.query(paidGrowthTrendQuery(ctes, period), params),
    pool.query(`
      with ${ctes},
      city_customer_first as (
        select city, customer_id, min(paid_at) as first_paid_at
        from paid_orders
        where customer_id is not null
        group by city, customer_id
      )
      select
        paid.city,
        max(paid.region) as region,
        count(distinct paid.site_id)::int as paid_sites,
        count(distinct paid.customer_id)::int as paid_customers,
        count(distinct paid.customer_id) filter (where city_customer_first.first_paid_at >= bounds.period_start)::int as new_customers,
        count(distinct paid.site_id) filter (where site_first.first_paid_at >= bounds.period_start)::int as new_sites,
        count(*) filter (where paid.paid_at >= bounds.period_start)::int as period_orders,
        coalesce(sum(paid.amount) filter (where paid.paid_at >= bounds.period_start), 0) as period_revenue,
        count(*)::int as lifetime_orders,
        coalesce(sum(paid.amount), 0) as lifetime_revenue,
        min(paid.paid_at) as first_paid_at,
        max(paid.paid_at) as last_paid_at
      from paid_orders paid
      cross join bounds
      left join city_customer_first on city_customer_first.city = paid.city and city_customer_first.customer_id = paid.customer_id
      left join site_first on site_first.site_id = paid.site_id
      group by paid.city
      order by period_revenue desc, paid_customers desc, paid.city
    `, params),
    pool.query(`
      with ${ctes},
      site_customer_first as (
        select site_id, customer_id, min(paid_at) as first_paid_at
        from paid_orders
        where customer_id is not null
        group by site_id, customer_id
      )
      select
        paid.site_id,
        max(paid.site_name) as site_name,
        max(paid.city) as city,
        count(distinct paid.customer_id)::int as paid_customers,
        count(distinct paid.customer_id) filter (where site_customer_first.first_paid_at >= bounds.period_start)::int as new_customers,
        count(*) filter (where paid.paid_at >= bounds.period_start)::int as period_orders,
        coalesce(sum(paid.amount) filter (where paid.paid_at >= bounds.period_start), 0) as period_revenue,
        count(*)::int as lifetime_orders,
        coalesce(sum(paid.amount), 0) as lifetime_revenue,
        min(paid.paid_at) as first_paid_at,
        max(paid.paid_at) as last_paid_at
      from paid_orders paid
      cross join bounds
      left join site_customer_first on site_customer_first.site_id = paid.site_id and site_customer_first.customer_id = paid.customer_id
      group by paid.site_id
      order by period_revenue desc, paid_customers desc, site_name
      limit 25
    `, params),
    pool.query(`
      with ${adminOrderSource}
      select count(*)::int as excluded_orders
      from admin_orders
      where status = 'COMPLETED'
        and amount > 0
        and (site_id is null or not (site_id = any($1::text[])))
        and coalesce(completed_at, created_at) >= now() - ($2::int * interval '1 day')
    `, [siteIds, period.days])
  ]);

  const row = summaryResult.rows[0] || {};
  const summary = {
    totalCustomers: number(row.total_customers),
    newCustomers: number(row.new_customers),
    periodOrders: number(row.period_orders),
    periodRevenue: number(row.period_revenue),
    totalSites: number(row.total_sites),
    totalCities: number(row.total_cities),
    newSites: number(row.new_sites),
    newCities: number(row.new_cities),
    currency: String(row.currency || "GBP"),
    firstPaidAt: row.first_paid_at || null,
    lastPaidAt: row.last_paid_at || null,
    ordersWithoutCustomer: number(row.orders_without_customer),
    excludedOrders: number(excludedResult.rows[0]?.excluded_orders)
  };

  return {
    meta: {
      periodDays: period.days,
      periodKey: period.key,
      generatedAt: new Date().toISOString(),
      source: "completed_positive_value_orders",
      excludedTrialsAndBrowsing: true,
      mappedProductionSites: locations.length
    },
    summary,
    comparison: period.key === "all" ? {} : {
      newCustomers: number(row.previous_new_customers),
      orders: number(row.previous_orders),
      revenue: number(row.previous_revenue)
    },
    trend: trendResult.rows.map(mapTrendRow),
    cities: cityResult.rows.map(mapCityRow),
    sites: siteResult.rows.map(mapSiteRow)
  };
}

function paidGrowthTrendQuery(ctes, period) {
  const bucket = period.key === "all" ? "month" : period.days <= 90 ? "day" : "week";
  const interval = bucket === "month" ? "1 month" : bucket === "week" ? "1 week" : "1 day";
  const requestedStart = period.key === "all"
    ? `coalesce(date_trunc('month', (select min(paid_at) from paid_orders)), date_trunc('month', now()))`
    : `date_trunc('${bucket}', now() - ($5::int * interval '1 day'))`;
  return `
    with ${ctes},
    buckets as (
      select bucket_start, bucket_start + interval '${interval}' as bucket_end
      from generate_series(
        ${requestedStart},
        date_trunc('${bucket}', now()),
        interval '${interval}'
      ) as bucket_start
    ),
    customer_activity as (
      select
        buckets.bucket_start,
        buckets.bucket_end,
        count(distinct paid.customer_id) filter (where customer_first.first_paid_at >= buckets.bucket_start)::int as new_customers,
        count(paid.order_id)::int as orders,
        coalesce(sum(paid.amount), 0) as revenue
      from buckets
      left join paid_orders paid on paid.paid_at >= buckets.bucket_start and paid.paid_at < buckets.bucket_end
      left join customer_first on customer_first.customer_id = paid.customer_id
      group by buckets.bucket_start, buckets.bucket_end
    )
    select
      to_char(activity.bucket_start, 'YYYY-MM-DD') as date,
      activity.new_customers,
      activity.orders,
      activity.revenue,
      (select count(*)::int from site_first where first_paid_at < activity.bucket_end) as total_sites,
      (select count(*)::int from city_first where first_paid_at < activity.bucket_end) as total_cities,
      (select count(*)::int from site_first where first_paid_at >= activity.bucket_start and first_paid_at < activity.bucket_end) as new_sites,
      (select count(*)::int from city_first where first_paid_at >= activity.bucket_start and first_paid_at < activity.bucket_end) as new_cities
    from customer_activity activity
    order by activity.bucket_start
  `;
}

function mapTrendRow(row) {
  return {
    date: row.date,
    newCustomers: number(row.new_customers),
    orders: number(row.orders),
    revenue: number(row.revenue),
    totalSites: number(row.total_sites),
    totalCities: number(row.total_cities),
    newSites: number(row.new_sites),
    newCities: number(row.new_cities)
  };
}

function mapCityRow(row) {
  return {
    city: row.city,
    region: row.region,
    paidSites: number(row.paid_sites),
    paidCustomers: number(row.paid_customers),
    newCustomers: number(row.new_customers),
    newSites: number(row.new_sites),
    periodOrders: number(row.period_orders),
    periodRevenue: number(row.period_revenue),
    lifetimeOrders: number(row.lifetime_orders),
    lifetimeRevenue: number(row.lifetime_revenue),
    firstPaidAt: row.first_paid_at,
    lastPaidAt: row.last_paid_at
  };
}

function mapSiteRow(row) {
  return {
    siteId: row.site_id,
    siteName: row.site_name,
    city: row.city,
    paidCustomers: number(row.paid_customers),
    newCustomers: number(row.new_customers),
    periodOrders: number(row.period_orders),
    periodRevenue: number(row.period_revenue),
    lifetimeOrders: number(row.lifetime_orders),
    lifetimeRevenue: number(row.lifetime_revenue),
    firstPaidAt: row.first_paid_at,
    lastPaidAt: row.last_paid_at
  };
}

module.exports = {
  getPaidGrowthAnalytics,
  normalizePeriod,
  paidSiteLocations
};
