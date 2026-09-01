const API_URL = "/.netlify/functions/admin-api";
const SESSION_KEY = "laundryAdminCode";
let adminCode = getStoredAdminCode();
let activeTab = "dashboard";
let dashboardData = null;
let selectedSite = null;
let selectedPromoSite = null;
let selectedTrialLimitSite = null;
let siteSearchTimer = null;
let codeFilterTimer = null;
let supportFilter = "UNRESOLVED";
let supportSearchTimer = null;
let selectedTicketId = null;
let feedbackData = null;
let feedbackRecipientFilter = "";
let ordersData = [];
let orderSearchTerm = "";
let codesData = [];
let promosData = [];
let analyticsData = null;
let analyticsHitPaging = { cursor: null, nextCursor: null, history: [], loading: false };
let editingPromo = null;
let promoFilterTimer = null;
let promoSiteSearchTimer = null;
let trialLimitSiteSearchTimer = null;
let supportTicketsData = [];
let activeDrawer = null;
const selectedFeedbackEmails = new Set();
const sortState = {
  recentOrders: { key: "date", direction: "desc" },
  orders: { key: "date", direction: "desc" },
  codes: { key: "createdAt", direction: "desc" },
  promos: { key: "createdAt", direction: "desc" },
  feedbackResponses: { key: "submittedAt", direction: "desc" },
  feedbackInvitations: { key: "sentAt", direction: "desc" }
};

const $ = (id) => document.getElementById(id);
const els = {
  loginOverlay: $("loginOverlay"), loginForm: $("loginForm"), adminCodeInput: $("adminCodeInput"), staySignedInInput: $("staySignedInInput"), loginMessage: $("loginMessage"), app: $("app"),
  refreshBtn: $("refreshBtn"), logoutBtn: $("logoutBtn"), lastUpdated: $("lastUpdated"), commandHealthText: $("commandHealthText"),
  navOrdersBadge: $("navOrdersBadge"), navSupportBadge: $("navSupportBadge"),
  metricRevenue: $("metricRevenue"), metricRevenueSub: $("metricRevenueSub"), metricOrders: $("metricOrders"), metricOrdersSub: $("metricOrdersSub"),
  metricActivations: $("metricActivations"), metricSupport: $("metricSupport"), metricSupportSub: $("metricSupportSub"), trendChart: $("trendChart"),
  recentOrdersBody: $("recentOrdersBody"), methodBreakdown: $("methodBreakdown"), orderTypeBreakdown: $("orderTypeBreakdown"), topSites: $("topSites"), emailDelivery: $("emailDelivery"),
  reloadAnalyticsBtn: $("reloadAnalyticsBtn"), analyticsRange: $("analyticsRange"), analyticsTodayMetric: $("analyticsTodayMetric"), analyticsPeriodMetric: $("analyticsPeriodMetric"), analyticsPeriodSub: $("analyticsPeriodSub"), analyticsNoOrderMetric: $("analyticsNoOrderMetric"), analyticsNoOrderSub: $("analyticsNoOrderSub"), analyticsUniqueMetric: $("analyticsUniqueMetric"), analyticsRejectedAdminMetric: $("analyticsRejectedAdminMetric"), analyticsBotSub: $("analyticsBotSub"), analyticsDataQuality: $("analyticsDataQuality"), analyticsTrendSummary: $("analyticsTrendSummary"), analyticsDemandTrend: $("analyticsDemandTrend"), analyticsActivationTrend: $("analyticsActivationTrend"), analyticsTopSites: $("analyticsTopSites"), analyticsTopSearches: $("analyticsTopSearches"), analyticsSearchModes: $("analyticsSearchModes"), analyticsReferrers: $("analyticsReferrers"), analyticsHitsBody: $("analyticsHitsBody"), analyticsHitsPageStatus: $("analyticsHitsPageStatus"), analyticsHitsPrev: $("analyticsHitsPrev"), analyticsHitsNext: $("analyticsHitsNext"), adminLoginAttemptsBody: $("adminLoginAttemptsBody"),
  withinCityViralityMetric: $("withinCityViralityMetric"), withinCityViralitySample: $("withinCityViralitySample"), crossCityViralityMetric: $("crossCityViralityMetric"), crossCityViralitySample: $("crossCityViralitySample"), geographicViralitySummary: $("geographicViralitySummary"), geographicLocationCoverage: $("geographicLocationCoverage"), geographicViralityTrend: $("geographicViralityTrend"), geographicCityRows: $("geographicCityRows"), geographicRoutes: $("geographicRoutes"),
  ordersBody: $("ordersBody"), reloadOrdersBtn: $("reloadOrdersBtn"), orderStatusFilter: $("orderStatusFilter"), orderSearch: $("orderSearch"), clearOrderSearchBtn: $("clearOrderSearchBtn"), ordersSummary: $("ordersSummary"), cleanupCreatedHours: $("cleanupCreatedHours"), cleanupCreatedOrdersBtn: $("cleanupCreatedOrdersBtn"), ordersMessage: $("ordersMessage"), siteSearchMode: $("siteSearchMode"), adminSiteSearch: $("adminSiteSearch"),
  siteResults: $("siteResults"), selectedAdminSite: $("selectedAdminSite"), newCode: $("newCode"), newCodeWeeklyLimit: $("newCodeWeeklyLimit"), generateCodeBtn: $("generateCodeBtn"), createCodeBtn: $("createCodeBtn"),
  codeCreateMessage: $("codeCreateMessage"), codeFilter: $("codeFilter"), reloadCodesBtn: $("reloadCodesBtn"), codesBody: $("codesBody"),
  newPromoCode: $("newPromoCode"), promoDiscountType: $("promoDiscountType"), promoDiscountValue: $("promoDiscountValue"), promoMaxRedemptions: $("promoMaxRedemptions"), promoSiteSearch: $("promoSiteSearch"), promoSiteResults: $("promoSiteResults"), selectedPromoSite: $("selectedPromoSite"), promoFreeSite: $("promoFreeSite"), promoOneTimeUse: $("promoOneTimeUse"), promoOneTimeAccess: $("promoOneTimeAccess"), createPromoBtn: $("createPromoBtn"), promoCreateMessage: $("promoCreateMessage"), promoFilter: $("promoFilter"), reloadPromosBtn: $("reloadPromosBtn"), promosBody: $("promosBody"),
  freeTrialEnabledInput: $("freeTrialEnabledInput"), freeTrialEnabledStatus: $("freeTrialEnabledStatus"), freeTrialIssuedMetric: $("freeTrialIssuedMetric"), freeTrialActivatedMetric: $("freeTrialActivatedMetric"), freeTrialWaitingMetric: $("freeTrialWaitingMetric"), freeTrialRateMetric: $("freeTrialRateMetric"), freeTrialRows: $("freeTrialRows"), reloadFreeTrialsBtn: $("reloadFreeTrialsBtn"), freeTrialMessage: $("freeTrialMessage"), trialLimitSiteSearch: $("trialLimitSiteSearch"), trialLimitSiteResults: $("trialLimitSiteResults"), selectedTrialLimitSite: $("selectedTrialLimitSite"), trialWeeklyLimitInput: $("trialWeeklyLimitInput"), saveTrialLimitBtn: $("saveTrialLimitBtn"), clearTrialLimitBtn: $("clearTrialLimitBtn"), freeTrialLimitRows: $("freeTrialLimitRows"),
  promoEditOverlay: $("promoEditOverlay"), promoEditCode: $("promoEditCode"), promoEditDiscountType: $("promoEditDiscountType"), promoEditDiscountValue: $("promoEditDiscountValue"), promoEditMaxRedemptions: $("promoEditMaxRedemptions"), promoEditOneTimeUse: $("promoEditOneTimeUse"), promoEditOneTimeAccess: $("promoEditOneTimeAccess"), promoEditMessage: $("promoEditMessage"), closePromoEditBtn: $("closePromoEditBtn"), cancelPromoEditBtn: $("cancelPromoEditBtn"), savePromoEditBtn: $("savePromoEditBtn"),
  reloadFeedbackBtn: $("reloadFeedbackBtn"), feedbackEnabledInput: $("feedbackEnabledInput"), feedbackEnabledStatus: $("feedbackEnabledStatus"), feedbackManualEmails: $("feedbackManualEmails"), feedbackRecipientFilter: $("feedbackRecipientFilter"), feedbackRecipientList: $("feedbackRecipientList"),
  selectVisibleRecipientsBtn: $("selectVisibleRecipientsBtn"), clearRecipientsBtn: $("clearRecipientsBtn"), feedbackSelectionCount: $("feedbackSelectionCount"), sendFeedbackBtn: $("sendFeedbackBtn"), feedbackSendMessage: $("feedbackSendMessage"),
  feedbackResponsesMetric: $("feedbackResponsesMetric"), feedbackResponseRate: $("feedbackResponseRate"), feedbackRatingMetric: $("feedbackRatingMetric"), feedbackRecommendMetric: $("feedbackRecommendMetric"), feedbackInvitesMetric: $("feedbackInvitesMetric"), feedbackInvitesSub: $("feedbackInvitesSub"), feedbackDistribution: $("feedbackDistribution"), feedbackResponsesBody: $("feedbackResponsesBody"), feedbackInvitationsBody: $("feedbackInvitationsBody"),
  reloadSupportBtn: $("reloadSupportBtn"), supportSearch: $("supportSearch"), supportSort: $("supportSort"), ticketList: $("ticketList"), supportDetail: $("supportDetail")
};

function getStoredAdminCode() {
  try {
    return localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || "";
  } catch (_) {
    return "";
  }
}

function storeAdminCode(code, staySignedIn) {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    (staySignedIn ? localStorage : sessionStorage).setItem(SESSION_KEY, code);
  } catch (_) {}
}

function clearStoredAdminCode() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}

async function api(action, payload = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, adminCode, ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    signOut("Your admin session has expired.");
    throw new Error("Unauthorized");
  }
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || "Request failed");
  return data;
}

async function signIn(code) {
  adminCode = String(code || "").trim();
  if (!adminCode) return;
  els.loginMessage.textContent = "Signing in…";
  els.loginMessage.className = "message";
  try {
    await api("authenticate");
    storeAdminCode(adminCode, els.staySignedInInput.checked);
    els.loginOverlay.classList.add("hidden");
    els.app.classList.remove("hidden");
    await loadDashboard();
    const requestedTab = location.hash.replace(/^#/, "");
    if (requestedTab && requestedTab !== "dashboard" && $(`tab-${requestedTab}`)) openTab(requestedTab);
  } catch (error) {
    adminCode = "";
    clearStoredAdminCode();
    els.loginMessage.textContent = error.message === "Unauthorized" ? "Incorrect admin code." : error.message;
    els.loginMessage.className = "message bad";
  }
}

function signOut(message = "") {
  adminCode = "";
  clearStoredAdminCode();
  els.app.classList.add("hidden");
  els.loginOverlay.classList.remove("hidden");
  els.adminCodeInput.value = "";
  els.loginMessage.textContent = message;
  els.loginMessage.className = `message ${message ? "bad" : ""}`.trim();
  setTimeout(() => els.adminCodeInput.focus(), 0);
}

const NAV_GROUPS = {
  dashboard: "command",
  orders: "operations",
  codes: "operations",
  support: "customers",
  feedback: "customers",
  email: "customers",
  analytics: "growth",
  promos: "growth"
};

const NAV_TITLES = {
  command: "Command",
  operations: "Operations",
  customers: "Customers",
  growth: "Growth"
};

function openControlDrawer(id) {
  const drawer = $(id);
  if (!drawer) return;
  closeControlDrawer();
  activeDrawer = drawer;
  drawer.classList.remove("hidden");
  $("drawerBackdrop")?.classList.remove("hidden");
  document.body.classList.add("drawer-open");
  setTimeout(() => drawer.querySelector("input:not([type='hidden']), select, button")?.focus(), 0);
}

function closeControlDrawer() {
  if (activeDrawer) activeDrawer.classList.add("hidden");
  activeDrawer = null;
  $("drawerBackdrop")?.classList.add("hidden");
  document.body.classList.remove("drawer-open");
}

function openTab(tab) {
  const section = $(`tab-${tab}`);
  if (!section) return;
  closeControlDrawer();
  activeTab = tab;
  const navGroup = NAV_GROUPS[tab] || "command";
  document.querySelectorAll(".nav button").forEach((button) => button.classList.toggle("active", button.dataset.navGroup === navGroup));
  document.querySelectorAll(".tab-section").forEach((section) => section.classList.add("hidden"));
  section.classList.remove("hidden");
  const title = section.querySelector(".page-title")?.textContent || "Admin";
  $("workspaceTitle").textContent = NAV_TITLES[navGroup] || "Admin";
  document.title = `${title} · CircuitWash`;
  if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (tab === "dashboard") loadDashboard();
  if (tab === "analytics") loadAnalytics();
  if (tab === "orders") loadOrders();
  if (tab === "codes") loadCodes();
  if (tab === "promos") loadPromos();
  if (tab === "feedback") loadFeedback();
  if (tab === "email" && typeof window.loadEmailCenter === "function") window.loadEmailCenter();
  if (tab === "support") loadSupport();
}

async function refreshActive() {
  if (activeTab === "dashboard") await loadDashboard();
  else if (activeTab === "analytics") await loadAnalytics();
  else if (activeTab === "orders") await loadOrders();
  else if (activeTab === "codes") await loadCodes();
  else if (activeTab === "promos") await loadPromos();
  else if (activeTab === "feedback") await loadFeedback();
  else if (activeTab === "email" && typeof window.loadEmailCenter === "function") await window.loadEmailCenter();
  else if (activeTab === "support") await loadSupport();
}

async function loadDashboard() {
  try {
    dashboardData = await api("dashboard");
    renderDashboard(dashboardData);
  } catch (error) {
    console.error(error);
  }
}

function renderDashboard(data) {
  const s = data.summary || {};
  els.metricRevenue.textContent = money(s.thirtyDayRevenue, s.currency);
  els.metricRevenueSub.textContent = `${money(s.todayRevenue, s.currency)} today · ${money(s.sevenDayRevenue, s.currency)} last 7 days`;
  els.metricOrders.textContent = formatNumber(s.thirtyDayOrders);
  els.metricOrdersSub.textContent = `${formatNumber(s.todayOrders)} today · ${formatNumber(s.totalOrders)} all time`;
  els.metricActivations.textContent = formatNumber(s.activations);
  els.metricSupport.textContent = formatNumber(data.support?.open || 0);
  els.metricSupportSub.textContent = `${formatNumber(data.support?.unread || 0)} unread`;
  els.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  renderCommandStatus(data);
  renderOrders(sortItems("recentOrders", data.recentOrders || []), els.recentOrdersBody, true);
  renderBreakdown(els.methodBreakdown, data.methods || [], "method", "orders");
  renderRevenueBreakdown(els.orderTypeBreakdown, data.orderTypes || [], s.currency || "GBP");
  renderBreakdown(els.topSites, data.sites || [], "siteName", "orders");
  renderEmailDelivery(s);
  drawTrend(data.daily || [], s.currency || "GBP");
}

function renderCommandStatus(data) {
  const operations = data.operations || {};
  const supportUnread = Number(data.support?.unread) || 0;
  const staleOrders = Number(operations.staleCreatedOrders) || 0;
  const failedEmails = Number(operations.recentEmailFailures) || 0;
  const activeIssues = supportUnread + staleOrders + failedEmails;

  els.commandHealthText.textContent = activeIssues
    ? `${formatNumber(activeIssues)} item${activeIssues === 1 ? "" : "s"} need attention`
    : "Operations are clear";
  els.commandHealthText.closest(".command-status")?.classList.toggle("attention", activeIssues > 0);
  setNavBadge(els.navOrdersBadge, staleOrders);
  setNavBadge(els.navSupportBadge, supportUnread);

}

function setNavBadge(element, count) {
  element.textContent = count > 99 ? "99+" : String(count || "");
  element.classList.toggle("hidden", count <= 0);
}

function renderBreakdown(container, items, labelKey, valueKey) {
  container.innerHTML = "";
  if (!items.length) { container.innerHTML = '<div class="muted">No data yet.</div>'; return; }
  const max = Math.max(...items.map((item) => Number(item[valueKey]) || 0), 1);
  items.slice(0, 8).forEach((item) => {
    const row = document.createElement("div"); row.className = "breakdown-row";
    const label = document.createElement("div"); label.className = "breakdown-label"; label.textContent = labelKey === "method" ? paymentMethodLabel(item[labelKey]) : (item[labelKey] || "Other");
    const bar = document.createElement("div"); bar.className = "bar"; const fill = document.createElement("span"); fill.style.width = `${Math.max(4, (Number(item[valueKey]) / max) * 100)}%`; bar.appendChild(fill);
    const value = document.createElement("div"); value.className = "breakdown-value"; value.textContent = formatNumber(item[valueKey]);
    row.append(label, bar, value); container.appendChild(row);
  });
}

function renderEmailDelivery(summary) {
  const sent = Number(summary.emailSent || 0); const failed = Number(summary.emailFailed || 0); const total = Math.max(sent + failed, 1);
  els.emailDelivery.innerHTML = "";
  [{ label: "Sent", value: sent }, { label: "Failed", value: failed }].forEach((item) => {
    const row = document.createElement("div"); row.className = "breakdown-row";
    row.innerHTML = `<div class="breakdown-label">${item.label}</div><div class="bar"><span style="width:${Math.max(item.value ? 4 : 0, item.value / total * 100)}%"></span></div><div class="breakdown-value">${formatNumber(item.value)}</div>`;
    els.emailDelivery.appendChild(row);
  });
}

function renderRevenueBreakdown(container, items, currency) {
  container.innerHTML="";
  if(!items.length){container.innerHTML='<div class="muted">No data yet.</div>';return;}
  const maximum=Math.max(...items.map(item=>Number(item.revenue)||0),1);
  items.slice(0,8).forEach(item=>{const row=document.createElement("div");row.className="breakdown-row";const label=document.createElement("div");label.className="breakdown-label";label.textContent=orderTypeLabel(item.orderType);const bar=document.createElement("div");bar.className="bar";const fill=document.createElement("span");fill.style.width=`${Math.max(4,(Number(item.revenue)||0)/maximum*100)}%`;bar.appendChild(fill);const value=document.createElement("div");value.className="breakdown-value";value.textContent=money(item.revenue,currency);row.append(label,bar,value);container.appendChild(row);});
}

async function loadAnalytics() {
  els.analyticsHitsBody.innerHTML = '<tr><td colspan="5" class="muted">Loading...</td></tr>';
  els.adminLoginAttemptsBody.innerHTML = '<tr><td colspan="3" class="muted">Loading...</td></tr>';
  els.analyticsDemandTrend.innerHTML = '<div class="analytics-empty">Loading aggregated demand...</div>';
  els.analyticsActivationTrend.innerHTML = '<div class="analytics-empty">Loading aggregated activations...</div>';
  els.geographicViralityTrend.innerHTML = '<div class="analytics-empty">Loading geographic virality...</div>';
  analyticsHitPaging = { cursor: null, nextCursor: null, history: [], loading: false };
  try {
    analyticsData = await api("analytics", { limit: 25, periodDays: Number(els.analyticsRange.value) || 30 });
    renderAnalytics(analyticsData);
  } catch (error) {
    els.analyticsHitsBody.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(error.message)}</td></tr>`;
    els.adminLoginAttemptsBody.innerHTML = `<tr><td colspan="3" class="muted">${escapeHtml(error.message)}</td></tr>`;
    els.analyticsDemandTrend.innerHTML = `<div class="analytics-empty">${escapeHtml(error.message)}</div>`;
    els.analyticsActivationTrend.innerHTML = `<div class="analytics-empty">${escapeHtml(error.message)}</div>`;
    els.geographicViralityTrend.innerHTML = `<div class="analytics-empty">${escapeHtml(error.message)}</div>`;
  }
}

function renderAnalytics(data) {
  const s = data.summary || {};
  const periodDays = Number(data.meta?.periodDays) || Number(els.analyticsRange.value) || 30;
  const periodHits = Number(s.periodHits) || 0;
  const noOrderHits = Number(s.noOrderHits) || 0;
  const noOrderRate = periodHits ? (noOrderHits / periodHits) * 100 : 0;
  els.analyticsTodayMetric.textContent = formatNumber(s.todayHits);
  els.analyticsPeriodMetric.textContent = formatNumber(periodHits);
  els.analyticsPeriodSub.textContent = `${periodDays}-day valid activity`;
  els.analyticsNoOrderMetric.textContent = `${noOrderRate.toFixed(1)}%`;
  els.analyticsNoOrderSub.textContent = `${formatNumber(noOrderHits)} of ${formatNumber(periodHits)} selections`;
  els.analyticsUniqueMetric.textContent = formatNumber(s.uniqueVisitors);
  els.analyticsRejectedAdminMetric.textContent = formatNumber(s.rejectedAdminLogins);
  els.analyticsBotSub.textContent = `${periodDays}-day deduplicated visitors`;
  const excluded = (Number(s.excludedHits) || 0) + (Number(s.botHits) || 0);
  els.analyticsDataQuality.textContent = `${formatNumber(excluded)} filtered`;
  els.analyticsDataQuality.classList.toggle("hidden", excluded <= 0);
  renderBreakdown(els.analyticsTopSites, data.topSites || [], "siteName", "hits");
  renderBreakdown(els.analyticsTopSearches, data.topSearches || [], "query", "searches");
  renderBreakdown(els.analyticsSearchModes, data.modes || [], "mode", "hits");
  renderBreakdown(els.analyticsReferrers, data.referrers || [], "referrer", "hits");
  renderAnalyticsTrend(data.daily || []);
  renderAnalyticsBars(els.analyticsActivationTrend, data.weeklyActivations || [], "activations", "week", "activations", "activeCodes");
  renderGeographicVirality(data.geographicVirality || {});
  analyticsHitPaging.nextCursor = data.recentHitsPage?.nextCursor || null;
  renderAnalyticsHits(data.recentHits || []);
  updateAnalyticsPager(data.recentHitsPage || {});
  renderAdminLoginAttempts(data.adminLoginAttempts || []);
}

function renderGeographicVirality(data) {
  const available=Boolean(data.available);
  els.withinCityViralityMetric.textContent=formatCoefficient(data.withinCityVirality);
  els.crossCityViralityMetric.textContent=formatCoefficient(data.crossCityVirality);
  els.withinCityViralitySample.textContent=available
    ? `${formatNumber(data.qualifyingCityCount)} qualifying cities · min ${formatNumber(data.minCitySample)} sources each`
    : "Referral attribution unavailable";
  els.crossCityViralitySample.textContent=available
    ? `${formatNumber(data.crossCityPairs)} unique cross-city pairs · ${formatNumber(data.knownLocationSources)} known-location sources`
    : "Referral attribution unavailable";
  els.geographicLocationCoverage.textContent=`Location coverage ${(Number(data.locationCoverage||0)*100).toFixed(0)}%`;
  els.geographicViralitySummary.textContent=available
    ? `${formatNumber(data.eligibleSourceAccommodations)} eligible source accommodations · ${formatNumber(data.sameSitePairsExcluded)} same-site pairs excluded · ${formatNumber(data.attributionDays)}-day attribution window`
    : (data.reason||"Referral attribution data is not available.");

  renderViralityTrend(data.trend||[],available);
  els.geographicCityRows.innerHTML="";
  const cities=data.cities||[];
  if(!cities.length){els.geographicCityRows.innerHTML='<tr><td colspan="6" class="muted">No qualifying geographic propagation in this period.</td></tr>';}
  else cities.forEach(city=>{const tr=document.createElement("tr");appendCell(tr,city.city);appendCell(tr,formatNumber(city.activeAccommodations));appendCell(tr,formatNumber(city.sameCityAccommodationsReached));appendCell(tr,formatCoefficient(city.withinCityK));appendCell(tr,formatNumber(city.otherCitiesReached));appendCell(tr,formatNumber(city.crossCityAcquisitions));els.geographicCityRows.appendChild(tr);});
  renderBreakdown(els.geographicRoutes,(data.topRoutes||[]).map(route=>({route:`${route.sourceCity} → ${route.targetCity}`,count:route.accommodations})),"route","count");
}

function renderViralityTrend(points,available){
  els.geographicViralityTrend.replaceChildren();
  els.geographicViralityTrend.style.setProperty("--bar-count",String(Math.max(points.length,1)));
  if(!available||!points.length){const empty=document.createElement("div");empty.className="analytics-empty";empty.textContent=available?"No geographic virality activity in this period.":"Referral attribution unavailable.";els.geographicViralityTrend.appendChild(empty);return;}
  const maximum=Math.max(...points.flatMap(point=>[Number(point.withinCityVirality)||0,Number(point.crossCityVirality)||0]),.01);
  points.forEach(point=>{const group=document.createElement("div");group.className="virality-trend-group";const within=Number(point.withinCityVirality)||0;const cross=Number(point.crossCityVirality)||0;group.title=`${formatAnalyticsDate(point.start)} · within ${formatCoefficient(within)} · cross ${formatCoefficient(cross)} · ${formatNumber(point.eligibleSourceAccommodations)} sources`;group.setAttribute("aria-label",group.title);group.tabIndex=0;const bars=document.createElement("div");bars.className="virality-trend-bars";const withinBar=document.createElement("span");withinBar.className="within";withinBar.style.height=`${Math.max(within?3:0,within/maximum*100)}%`;const crossBar=document.createElement("span");crossBar.className="cross";crossBar.style.height=`${Math.max(cross?3:0,cross/maximum*100)}%`;bars.append(withinBar,crossBar);const label=document.createElement("small");label.textContent=formatAnalyticsDate(point.start,true);group.append(bars,label);els.geographicViralityTrend.appendChild(group);});
}

function formatCoefficient(value){return `${(Number(value)||0).toFixed(2)}×`;}

function renderAnalyticsTrend(points) {
  renderAnalyticsBars(els.analyticsDemandTrend, points, "hits", "date", "selections", "uniqueVisitors");
  const total = points.reduce((sum, point) => sum + (Number(point.hits) || 0), 0);
  const busiest = points.reduce((best, point) => Number(point.hits) > Number(best?.hits || 0) ? point : best, null);
  const average = points.length ? total / points.length : 0;
  els.analyticsTrendSummary.textContent = busiest
    ? `${average.toFixed(1)} selections per day · peak ${formatNumber(busiest.hits)} on ${formatAnalyticsDate(busiest.date)}`
    : "No valid selection activity in this period.";
}

function renderAnalyticsBars(container, points, valueKey, dateKey, valueLabel, secondaryKey) {
  container.replaceChildren();
  container.style.setProperty("--bar-count", String(Math.max(points.length, 1)));
  if (!points.length) {
    const empty = document.createElement("div");
    empty.className = "analytics-empty";
    empty.textContent = "No aggregated activity in this period.";
    container.appendChild(empty);
    return;
  }
  const maximum = Math.max(...points.map((point) => Number(point[valueKey]) || 0), 1);
  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  points.forEach((point, index) => {
    const value = Number(point[valueKey]) || 0;
    const secondary = Number(point[secondaryKey]) || 0;
    const date = point[dateKey];
    const bar = document.createElement("div");
    bar.className = "analytics-bar";
    bar.tabIndex = 0;
    bar.title = `${formatAnalyticsDate(date)} · ${formatNumber(value)} ${valueLabel} · ${formatNumber(secondary)} ${secondaryKey === "activeCodes" ? "active codes" : "unique visitors"}`;
    bar.setAttribute("aria-label", bar.title);
    const fill = document.createElement("span");
    fill.style.height = `${Math.max(value ? 3 : 0, (value / maximum) * 100)}%`;
    bar.appendChild(fill);
    if (index % labelStep === 0 || index === points.length - 1) {
      const label = document.createElement("small");
      label.textContent = formatAnalyticsDate(date, true);
      bar.appendChild(label);
    }
    container.appendChild(bar);
  });
}

function formatAnalyticsDate(value, compact = false) {
  const date = new Date(`${String(value || "").slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return String(value || "");
  return date.toLocaleDateString([], compact ? { month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" });
}

async function loadAnalyticsHitPage(cursor, direction) {
  if (analyticsHitPaging.loading) return;
  const previousState = { ...analyticsHitPaging, history: [...analyticsHitPaging.history] };
  if (direction === "older") analyticsHitPaging.history.push(analyticsHitPaging.cursor);
  else if (direction === "newer") analyticsHitPaging.history.pop();
  analyticsHitPaging.loading = true;
  updateAnalyticsPager({});
  try {
    const data = await api("analytics_events", {
      limit: 25,
      cursor: cursor || null,
      periodDays: Number(els.analyticsRange.value) || 30
    });
    analyticsHitPaging.cursor = cursor || null;
    analyticsHitPaging.nextCursor = data.recentHitsPage?.nextCursor || null;
    analyticsData.recentHits = data.recentHits || [];
    analyticsData.recentHitsPage = data.recentHitsPage || {};
    renderAnalyticsHits(analyticsData.recentHits);
    updateAnalyticsPager(analyticsData.recentHitsPage);
  } catch (error) {
    analyticsHitPaging = previousState;
    els.analyticsHitsPageStatus.textContent = error.message;
    updateAnalyticsPager(analyticsData?.recentHitsPage || {});
  } finally {
    analyticsHitPaging.loading = false;
    updateAnalyticsPager(analyticsData?.recentHitsPage || {});
  }
}

function updateAnalyticsPager(page = {}) {
  const count = Number(page.returned) || 0;
  els.analyticsHitsPageStatus.textContent = analyticsHitPaging.loading
    ? "Loading page..."
    : `Page ${analyticsHitPaging.history.length + 1} · ${formatNumber(count)} event${count === 1 ? "" : "s"}`;
  els.analyticsHitsPrev.disabled = analyticsHitPaging.loading || analyticsHitPaging.history.length === 0;
  els.analyticsHitsNext.disabled = analyticsHitPaging.loading || !analyticsHitPaging.nextCursor;
}

function renderAnalyticsHits(hits) {
  els.analyticsHitsBody.innerHTML = "";
  if (!hits.length) {
    els.analyticsHitsBody.innerHTML = '<tr><td colspan="5" class="muted">No tracked site selections yet.</td></tr>';
    return;
  }
  hits.forEach((hit) => {
    const tr = document.createElement("tr");
    appendCell(tr, formatDateTime(hit.createdAt));
    appendCell(tr, hit.siteName);
    appendCell(tr, hit.searchQuery || "—");
    appendCell(tr, titleCase(hit.searchMode || "—"));
    appendCell(tr, hit.referrer || "Direct");
    els.analyticsHitsBody.appendChild(tr);
  });
}

function renderAdminLoginAttempts(attempts) {
  els.adminLoginAttemptsBody.innerHTML = "";
  if (!attempts.length) {
    els.adminLoginAttemptsBody.innerHTML = '<tr><td colspan="3" class="muted">No rejected admin logins recorded.</td></tr>';
    return;
  }
  attempts.forEach((attempt) => {
    const tr = document.createElement("tr");
    markTimedOutput(tr, attempt.createdAt);
    appendCell(tr, formatDateTime(attempt.createdAt));
    appendCell(tr, attempt.attemptedCodePreview || "(blank)", "mono");
    appendCell(tr, attempt.action || "authenticate");
    els.adminLoginAttemptsBody.appendChild(tr);
  });
}

function drawTrend(data, currency) {
  const canvas = els.trendChart; const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(600, Math.round(rect.width * dpr)); canvas.height = Math.max(260, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); const width = canvas.width / dpr; const height = canvas.height / dpr;
  ctx.clearRect(0,0,width,height); const pad = { left: 48, right: 14, top: 18, bottom: 35 }; const values = data.map((item) => Number(item.revenue) || 0); const max = Math.max(...values, 1);
  ctx.strokeStyle = "rgba(148,163,184,.16)"; ctx.fillStyle = "#96a8c3"; ctx.font = "11px system-ui";
  for (let i=0;i<=4;i++) { const y = pad.top + (height-pad.top-pad.bottom) * i/4; ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(width-pad.right,y); ctx.stroke(); const val=max*(1-i/4); ctx.fillText(compactMoney(val,currency),4,y+4); }
  if (!data.length) return;
  const step = (width-pad.left-pad.right)/Math.max(data.length-1,1); const yFor=(v)=>pad.top+(height-pad.top-pad.bottom)*(1-v/max);
  const gradient=ctx.createLinearGradient(0,pad.top,0,height-pad.bottom); gradient.addColorStop(0,"rgba(23,107,99,.24)"); gradient.addColorStop(1,"rgba(23,107,99,0)");
  ctx.beginPath(); data.forEach((item,i)=>{const x=pad.left+i*step,y=yFor(Number(item.revenue)||0); if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}); ctx.lineTo(pad.left+(data.length-1)*step,height-pad.bottom); ctx.lineTo(pad.left,height-pad.bottom); ctx.closePath(); ctx.fillStyle=gradient; ctx.fill();
  ctx.beginPath(); data.forEach((item,i)=>{const x=pad.left+i*step,y=yFor(Number(item.revenue)||0); if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}); ctx.strokeStyle="#176b63"; ctx.lineWidth=2.5; ctx.stroke();
  ctx.fillStyle="#96a8c3"; [0,7,14,21,29].filter(i=>data[i]).forEach(i=>{const x=pad.left+i*step; ctx.fillText(new Date(`${data[i].date}T00:00:00`).toLocaleDateString([], {month:"short",day:"numeric"}),x-16,height-10);});
}

async function loadOrders() {
  els.ordersBody.innerHTML = '<tr><td colspan="9" class="muted">Loading…</td></tr>';
  try { const data = await api("orders", { limit: 200, status: els.orderStatusFilter.value }); ordersData = data.orders || []; renderFilteredOrders(); }
  catch (error) { els.ordersBody.innerHTML = `<tr><td colspan="9" class="muted">${escapeHtml(error.message)}</td></tr>`; }
}

function filteredOrders() {
  const term = orderSearchTerm.trim().toLowerCase();
  if (!term) return [...ordersData];
  return ordersData.filter((order) => [
    order.orderId,
    order.siteName,
    order.siteId,
    order.paymentMethod,
    order.orderType,
    order.code,
    order.email,
    order.status,
    order.emailStatus
  ].some((value) => String(value || "").toLowerCase().includes(term)));
}

function renderOrderSummary() {
  const visible = filteredOrders();
  const completed = visible.filter((order) => order.status === "COMPLETED");
  const created = visible.filter((order) => order.status === "CREATED");
  const revenue = completed.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
  const currency = completed[0]?.currency || visible[0]?.currency || "GBP";
  const uniqueCustomers = new Set(visible.map((order) => String(order.email || "").toLowerCase()).filter(Boolean)).size;
  const chips = [
    ["Loaded", formatNumber(visible.length)],
    ["Completed", formatNumber(completed.length)],
    ["Created", formatNumber(created.length)],
    ["Revenue", money(revenue, currency)],
    ["Customers", formatNumber(uniqueCustomers)]
  ];
  els.ordersSummary.innerHTML = chips.map(([label, value]) => `<div class="summary-chip"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function renderFilteredOrders() {
  renderOrderSummary();
  renderOrders(sortItems("orders", filteredOrders()), els.ordersBody, false);
}

async function cleanupCreatedOrders() {
  const hours = Number(els.cleanupCreatedHours.value || 24);
  const confirmed = window.confirm(`Delete unpaid CREATED orders older than ${hours} hours? Completed payments and access codes will not be touched.`);
  if (!confirmed) return;
  els.cleanupCreatedOrdersBtn.disabled = true;
  setMessage(els.ordersMessage, "Cleaning stale created orders...", "");
  try {
    const data = await api("cleanup_created_orders", { olderThanHours: hours });
    setMessage(els.ordersMessage, `Deleted ${formatNumber(data.deleted || 0)} stale created orders.`, "ok");
    await Promise.all([loadOrders(), loadDashboard()]);
  } catch (error) {
    setMessage(els.ordersMessage, error.message, "bad");
  } finally {
    els.cleanupCreatedOrdersBtn.disabled = false;
  }
}

function renderOrders(orders, tbody, compact) {
  tbody.innerHTML = "";
  if (!orders.length) { tbody.innerHTML = `<tr><td colspan="${compact ? 6 : 9}" class="muted">No orders yet.</td></tr>`; return; }
  orders.forEach((order) => {
    const tr = document.createElement("tr");
    markTimedOutput(tr, order.completedAt || order.createdAt);
    if (compact) {
      appendCell(tr, formatDate(order.completedAt || order.createdAt)); appendCell(tr, order.siteName); appendCell(tr, orderTypeLabel(order.orderType,order.quantity)); appendCell(tr, paymentMethodLabel(order.paymentMethod)); appendCell(tr, money(order.amount, order.currency)); appendPillCell(tr, order.emailStatus || "—");
    } else {
      appendCell(tr, formatDateTime(order.completedAt || order.createdAt)); appendCell(tr, order.orderId, "mono"); appendCell(tr, order.siteName); appendCell(tr, orderTypeLabel(order.orderType,order.quantity)); appendCell(tr, paymentMethodLabel(order.paymentMethod)); appendCell(tr, order.code || "—", "mono"); appendCell(tr, order.email || "—"); appendCell(tr, money(order.amount, order.currency)); appendPillCell(tr, order.status);
    }
    tbody.appendChild(tr);
  });
}

async function loadCustomerNotices() {
  els.customerNoticeList.innerHTML = '<div class="muted">Loading customers...</div>';
  try {
    customerNoticeData = await api("customer_notice_data");
    renderCustomerNoticeRecipients();
  } catch (error) {
    els.customerNoticeList.innerHTML = `<div class="muted">${escapeHtml(error.message)}</div>`;
  }
}

function visibleCustomerNoticeCandidates() {
  const term = customerNoticeFilter.trim().toLowerCase();
  return (customerNoticeData?.customers || []).filter((customer) =>
    !term || `${customer.email} ${customer.siteName} ${customer.orderId}`.toLowerCase().includes(term)
  );
}

function renderCustomerNoticeRecipients() {
  const customers = visibleCustomerNoticeCandidates();
  els.customerNoticeList.innerHTML = "";
  if (!customers.length) {
    els.customerNoticeList.innerHTML = '<div class="muted">No matching customers.</div>';
    updateCustomerNoticeSelectionCount();
    return;
  }
  customers.forEach((customer) => {
    const key = customer.email.toLowerCase();
    const row = document.createElement("label");
    row.className = "recipient-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "recipient-check";
    checkbox.checked = selectedCustomerNoticeEmails.has(key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedCustomerNoticeEmails.add(key);
      else selectedCustomerNoticeEmails.delete(key);
      updateCustomerNoticeSelectionCount();
    });

    const main = document.createElement("div");
    main.className = "recipient-main";
    const email = document.createElement("div");
    email.className = "recipient-email";
    email.textContent = customer.email;
    const meta = document.createElement("div");
    meta.className = "recipient-meta";
    meta.textContent = [
      customer.siteName || "Unknown site",
      customer.purchasedAt ? `Purchased ${formatDate(customer.purchasedAt)}` : "",
      customer.purchaseCount > 1 ? `${customer.purchaseCount} purchases` : ""
    ].filter(Boolean).join(" · ");
    main.append(email, meta);

    const status = document.createElement("div");
    status.className = "recipient-status";
    status.textContent = customer.emailStatus || "Customer";
    row.append(checkbox, main, status);
    els.customerNoticeList.appendChild(row);
  });
  updateCustomerNoticeSelectionCount();
}

function selectedCustomerNoticeRecipients() {
  const customerMap = new Map((customerNoticeData?.customers || []).map((customer) => [customer.email.toLowerCase(), customer.email]));
  return [...selectedCustomerNoticeEmails].map((key) => customerMap.get(key) || key);
}

function updateCustomerNoticeSelectionCount() {
  const count = selectedCustomerNoticeRecipients().length;
  els.customerNoticeSelectionCount.textContent = `${count} customer${count === 1 ? "" : "s"} selected`;
  els.sendWebsiteUpdateBtn.disabled = count === 0;
}

function selectVisibleCustomerNoticeRecipients() {
  visibleCustomerNoticeCandidates().forEach((customer) => selectedCustomerNoticeEmails.add(customer.email.toLowerCase()));
  renderCustomerNoticeRecipients();
}

function clearCustomerNoticeRecipients() {
  selectedCustomerNoticeEmails.clear();
  renderCustomerNoticeRecipients();
}

async function sendWebsiteUpdateNotices() {
  const emails = selectedCustomerNoticeRecipients();
  if (!emails.length) {
    setMessage(els.customerNoticeMessage, "Select at least one customer.", "bad");
    return;
  }
  if (emails.length > 100) {
    setMessage(els.customerNoticeMessage, "Send no more than 100 website updates at once.", "bad");
    return;
  }
  const confirmed = window.confirm(`Send the circuitwash.com website update to ${emails.length} customer${emails.length === 1 ? "" : "s"}?`);
  if (!confirmed) return;

  els.sendWebsiteUpdateBtn.disabled = true;
  els.sendWebsiteUpdateBtn.textContent = "Sending...";
  setMessage(els.customerNoticeMessage, `Sending ${emails.length} website update${emails.length === 1 ? "" : "s"}...`, "");
  try {
    const result = await api("customer_notice_send", { emails });
    const tone = result.failed ? "bad" : "ok";
    setMessage(els.customerNoticeMessage, `${result.sent} sent${result.failed ? `, ${result.failed} failed` : ""}.`, tone);
    if (result.sent) selectedCustomerNoticeEmails.clear();
    await loadCustomerNotices();
  } catch (error) {
    setMessage(els.customerNoticeMessage, error.message, "bad");
  } finally {
    els.sendWebsiteUpdateBtn.textContent = "Send website update";
    updateCustomerNoticeSelectionCount();
  }
}

async function searchAdminSites() {
  const query = els.adminSiteSearch.value.trim();
  if (query.length < 2) { els.siteResults.classList.add("hidden"); return; }
  try {
    const data = await api("search_sites", { query, mode: els.siteSearchMode.value });
    els.siteResults.innerHTML = "";
    if (!data.sites.length) els.siteResults.innerHTML = '<div class="muted" style="padding:10px">No matching sites.</div>';
    data.sites.forEach((site) => {
      const button = document.createElement("button"); button.type="button"; button.className="search-result";
      const strong=document.createElement("strong"); strong.textContent=site.name; button.appendChild(strong);
      if(site.address){const span=document.createElement("span");span.textContent=site.address;button.appendChild(span);}
      button.addEventListener("click",()=>selectAdminSite(site)); els.siteResults.appendChild(button);
    });
    els.siteResults.classList.remove("hidden");
  } catch (error) { els.siteResults.innerHTML=`<div class="muted" style="padding:10px">${escapeHtml(error.message)}</div>`; els.siteResults.classList.remove("hidden"); }
}

function selectAdminSite(site) {
  selectedSite = site; els.selectedAdminSite.textContent = site.address ? `${site.name} — ${site.address}` : site.name; els.selectedAdminSite.classList.remove("hidden"); els.siteResults.classList.add("hidden"); els.adminSiteSearch.value = site.name;
}

async function searchPromoSites() {
  const query=els.promoSiteSearch.value.trim();
  selectedPromoSite=null;els.selectedPromoSite.classList.add("hidden");
  if(query.length<2){els.promoSiteResults.classList.add("hidden");return;}
  els.promoSiteResults.innerHTML='<div class="muted" style="padding:10px">Searching...</div>';els.promoSiteResults.classList.remove("hidden");
  try{
    const data=await api("search_sites",{query,mode:"name"});
    els.promoSiteResults.innerHTML="";
    if(!data.sites.length)els.promoSiteResults.innerHTML='<div class="muted" style="padding:10px">No matching sites.</div>';
    data.sites.forEach((site)=>{
      const button=document.createElement("button");button.type="button";button.className="search-result";
      const strong=document.createElement("strong");strong.textContent=site.name;button.appendChild(strong);
      if(site.address){const span=document.createElement("span");span.textContent=site.address;button.appendChild(span);}
      button.addEventListener("click",()=>selectPromoSite(site));els.promoSiteResults.appendChild(button);
    });
  }catch(error){els.promoSiteResults.innerHTML=`<div class="muted" style="padding:10px">${escapeHtml(error.message)}</div>`;}
}

function selectPromoSite(site) {
  selectedPromoSite=site;els.selectedPromoSite.textContent=site.address?`${site.name} - ${site.address}`:site.name;els.selectedPromoSite.classList.remove("hidden");els.promoSiteResults.classList.add("hidden");els.promoSiteSearch.value=site.name;
}

async function searchTrialLimitSites() {
  const query = els.trialLimitSiteSearch.value.trim();
  selectedTrialLimitSite = null;
  els.selectedTrialLimitSite.classList.add("hidden");
  if (query.length < 2) {
    els.trialLimitSiteResults.classList.add("hidden");
    return;
  }
  els.trialLimitSiteResults.innerHTML = '<div class="muted" style="padding:10px">Searching...</div>';
  els.trialLimitSiteResults.classList.remove("hidden");
  try {
    const data = await api("search_sites", { query, mode: "name" });
    els.trialLimitSiteResults.innerHTML = "";
    if (!data.sites.length) els.trialLimitSiteResults.innerHTML = '<div class="muted" style="padding:10px">No matching sites.</div>';
    data.sites.forEach((site) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      const strong = document.createElement("strong");
      strong.textContent = site.name;
      button.appendChild(strong);
      if (site.address) {
        const span = document.createElement("span");
        span.textContent = site.address;
        button.appendChild(span);
      }
      button.addEventListener("click", () => selectTrialLimitSite(site));
      els.trialLimitSiteResults.appendChild(button);
    });
  } catch (error) {
    els.trialLimitSiteResults.innerHTML = `<div class="muted" style="padding:10px">${escapeHtml(error.message)}</div>`;
  }
}

function selectTrialLimitSite(site, weeklyLimit = "") {
  selectedTrialLimitSite = site;
  els.selectedTrialLimitSite.textContent = site.address ? `${site.name} - ${site.address}` : site.name;
  els.selectedTrialLimitSite.classList.remove("hidden");
  els.trialLimitSiteResults.classList.add("hidden");
  els.trialLimitSiteSearch.value = site.name;
  els.trialWeeklyLimitInput.value = weeklyLimit ? String(weeklyLimit) : "";
}

async function saveTrialSiteLimit() {
  if (!selectedTrialLimitSite) {
    setMessage(els.freeTrialMessage, "Select a site first.", "bad");
    return;
  }
  const weeklyLimit = Number.parseInt(els.trialWeeklyLimitInput.value, 10);
  if (!Number.isInteger(weeklyLimit) || weeklyLimit < 1) {
    setMessage(els.freeTrialMessage, "Enter a weekly limit of at least 1.", "bad");
    return;
  }
  els.saveTrialLimitBtn.disabled = true;
  setMessage(els.freeTrialMessage, "Saving limit...", "");
  try {
    await api("free_trial_set_site_limit", { siteId: selectedTrialLimitSite.id, weeklyLimit });
    await loadFreeTrials();
    setMessage(els.freeTrialMessage, `Saved weekly limit for ${selectedTrialLimitSite.name}.`, "ok");
  } catch (error) {
    setMessage(els.freeTrialMessage, error.message, "bad");
  } finally {
    els.saveTrialLimitBtn.disabled = false;
  }
}

async function clearTrialSiteLimit(site = selectedTrialLimitSite) {
  if (!site) {
    setMessage(els.freeTrialMessage, "Select a site first.", "bad");
    return;
  }
  els.clearTrialLimitBtn.disabled = true;
  setMessage(els.freeTrialMessage, "Removing limit...", "");
  try {
    await api("free_trial_set_site_limit", { siteId: site.id, remove: true });
    if (selectedTrialLimitSite?.id === site.id) els.trialWeeklyLimitInput.value = "";
    await loadFreeTrials();
    setMessage(els.freeTrialMessage, `Removed weekly limit for ${site.name}.`, "ok");
  } catch (error) {
    setMessage(els.freeTrialMessage, error.message, "bad");
  } finally {
    els.clearTrialLimitBtn.disabled = false;
  }
}

function generateLocalCode() {
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const bytes=new Uint8Array(5); crypto.getRandomValues(bytes); els.newCode.value=Array.from(bytes,b=>chars[b%chars.length]).join("");
}

async function createCode() {
  if (!selectedSite) { setMessage(els.codeCreateMessage,"Select a site first.","bad"); return; }
  els.createCodeBtn.disabled=true; setMessage(els.codeCreateMessage,"Creating…","");
  try {
    const data=await api("create_code",{siteId:selectedSite.id,code:els.newCode.value.trim(),weeklyLimit:Number(els.newCodeWeeklyLimit.value||5)});
    els.newCode.value=data.code.code; setMessage(els.codeCreateMessage,`Created ${data.code.code} for ${data.code.siteName}.`,"ok"); await loadCodes();
  } catch(error){setMessage(els.codeCreateMessage,error.message,"bad");} finally{els.createCodeBtn.disabled=false;}
}

async function loadCodes() {
  els.codesBody.innerHTML='<tr><td colspan="11" class="muted">Loading…</td></tr>';
  try {
    const data=await api("list_codes",{limit:300,query:els.codeFilter.value.trim()});
    codesData=data.codes||[];
    renderCodes();
  } catch(error){els.codesBody.innerHTML=`<tr><td colspan="11" class="muted">${escapeHtml(error.message)}</td></tr>`;}
}

function renderCodes() {
  els.codesBody.innerHTML="";
  const codes=sortItems("codes", codesData);
  if(!codes.length){els.codesBody.innerHTML='<tr><td colspan="11" class="muted">No codes found.</td></tr>';return;}
  codes.forEach((code)=>{
    const tr=document.createElement("tr");
    appendCell(tr,code.code,"mono"); appendCell(tr,code.siteName); appendCell(tr,code.source||"—");
    appendCell(tr,`${formatNumber(code.weeklyUses)} / ${formatNumber(code.weeklyLimit)}`);
    const limitTd=document.createElement("td");
    const limitWrap=document.createElement("div");limitWrap.style.display="flex";limitWrap.style.gap="6px";limitWrap.style.alignItems="center";
    const input=document.createElement("input");input.type="number";input.min="1";input.max="100";input.value=String(code.weeklyLimit||5);input.style.width="72px";input.setAttribute("aria-label",`Weekly limit for ${code.code}`);
    const save=document.createElement("button");save.type="button";save.className="button small";save.textContent="Save";save.addEventListener("click",()=>saveWeeklyLimit(code,input,save));
    limitWrap.append(input,save);limitTd.appendChild(limitWrap);tr.appendChild(limitTd);
    appendCell(tr,formatCodeTotalLimit(code)); appendCell(tr,formatNumber(code.uses)); appendCell(tr,code.lastUsedAt?formatDateTime(code.lastUsedAt):"—"); appendCell(tr,code.expiresAt?formatDate(code.expiresAt):"No expiry"); appendPillCell(tr,code.active?"active":"disabled");
    const td=document.createElement("td");
    const actions=document.createElement("div");actions.className="row-actions";
    const toggle=document.createElement("button");toggle.type="button";toggle.className=`button small ${code.active?"danger":""}`;toggle.textContent=code.active?"Disable":"Enable";toggle.addEventListener("click",()=>toggleCode(code,toggle));
    const del=document.createElement("button");del.type="button";del.className="button small danger";del.textContent="Delete";del.title="Delete access code and related history";del.addEventListener("click",()=>deleteCode(code,del));
    actions.append(toggle,del);td.appendChild(actions);tr.appendChild(td);els.codesBody.appendChild(tr);
  });
}

async function toggleCode(code,button){button.disabled=true;try{await api("set_code_active",{code:code.code,active:!code.active});await loadCodes();}catch(error){alert(error.message);}finally{button.disabled=false;}}

async function deleteCode(code,button){
  const uses=Number(code.uses||0);
  const history=uses>0?` It has ${formatNumber(uses)} recorded activation${uses===1?"":"s"}; that history will be kept.`:"";
  if(!confirm(`Permanently delete access code ${code.code}?${history} This cannot be undone.`))return;
  button.disabled=true;
  try{await api("delete_code",{code:code.code});await loadCodes();}
  catch(error){alert(error.message);}
  finally{button.disabled=false;}
}

async function saveWeeklyLimit(code,input,button){
  const weeklyLimit=Math.max(1,Math.min(100,Number.parseInt(input.value,10)||5));
  input.value=String(weeklyLimit);button.disabled=true;button.textContent="Saving…";
  try{await api("set_code_weekly_limit",{code:code.code,weeklyLimit});button.textContent="Saved";setTimeout(()=>{button.textContent="Save";},900);}catch(error){alert(error.message);button.textContent="Save";}finally{button.disabled=false;}
}

function formatCodeTotalLimit(code){
  if(Number(code.maxTotalUses||0)===1&&code.deleteAfterUse)return"Free trial";
  if(code.maxTotalUses)return `${formatNumber(code.maxTotalUses)} total`;
  return "Unlimited";
}

function sanitizePromoInput(value){return String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,32);}

async function createPromo() {
  const code=sanitizePromoInput(els.newPromoCode.value);
  els.newPromoCode.value=code;
  const freeSite=Boolean(els.promoFreeSite.checked);
  const discountType=freeSite?"percent":els.promoDiscountType.value;
  const discountValue=freeSite?100:Number(els.promoDiscountValue.value);
  const maxRedemptions=els.promoOneTimeUse.checked?1:(Number.parseInt(els.promoMaxRedemptions.value,10)||null);
  const accessMaxTotalUses=els.promoOneTimeAccess.checked?1:null;
  if(!code){setMessage(els.promoCreateMessage,"Enter a promo code.","bad");return;}
  if(!Number.isFinite(discountValue)||discountValue<=0){setMessage(els.promoCreateMessage,"Enter a discount greater than zero.","bad");return;}
  els.createPromoBtn.disabled=true;setMessage(els.promoCreateMessage,"Creating...","");
  try{
    const data=await api("create_promo",{code,discountType,discountValue,siteId:selectedPromoSite?.id||"",allowFree:freeSite,maxRedemptions,accessMaxTotalUses});
    setMessage(els.promoCreateMessage,`Created ${data.promo.code}.`,"ok");
    els.newPromoCode.value="";els.promoDiscountValue.value="";els.promoMaxRedemptions.value="";els.promoFreeSite.checked=false;els.promoOneTimeUse.checked=false;els.promoOneTimeAccess.checked=false;selectedPromoSite=null;els.promoSiteSearch.value="";els.selectedPromoSite.classList.add("hidden");
    await loadPromos();
  }catch(error){setMessage(els.promoCreateMessage,error.message,"bad");}
  finally{els.createPromoBtn.disabled=false;}
}

async function loadPromos() {
  await Promise.all([loadPromoCodes(), loadFreeTrials()]);
}

async function loadPromoCodes() {
  els.promosBody.innerHTML='<tr><td colspan="12" class="muted">Loading...</td></tr>';
  try{
    const data=await api("list_promos",{limit:300,query:els.promoFilter.value.trim()});
    promosData=data.promos||[];
    renderPromos();
  }catch(error){els.promosBody.innerHTML=`<tr><td colspan="12" class="muted">${escapeHtml(error.message)}</td></tr>`;}
}

async function loadFreeTrials() {
  els.freeTrialRows.innerHTML = '<tr><td colspan="5" class="muted">Loading free trials...</td></tr>';
  try {
    const data = await api("free_trial_data");
    renderFreeTrials(data);
    setMessage(els.freeTrialMessage, "", "");
  } catch (error) {
    els.freeTrialRows.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(error.message)}</td></tr>`;
    els.freeTrialLimitRows.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(error.message)}</td></tr>`;
    setMessage(els.freeTrialMessage, error.message, "bad");
  }
}

function renderFreeTrials(data = {}) {
  const summary = data.summary || {};
  els.freeTrialEnabledInput.checked = Boolean(data.enabled);
  els.freeTrialEnabledStatus.textContent = data.enabled ? "Live on the homepage" : "Hidden from the homepage";
  els.freeTrialIssuedMetric.textContent = formatNumber(summary.issued);
  els.freeTrialActivatedMetric.textContent = formatNumber(summary.activated);
  els.freeTrialWaitingMetric.textContent = formatNumber(summary.waiting);
  els.freeTrialRateMetric.textContent = `${formatNumber(summary.activationRate)}%`;
  renderFreeTrialLimits(data.limits || []);
  els.freeTrialRows.innerHTML = "";
  const siteStats = Array.isArray(data.siteStats) ? data.siteStats : aggregateFreeTrialSiteStats(data.trials || []);
  if (!siteStats.length) {
    els.freeTrialRows.innerHTML = '<tr><td colspan="5" class="muted">No free trials have been claimed yet.</td></tr>';
    return;
  }
  siteStats.forEach((site) => {
    const tr = document.createElement("tr");
    appendCell(tr, site.siteName || site.siteId || "—");
    appendCell(tr, formatNumber(site.claims));
    appendCell(tr, formatNumber(site.activations));
    appendCell(tr, site.lastClaimedAt ? formatDateTime(site.lastClaimedAt) : "—");
    appendCell(tr, site.lastActivatedAt ? formatDateTime(site.lastActivatedAt) : "—");
    els.freeTrialRows.appendChild(tr);
  });
}

function aggregateFreeTrialSiteStats(trials = []) {
  const grouped = new Map();
  trials.forEach((trial) => {
    const siteId = trial.siteId || trial.siteName || "unknown";
    const current = grouped.get(siteId) || {
      siteId,
      siteName: trial.siteName || trial.siteId || "Unknown site",
      claims: 0,
      activations: 0,
      lastClaimedAt: null,
      lastActivatedAt: null
    };
    current.claims += 1;
    if (trial.used || trial.activatedAt) current.activations += 1;
    if (dateValue(trial.claimedAt) > dateValue(current.lastClaimedAt)) current.lastClaimedAt = trial.claimedAt;
    if (dateValue(trial.activatedAt) > dateValue(current.lastActivatedAt)) current.lastActivatedAt = trial.activatedAt;
    grouped.set(siteId, current);
  });
  return Array.from(grouped.values()).sort((a, b) => dateValue(b.lastClaimedAt) - dateValue(a.lastClaimedAt));
}

function renderFreeTrialLimits(limits = []) {
  els.freeTrialLimitRows.innerHTML = "";
  if (!limits.length) {
    els.freeTrialLimitRows.innerHTML = '<tr><td colspan="4" class="muted">No site limits set.</td></tr>';
    return;
  }
  limits.forEach((limit) => {
    const tr = document.createElement("tr");
    const siteCell = document.createElement("td");
    const siteName = document.createElement("strong");
    siteName.textContent = limit.siteName || limit.siteId || "Unknown site";
    siteCell.appendChild(siteName);
    if (limit.siteAddress) {
      const address = document.createElement("div");
      address.className = "muted";
      address.textContent = limit.siteAddress;
      siteCell.appendChild(address);
    }
    tr.appendChild(siteCell);
    appendCell(tr, formatNumber(limit.usedThisWeek));
    appendCell(tr, formatNumber(limit.weeklyLimit));
    const actionCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "button small";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => selectTrialLimitSite({
      id: limit.siteId,
      name: limit.siteName,
      address: limit.siteAddress || ""
    }, limit.weeklyLimit));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button small danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => clearTrialSiteLimit({
      id: limit.siteId,
      name: limit.siteName,
      address: limit.siteAddress || ""
    }));
    actions.append(edit, remove);
    actionCell.appendChild(actions);
    tr.appendChild(actionCell);
    els.freeTrialLimitRows.appendChild(tr);
  });
}

async function saveFreeTrialEnabled() {
  const enabled = Boolean(els.freeTrialEnabledInput.checked);
  els.freeTrialEnabledInput.disabled = true;
  els.freeTrialEnabledStatus.textContent = "Saving…";
  try {
    const result = await api("free_trial_set_enabled", { enabled });
    els.freeTrialEnabledInput.checked = Boolean(result.enabled);
    els.freeTrialEnabledStatus.textContent = result.enabled ? "Live on the homepage" : "Hidden from the homepage";
    setMessage(els.freeTrialMessage, result.enabled ? "Free trials are now live." : "Free trials are now hidden.", "ok");
  } catch (error) {
    els.freeTrialEnabledInput.checked = !enabled;
    els.freeTrialEnabledStatus.textContent = els.freeTrialEnabledInput.checked ? "Live on the homepage" : "Hidden from the homepage";
    setMessage(els.freeTrialMessage, error.message, "bad");
  } finally {
    els.freeTrialEnabledInput.disabled = false;
  }
}

function renderPromos() {
  els.promosBody.innerHTML="";
  const promos=sortItems("promos",promosData);
  if(!promos.length){els.promosBody.innerHTML='<tr><td colspan="12" class="muted">No promo codes found.</td></tr>';return;}
  const currency=dashboardData?.summary?.currency||"GBP";
  promos.forEach((promo)=>{
    const tr=document.createElement("tr");
    appendCell(tr,promo.code,"mono");
    appendCell(tr,formatPromoDiscount(promo,currency));
    appendCell(tr,promo.siteName||"Any site");
    appendCell(tr,formatPromoLimits(promo));
    appendCell(tr,formatNumber(promo.successfulOrders));
    appendCell(tr,formatNumber(promo.createdOrders));
    appendCell(tr,formatNumber(promo.customers));
    appendCell(tr,money(promo.discountTotal,currency));
    appendCell(tr,money(promo.netRevenue,currency));
    appendCell(tr,promo.lastUsedAt?formatDateTime(promo.lastUsedAt):"—");
    appendPillCell(tr,promo.active?"active":"disabled");
    const td=document.createElement("td");
    const actions=document.createElement("div");actions.className="row-actions";
    const edit=document.createElement("button");edit.type="button";edit.className="button small";edit.textContent="Edit";edit.addEventListener("click",()=>openPromoEditor(promo));
    const toggle=document.createElement("button");toggle.type="button";toggle.className=`button small ${promo.active?"danger":""}`;toggle.textContent=promo.active?"Disable":"Enable";toggle.addEventListener("click",()=>togglePromo(promo,toggle));
    const del=document.createElement("button");del.type="button";del.className="button small danger";del.textContent="Delete";del.title="Delete promo code and related history";del.addEventListener("click",()=>deletePromo(promo,del));
    actions.append(edit,toggle,del);
    td.appendChild(actions);tr.appendChild(td);els.promosBody.appendChild(tr);
  });
}

async function togglePromo(promo,button){button.disabled=true;try{await api("set_promo_active",{code:promo.code,active:!promo.active});await loadPromos();}catch(error){alert(error.message);}finally{button.disabled=false;}}

function openPromoEditor(promo){
  editingPromo=promo;
  els.promoEditCode.textContent=promo.code;
  els.promoEditDiscountType.value=promo.discountType||"percent";
  els.promoEditDiscountValue.value=String(promo.discountValue||"");
  els.promoEditMaxRedemptions.value=promo.maxRedemptions?String(promo.maxRedemptions):"";
  els.promoEditOneTimeUse.checked=Number(promo.maxRedemptions||0)===1;
  els.promoEditOneTimeAccess.checked=Number(promo.accessMaxTotalUses||0)===1;
  setMessage(els.promoEditMessage,"","");
  els.promoEditOverlay.classList.remove("hidden");
  setTimeout(()=>els.promoEditDiscountValue.focus(),0);
}

function closePromoEditor(){
  editingPromo=null;
  els.promoEditOverlay.classList.add("hidden");
  els.savePromoEditBtn.disabled=false;
  els.savePromoEditBtn.textContent="Save changes";
  setMessage(els.promoEditMessage,"","");
}

async function savePromo(){
  if(!editingPromo)return;
  const discountType=els.promoEditDiscountType.value;
  const discountValue=Number(els.promoEditDiscountValue.value);
  const maxRedemptions=els.promoEditOneTimeUse.checked?1:(Number.parseInt(els.promoEditMaxRedemptions.value,10)||null);
  const accessMaxTotalUses=els.promoEditOneTimeAccess.checked?1:null;
  if(!Number.isFinite(discountValue)||discountValue<=0){setMessage(els.promoEditMessage,"Enter a discount greater than zero.","bad");return;}
  els.savePromoEditBtn.disabled=true;els.savePromoEditBtn.textContent="Saving...";
  try{
    await api("update_promo",{code:editingPromo.code,discountType,discountValue,maxRedemptions,accessMaxTotalUses});
    closePromoEditor();
    await loadPromos();
  }catch(error){
    setMessage(els.promoEditMessage,error.message,"bad");
    els.savePromoEditBtn.textContent="Save changes";
  }finally{
    els.savePromoEditBtn.disabled=false;
  }
}

async function deletePromo(promo,button){
  const orders=Number(promo.createdOrders||0);
  const history=orders>0?` This will also delete ${formatNumber(orders)} checkout order${orders===1?"":"s"}, any generated access code${orders===1?"":"s"}, and related usage/feedback/referral history.`:"";
  if(!confirm(`Permanently delete promo code ${promo.code}?${history} This cannot be undone.`))return;
  button.disabled=true;
  try{await api("delete_promo",{code:promo.code});await loadPromos();}
  catch(error){alert(error.message);}
  finally{button.disabled=false;}
}

function formatPromoDiscount(promo,currency="GBP"){
  return promo.discountType==="percent" ? `${Number(promo.discountValue).toFixed(2).replace(/\.00$/,"")}%` : money(promo.discountValue,currency);
}

function formatPromoLimits(promo){
  const parts=[];
  if(promo.maxRedemptions)parts.push(`${formatNumber(promo.createdOrders||0)} / ${formatNumber(promo.maxRedemptions)} claimed`);
  else parts.push("Unlimited uses");
  if(Number(promo.accessMaxTotalUses||0)===1)parts.push("one-time access code");
  return parts.join(" · ");
}

async function loadFeedback() {
  els.feedbackRecipientList.innerHTML='<div class="muted">Loading customers…</div>';
  els.feedbackResponsesBody.innerHTML='<tr><td colspan="6" class="muted">Loading…</td></tr>';
  els.feedbackInvitationsBody.innerHTML='<tr><td colspan="5" class="muted">Loading…</td></tr>';
  try {
    feedbackData=await api("feedback_data");
    renderFeedbackEnabledState();
    renderFeedbackOverview();
    renderFeedbackRecipients();
    renderFeedbackResponses();
    renderFeedbackInvitations();
  } catch(error) {
    els.feedbackRecipientList.innerHTML=`<div class="muted">${escapeHtml(error.message)}</div>`;
    els.feedbackResponsesBody.innerHTML=`<tr><td colspan="6" class="muted">${escapeHtml(error.message)}</td></tr>`;
    els.feedbackInvitationsBody.innerHTML=`<tr><td colspan="5" class="muted">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderFeedbackEnabledState() {
  const enabled=feedbackData?.enabled!==false;
  els.feedbackEnabledInput.checked=enabled;
  els.feedbackEnabledInput.disabled=false;
  els.feedbackEnabledStatus.textContent=enabled?"On":"Off";
  els.feedbackManualEmails.disabled=!enabled;
  els.feedbackRecipientFilter.disabled=!enabled;
  els.selectVisibleRecipientsBtn.disabled=!enabled;
  els.clearRecipientsBtn.disabled=!enabled;
  updateFeedbackSelectionCount();
}

async function saveFeedbackEnabled() {
  const enabled=els.feedbackEnabledInput.checked;
  els.feedbackEnabledInput.disabled=true;
  els.feedbackEnabledStatus.textContent="Saving...";
  try {
    const result=await api("feedback_set_enabled",{enabled});
    feedbackData={...(feedbackData||{}),enabled:result.enabled};
    renderFeedbackEnabledState();
    setMessage(els.feedbackSendMessage,`Feedback turned ${result.enabled?"on":"off"}.`,"ok");
  } catch(error) {
    els.feedbackEnabledInput.checked=feedbackData?.enabled!==false;
    els.feedbackEnabledInput.disabled=false;
    els.feedbackEnabledStatus.textContent=feedbackData?.enabled===false?"Off":"On";
    setMessage(els.feedbackSendMessage,error.message,"bad");
  }
}

function renderFeedbackOverview() {
  const summary=feedbackData?.summary||{};
  els.feedbackResponsesMetric.textContent=formatNumber(summary.responses);
  els.feedbackResponseRate.textContent=`${Number(summary.responseRate||0).toFixed(1).replace(/\.0$/,"")}% email response rate`;
  els.feedbackRatingMetric.textContent=summary.responses?Number(summary.averageRating||0).toFixed(1):"—";
  els.feedbackRecommendMetric.textContent=summary.responses?`${Number(summary.recommendRate||0).toFixed(1).replace(/\.0$/,"")}%`:"—";
  els.feedbackInvitesMetric.textContent=formatNumber(summary.invitationsSent);
  if(els.feedbackInvitesSub) els.feedbackInvitesSub.textContent=`${formatNumber(summary.popupPrompts||0)} popup prompt${Number(summary.popupPrompts||0)===1?"":"s"}`;
  const max=Math.max(1,...(feedbackData?.distribution||[]).map(item=>Number(item.responses)||0));
  els.feedbackDistribution.innerHTML="";
  (feedbackData?.distribution||[]).forEach(item=>{
    const row=document.createElement("div");row.className="breakdown-row";
    const label=document.createElement("div");label.className="breakdown-label";label.textContent=`${item.rating} star${item.rating===1?"":"s"}`;
    const bar=document.createElement("div");bar.className="bar";const fill=document.createElement("span");fill.style.width=`${Math.max(0,Math.min(100,(Number(item.responses)||0)/max*100))}%`;bar.appendChild(fill);
    const value=document.createElement("div");value.className="breakdown-value";value.textContent=formatNumber(item.responses);
    row.append(label,bar,value);els.feedbackDistribution.appendChild(row);
  });
  if(!feedbackData?.distribution?.length) els.feedbackDistribution.innerHTML='<div class="muted">No responses yet.</div>';
}

function visibleFeedbackCandidates() {
  const term=feedbackRecipientFilter.trim().toLowerCase();
  return (feedbackData?.candidates||[]).filter(candidate=>!term||`${candidate.email} ${candidate.siteName}`.toLowerCase().includes(term));
}

function renderFeedbackRecipients() {
  const candidates=visibleFeedbackCandidates();
  els.feedbackRecipientList.innerHTML="";
  if(!candidates.length){els.feedbackRecipientList.innerHTML='<div class="muted">No matching customers.</div>';updateFeedbackSelectionCount();return;}
  candidates.forEach(candidate=>{
    const row=document.createElement("label");row.className="recipient-row";
    const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.className="recipient-check";checkbox.checked=selectedFeedbackEmails.has(candidate.email.toLowerCase());checkbox.disabled=feedbackData?.enabled===false;checkbox.addEventListener("change",()=>{const key=candidate.email.toLowerCase();if(checkbox.checked)selectedFeedbackEmails.add(key);else selectedFeedbackEmails.delete(key);updateFeedbackSelectionCount();});
    const main=document.createElement("div");main.className="recipient-main";
    const email=document.createElement("div");email.className="recipient-email";email.textContent=candidate.email;
    const meta=document.createElement("div");meta.className="recipient-meta";meta.textContent=[candidate.siteName||"Unknown site",candidate.purchasedAt?`Purchased ${formatDate(candidate.purchasedAt)}`:"",candidate.purchaseCount>1?`${candidate.purchaseCount} purchases`:""].filter(Boolean).join(" · ");
    main.append(email,meta);
    const status=document.createElement("div");status.className="recipient-status";status.textContent=candidate.lastRespondedAt?"Responded":candidate.lastInvitedAt?`Invited ${formatDate(candidate.lastInvitedAt)}`:"Not invited";
    row.append(checkbox,main,status);els.feedbackRecipientList.appendChild(row);
  });
  updateFeedbackSelectionCount();
}

function parseManualFeedbackEmails() {
  return String(els.feedbackManualEmails.value||"").split(/[\s,;]+/).map(value=>value.trim()).filter(Boolean);
}

function selectedFeedbackRecipients() {
  const candidateMap=new Map((feedbackData?.candidates||[]).map(candidate=>[candidate.email.toLowerCase(),candidate.email]));
  const emails=[...selectedFeedbackEmails].map(key=>candidateMap.get(key)||key);
  return [...new Map([...emails,...parseManualFeedbackEmails()].map(email=>[email.toLowerCase(),email])).values()];
}

function updateFeedbackSelectionCount() {
  const count=selectedFeedbackRecipients().length;
  els.feedbackSelectionCount.textContent=`${count} recipient${count===1?"":"s"} selected`;
  els.sendFeedbackBtn.disabled=feedbackData?.enabled===false||count===0;
}

function selectVisibleFeedbackRecipients() {
  visibleFeedbackCandidates().forEach(candidate=>selectedFeedbackEmails.add(candidate.email.toLowerCase()));
  renderFeedbackRecipients();
}

function clearFeedbackRecipients() {
  selectedFeedbackEmails.clear();
  els.feedbackManualEmails.value="";
  renderFeedbackRecipients();
}

async function sendFeedbackRequests() {
  const emails=selectedFeedbackRecipients();
  if(!emails.length){setMessage(els.feedbackSendMessage,"Select or enter at least one email address.","bad");return;}
  if(emails.length>50){setMessage(els.feedbackSendMessage,"Send no more than 50 requests at once.","bad");return;}
  els.sendFeedbackBtn.disabled=true;els.sendFeedbackBtn.textContent="Sending…";setMessage(els.feedbackSendMessage,`Sending ${emails.length} feedback request${emails.length===1?"":"s"}…`,"");
  try {
    const result=await api("feedback_send",{emails});
    const tone=result.failed?"bad":"ok";
    setMessage(els.feedbackSendMessage,`${result.sent} sent${result.failed?`, ${result.failed} failed`:""}.`,tone);
    if(result.sent){selectedFeedbackEmails.clear();els.feedbackManualEmails.value="";}
    await loadFeedback();
  } catch(error){setMessage(els.feedbackSendMessage,error.message,"bad");}
  finally{els.sendFeedbackBtn.textContent="Send feedback form";updateFeedbackSelectionCount();}
}

function renderFeedbackResponses() {
  const responses=sortItems("feedbackResponses", feedbackData?.responses||[]);els.feedbackResponsesBody.innerHTML="";
  if(!responses.length){els.feedbackResponsesBody.innerHTML='<tr><td colspan="7" class="muted">No feedback responses yet.</td></tr>';return;}
  responses.forEach(response=>{
    const tr=document.createElement("tr");markTimedOutput(tr,response.submittedAt);appendCell(tr,formatDateTime(response.submittedAt));appendCell(tr,response.email);appendCell(tr,response.siteName||"—");appendCell(tr,feedbackSourceLabel(response.source));
    const ratingTd=document.createElement("td");const stars=document.createElement("span");stars.className="stars-inline";stars.textContent="★".repeat(response.rating)+"☆".repeat(Math.max(0,5-response.rating));ratingTd.appendChild(stars);tr.appendChild(ratingTd);
    appendPillCell(tr,titleCase(response.recommend));const comment=document.createElement("td");comment.className="comment-cell";comment.textContent=response.comments||"—";tr.appendChild(comment);els.feedbackResponsesBody.appendChild(tr);
  });
}

function feedbackSourceLabel(source) {
  const value=String(source||"EMAIL").toUpperCase();
  if(value==="POPUP") return "Popup";
  if(value==="TEST") return "Test";
  return "Email";
}

function renderFeedbackInvitations() {
  const invitations=sortItems("feedbackInvitations", feedbackData?.invitations||[]);els.feedbackInvitationsBody.innerHTML="";
  if(!invitations.length){els.feedbackInvitationsBody.innerHTML='<tr><td colspan="6" class="muted">No feedback invitations yet.</td></tr>';return;}
  invitations.forEach(invite=>{const tr=document.createElement("tr");markTimedOutput(tr,invite.sentAt||invite.createdAt);appendCell(tr,formatDateTime(invite.sentAt||invite.createdAt));appendCell(tr,invite.email);appendCell(tr,invite.siteName||"—");appendCell(tr,feedbackSourceLabel(invite.source));appendPillCell(tr,titleCase(invite.status));appendCell(tr,invite.respondedAt?formatDateTime(invite.respondedAt):invite.error||"—");els.feedbackInvitationsBody.appendChild(tr);});
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (_) {
    window.prompt("Copy this link:", value);
  }
}

async function loadSupport() {
  els.ticketList.innerHTML='<div class="muted">Loading…</div>';
  try {
    const data=await api("support_list",{status:supportFilter,search:els.supportSearch?.value||"",limit:150}); supportTicketsData=data.tickets||[]; renderTicketList(sortedSupportTickets());
    if(selectedTicketId && !supportTicketsData.some(t=>t.id===selectedTicketId)){selectedTicketId=null;els.supportDetail.className="surface support-empty";els.supportDetail.textContent="Select a support message.";}
  } catch(error){els.ticketList.innerHTML=`<div class="muted">${escapeHtml(error.message)}</div>`;}
}

function renderTicketList(tickets){els.ticketList.innerHTML="";if(!tickets.length){els.ticketList.innerHTML='<div class="muted">No support messages.</div>';return;}tickets.forEach(ticket=>{const button=document.createElement("button");button.type="button";button.className=`ticket ${ticket.isRead?"":"unread"} ${ticket.id===selectedTicketId?"active":""}`;markTimedOutput(button,ticket.lastActivityAt);button.innerHTML=`<div class="ticket-head"><span class="ticket-from"></span><span class="ticket-time">${escapeHtml(formatDate(ticket.lastActivityAt))}</span></div><div class="ticket-subject"></div><div class="ticket-snippet"></div><div class="ticket-context"></div>`;button.querySelector(".ticket-from").textContent=ticket.fromName||ticket.fromEmail;button.querySelector(".ticket-subject").textContent=`CW-${ticket.id} · ${titleCase(ticket.status)}`;button.querySelector(".ticket-snippet").textContent=ticket.snippet;button.querySelector(".ticket-context").textContent=[ticket.source==="WEB"?"Web":"Email",ticket.siteName].filter(Boolean).join(" · ");button.addEventListener("click",()=>openTicket(ticket.id));els.ticketList.appendChild(button);});}

async function openTicket(ticketId){selectedTicketId=ticketId;els.supportDetail.className="surface";els.supportDetail.innerHTML='<div class="muted">Loading…</div>';try{const data=await api("support_get",{ticketId});renderTicket(data.ticket,data.replies||[],data.customerContext||{});await loadSupport();}catch(error){els.supportDetail.textContent=error.message;}}

function renderTicket(ticket,replies,customerContext){els.supportDetail.innerHTML="";const head=document.createElement("div");head.className="panel-head";const title=document.createElement("div");const h=document.createElement("h2");h.textContent=`CW-${ticket.id} · ${ticket.subject}`;const p=document.createElement("p");p.textContent=`${ticket.fromName?ticket.fromName+" · ":""}${ticket.fromEmail}`;title.append(h,p);const controls=document.createElement("div");controls.style.display="flex";controls.style.flexWrap="wrap";controls.style.gap="7px";["NEW","OPEN","RESOLVED"].forEach(status=>{const b=document.createElement("button");b.type="button";b.className=`button small ${ticket.status===status?"primary":""}`;b.textContent=titleCase(status);b.addEventListener("click",()=>changeTicketStatus(ticket.id,status));controls.appendChild(b);});head.append(title,controls);els.supportDetail.appendChild(head);const context=document.createElement("div");context.className="support-context";context.textContent=[ticket.source==="WEB"?"Web request":"Email",ticket.siteName,ticket.machineId?`Machine ${ticket.machineId}`:"",ticket.sourceRoute].filter(Boolean).join(" · ");els.supportDetail.appendChild(context);els.supportDetail.appendChild(renderSupportCustomerContext(ticket,customerContext));
  const conversation=document.createElement("div");conversation.className="conversation";conversation.appendChild(makeBubble("Customer",ticket.receivedAt,ticket.body,false));replies.forEach(reply=>{const inbound=String(reply.direction||"").toUpperCase()==="INBOUND";conversation.appendChild(makeBubble(inbound?"Customer":"Support",reply.sentAt,reply.body,!inbound));});els.supportDetail.appendChild(conversation);
  const form=document.createElement("form");form.style.marginTop="14px";form.innerHTML='<div class="field"><label>Reply</label><textarea required placeholder="Write a clear reply…"></textarea></div><div style="display:flex;justify-content:flex-end;margin-top:9px"><button class="button primary" type="submit">Send reply</button></div><div class="message" aria-live="polite"></div>';form.addEventListener("submit",event=>sendSupportReply(event,ticket.id));els.supportDetail.appendChild(form);}

function renderSupportCustomerContext(ticket,context){
  const section=document.createElement("section");section.className="support-customer-data";const heading=document.createElement("div");heading.className="support-data-heading";const headingText=document.createElement("div");const title=document.createElement("h3");title.textContent="Customer context";const note=document.createElement("p");note.textContent="Private support data resolved from verified CircuitWash records. It is not shown on the customer form.";headingText.append(title,note);const match=document.createElement("span");match.className="pill";match.textContent=context.matchedBy?`Matched by ${String(context.matchedBy).toLowerCase().replaceAll("_"," ")}`:"Email context";heading.append(headingText,match);section.appendChild(heading);
  const grid=document.createElement("div");grid.className="support-data-grid";
  const accessCard=document.createElement("article");accessCard.className="support-data-card";const accessTitle=document.createElement("h4");accessTitle.textContent="Access & entitlement";accessCard.appendChild(accessTitle);const access=context.access;
  if(access){const codeRow=addSupportDataRow(accessCard,"Access code",access.maskedCode||"—",true);if(access.code){const reveal=document.createElement("button");reveal.type="button";reveal.className="support-reveal";reveal.textContent="Reveal";let revealed=false;reveal.addEventListener("click",()=>{revealed=!revealed;codeRow.value.textContent=revealed?access.code:access.maskedCode;reveal.textContent=revealed?"Hide":"Reveal";});codeRow.row.appendChild(reveal);}addSupportDataRow(accessCard,"Status",access.exists?(access.active?"Active":"Inactive"):"Not found");addSupportDataRow(accessCard,"Site",access.siteName||access.siteId||"Unknown");addSupportDataRow(accessCard,"This week",`${formatNumber(access.weeklyUsed)} used · ${formatNumber(access.weeklyRemaining)} remaining`);addSupportDataRow(accessCard,"Allowance",`${formatNumber(access.weeklyBaseLimit)} included${access.weeklyBonus?` + ${formatNumber(access.weeklyBonus)} add-on`:""}`);addSupportDataRow(accessCard,"Total uses",formatNumber(access.totalUsed));addSupportDataRow(accessCard,"Last used",access.lastUsedAt?formatDateTime(access.lastUsedAt):"Never");addSupportDataRow(accessCard,"Expires",access.expiresAt?formatDateTime(access.expiresAt):"No expiry");}else{const empty=document.createElement("p");empty.className="muted";empty.textContent="No verified access code was available on this device.";accessCard.appendChild(empty);}
  const accountCard=document.createElement("article");accountCard.className="support-data-card";const accountTitle=document.createElement("h4");accountTitle.textContent="Customer history";accountCard.appendChild(accountTitle);addSupportDataRow(accountCard,"Email",ticket.fromEmail||"—");addSupportDataRow(accountCard,"Orders",`${formatNumber(context.summary?.completedOrders||0)} completed · ${formatNumber(context.summary?.totalOrders||0)} total`);const revenue=(context.summary?.revenue||[]).map(item=>money(item.amount,item.currency)).join(" + ")||"£0.00";addSupportDataRow(accountCard,"Paid revenue",revenue);addSupportDataRow(accountCard,"Linked order",context.linkedOrderId||"No direct link",Boolean(context.linkedOrderId));
  const environmentCard=document.createElement("article");environmentCard.className="support-data-card";const environmentTitle=document.createElement("h4");environmentTitle.textContent="Request environment";environmentCard.appendChild(environmentTitle);addSupportDataRow(environmentCard,"Source",ticket.source==="WEB"?"Support form":"Email");addSupportDataRow(environmentCard,"Route",ticket.sourceRoute||"—",true);addSupportDataRow(environmentCard,"Machine",ticket.machineId||"Not captured");addSupportDataRow(environmentCard,"Session",ticket.sessionReference||"Not captured",Boolean(ticket.sessionReference));addSupportDataRow(environmentCard,"Browser/device",ticket.userAgent||"Not captured");grid.append(accessCard,accountCard,environmentCard);section.appendChild(grid);
  const orders=document.createElement("div");orders.className="support-order-history";const ordersHead=document.createElement("div");ordersHead.className="support-order-head";const ordersTitle=document.createElement("h4");ordersTitle.textContent="Matching orders";const ordersCount=document.createElement("span");ordersCount.textContent=`${formatNumber(context.orders?.length||0)} found`;ordersHead.append(ordersTitle,ordersCount);orders.appendChild(ordersHead);if(context.orders?.length){context.orders.forEach(order=>orders.appendChild(renderSupportOrder(order,context.linkedOrderId)));}else{const empty=document.createElement("p");empty.className="muted";empty.textContent="No canonical orders match this email or access context.";orders.appendChild(empty);}section.appendChild(orders);return section;
}

function addSupportDataRow(card,labelText,valueText,mono=false){const row=document.createElement("div");row.className="support-data-row";const label=document.createElement("span");label.textContent=labelText;const value=document.createElement("strong");if(mono)value.className="mono";value.textContent=valueText;row.append(label,value);card.appendChild(row);return{row,value};}

function renderSupportOrder(order,linkedOrderId){const item=document.createElement("details");item.className=`support-order ${order.orderId===linkedOrderId?"linked":""}`;const summary=document.createElement("summary");const main=document.createElement("span");const name=document.createElement("strong");name.textContent=orderTypeLabel(order.orderType,order.quantity);const meta=document.createElement("small");meta.textContent=`${order.siteName} · ${formatDateTime(order.purchasedAt)}`;main.append(name,meta);const amount=document.createElement("span");amount.className="support-order-amount";amount.textContent=`${money(order.amount,order.currency)} · ${titleCase(order.status)}`;summary.append(main,amount);const detail=document.createElement("div");detail.className="support-order-detail";addSupportDataRow(detail,"Order",order.orderId||"—",true);addSupportDataRow(detail,"Payment",titleCase(order.paymentMethod||"unknown"));addSupportDataRow(detail,"Provider reference",order.providerReference||"Not stored",true);addSupportDataRow(detail,"Access code",order.accessCodeMasked||"Not linked",true);item.append(summary,detail);return item;}

function makeBubble(label,date,body,isReply){const div=document.createElement("div");div.className=`bubble ${isReply?"reply":""}`;const meta=document.createElement("div");meta.className="bubble-meta";const a=document.createElement("span");a.textContent=label;const b=document.createElement("span");b.textContent=formatDateTime(date);meta.append(a,b);const content=document.createElement("div");content.className="bubble-body";content.textContent=body;div.append(meta,content);return div;}

async function sendSupportReply(event,ticketId){event.preventDefault();const form=event.currentTarget;const textarea=form.querySelector("textarea");const button=form.querySelector("button");const message=form.querySelector(".message");button.disabled=true;setMessage(message,"Sending…","");try{await api("support_reply",{ticketId,message:textarea.value});textarea.value="";setMessage(message,"Reply sent.","ok");await openTicket(ticketId);await loadDashboard();}catch(error){setMessage(message,error.message,"bad");}finally{button.disabled=false;}}

async function changeTicketStatus(ticketId,status){try{await api("support_status",{ticketId,status});await openTicket(ticketId);await loadDashboard();}catch(error){alert(error.message);}}

const SORT_ACCESSORS = {
  recentOrders: { date: item => dateValue(item.completedAt || item.createdAt), siteName: item => item.siteName, orderType: item => item.orderType, paymentMethod: item => item.paymentMethod, amount: item => Number(item.amount) || 0, emailStatus: item => item.emailStatus },
  orders: { date: item => dateValue(item.completedAt || item.createdAt), orderId: item => item.orderId, siteName: item => item.siteName, orderType: item => item.orderType, paymentMethod: item => item.paymentMethod, code: item => item.code, email: item => item.email, amount: item => Number(item.amount) || 0, status: item => item.status },
  codes: { createdAt: item => dateValue(item.createdAt), code: item => item.code, siteName: item => item.siteName, source: item => item.source, weeklyUses: item => Number(item.weeklyUses) || 0, weeklyLimit: item => Number(item.weeklyLimit) || 0, maxTotalUses: item => Number(item.maxTotalUses) || Number.MAX_SAFE_INTEGER, uses: item => Number(item.uses) || 0, lastUsedAt: item => dateValue(item.lastUsedAt), expiresAt: item => dateValue(item.expiresAt), active: item => item.active ? 1 : 0 },
  promos: { createdAt: item => dateValue(item.createdAt), code: item => item.code, discountValue: item => Number(item.discountValue) || 0, siteName: item => item.siteName || "", maxRedemptions: item => Number(item.maxRedemptions) || Number.MAX_SAFE_INTEGER, successfulOrders: item => Number(item.successfulOrders) || 0, createdOrders: item => Number(item.createdOrders) || 0, customers: item => Number(item.customers) || 0, discountTotal: item => Number(item.discountTotal) || 0, netRevenue: item => Number(item.netRevenue) || 0, lastUsedAt: item => dateValue(item.lastUsedAt), active: item => item.active ? 1 : 0 },
  feedbackResponses: { submittedAt: item => dateValue(item.submittedAt), email: item => item.email, siteName: item => item.siteName, rating: item => Number(item.rating) || 0, recommend: item => item.recommend, comments: item => item.comments },
  feedbackInvitations: { sentAt: item => dateValue(item.sentAt || item.createdAt), email: item => item.email, siteName: item => item.siteName, status: item => item.status, response: item => dateValue(item.respondedAt) || item.error || "" }
};

function dateValue(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function compareSortValues(a, b) {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function sortItems(tableName, items) {
  const state = sortState[tableName];
  const accessor = SORT_ACCESSORS[tableName]?.[state?.key];
  if (!state || !accessor) return [...items];
  const direction = state.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => compareSortValues(accessor(a), accessor(b)) * direction);
}

function initializeSortableHeaders() {
  document.querySelectorAll("th[data-sort-table][data-sort-key]").forEach((th) => {
    const tableName = th.dataset.sortTable;
    const key = th.dataset.sortKey;
    const label = th.textContent.trim();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sort-button";
    button.textContent = label;
    button.setAttribute("aria-label", `Sort by ${label}`);
    button.addEventListener("click", () => changeSort(tableName, key));
    th.textContent = "";
    th.appendChild(button);
  });
  updateSortHeaders();
}

function updateSortHeaders() {
  document.querySelectorAll("th[data-sort-table][data-sort-key]").forEach((th) => {
    const state = sortState[th.dataset.sortTable];
    const active = state && state.key === th.dataset.sortKey;
    th.setAttribute("aria-sort", active ? (state.direction === "asc" ? "ascending" : "descending") : "none");
  });
}

function changeSort(tableName, key) {
  const state = sortState[tableName] || { key, direction: "asc" };
  if (state.key === key) state.direction = state.direction === "asc" ? "desc" : "asc";
  else { state.key = key; state.direction = ["date", "createdAt", "submittedAt", "sentAt", "lastUsedAt", "expiresAt", "amount", "weeklyUses", "weeklyLimit", "uses", "rating"].includes(key) ? "desc" : "asc"; }
  sortState[tableName] = state;
  updateSortHeaders();
  if (tableName === "recentOrders") renderOrders(sortItems("recentOrders", dashboardData?.recentOrders || []), els.recentOrdersBody, true);
  else if (tableName === "orders") renderFilteredOrders();
  else if (tableName === "codes") renderCodes();
  else if (tableName === "promos") renderPromos();
  else if (tableName === "feedbackResponses") renderFeedbackResponses();
  else if (tableName === "feedbackInvitations") renderFeedbackInvitations();
}

function sortedSupportTickets() {
  const mode = els.supportSort?.value || "newest";
  const tickets = [...supportTicketsData];
  if (mode === "oldest") return tickets.sort((a,b)=>dateValue(a.lastActivityAt)-dateValue(b.lastActivityAt));
  if (mode === "unread") return tickets.sort((a,b)=>Number(Boolean(a.isRead))-Number(Boolean(b.isRead)) || dateValue(b.lastActivityAt)-dateValue(a.lastActivityAt));
  if (mode === "customer") return tickets.sort((a,b)=>String(a.fromName||a.fromEmail||"").localeCompare(String(b.fromName||b.fromEmail||""),undefined,{sensitivity:"base"}));
  if (mode === "status") return tickets.sort((a,b)=>String(a.status||"").localeCompare(String(b.status||""),undefined,{sensitivity:"base"}) || dateValue(b.lastActivityAt)-dateValue(a.lastActivityAt));
  return tickets.sort((a,b)=>dateValue(b.lastActivityAt)-dateValue(a.lastActivityAt));
}

function appendCell(row,value,className=""){const td=document.createElement("td");td.textContent=value??"";if(className)td.className=className;row.appendChild(td);}
function appendPillCell(row,value){const td=document.createElement("td");const span=document.createElement("span");const key=String(value||"").toLowerCase();span.className=`pill ${key}`;span.textContent=value||"—";td.appendChild(span);row.appendChild(td);}
function setMessage(element,text,tone){element.textContent=text;element.className=`message ${tone||""}`.trim();}
function formatNumber(value){return new Intl.NumberFormat().format(Number(value)||0);}
function money(value,currency="GBP"){return new Intl.NumberFormat("en-GB",{style:"currency",currency:currency||"GBP"}).format(Number(value)||0);}
function compactMoney(value,currency="GBP"){return new Intl.NumberFormat("en-GB",{style:"currency",currency:currency||"GBP",notation:"compact",maximumFractionDigits:1}).format(Number(value)||0);}
function formatDate(value){if(!value)return"—";return new Date(value).toLocaleDateString([], {day:"2-digit",month:"short",year:"numeric"});}
function formatDateTime(value){if(!value)return"—";return new Date(value).toLocaleString([], {day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});}
function shortHash(value){const hash=String(value||"").trim();return hash?`${hash.slice(0,12)}...`:"\u2014";}
function titleCase(value){return String(value||"").replace(/[_-]/g," ").replace(/\b\w/g,c=>c.toUpperCase());}
function orderTypeLabel(value,quantity){const type=String(value||"access_code").trim().toLowerCase();if(type==="weekly_activation_addon"){const count=Number(quantity)||0;return count>1?`Extra activations ×${count}`:"Extra activation";}if(type==="access_code")return"Access code";return titleCase(type);}
function paymentMethodLabel(value){
  const method=String(value||"").trim().toLowerCase();
  if(method==="card")return"Card";
  if(method==="applepay")return"Apple Pay";
  if(method==="googlepay")return"Google Pay";
  if(method==="stripe")return"Stripe";
  if(method==="paypal")return"PayPal";
  return titleCase(method||"Other");
}
function escapeHtml(value){return String(value||"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#039;",'"':"&quot;"})[char]);}

const OUTPUT_TIME_RANGES = {
  "24h": { label: "Past 24 hours", milliseconds: 24 * 60 * 60 * 1000 },
  "7d": { label: "Past 7 days", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  "30d": { label: "Past 30 days", milliseconds: 30 * 24 * 60 * 60 * 1000 },
  all: { label: "All time", milliseconds: 0 }
};

function markTimedOutput(element, value) {
  const timestamp = dateValue(value);
  if (element && timestamp > 0) element.dataset.outputTimestamp = String(timestamp);
}

function createOutputTimeFilter(container) {
  if (container.querySelector(":scope > .output-time-filter")) return;
  const toolbar = document.createElement("div");
  toolbar.className = "output-time-filter";
  const label = document.createElement("label");
  label.append(document.createTextNode("Time range"));
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Filter records by time range");
  Object.entries(OUTPUT_TIME_RANGES).forEach(([value, range]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = range.label;
    select.appendChild(option);
  });
  select.value = container.dataset.activeRange || container.dataset.defaultRange || "30d";
  container.dataset.activeRange = select.value;
  select.addEventListener("change", () => {
    container.dataset.activeRange = select.value;
    applyOutputTimeFilter(container);
  });
  const count = document.createElement("span");
  count.className = "output-time-count";
  count.setAttribute("aria-live", "polite");
  label.appendChild(select);
  toolbar.append(label, count);
  container.prepend(toolbar);
}

function applyOutputTimeFilter(container) {
  const rangeKey = container.dataset.activeRange || container.dataset.defaultRange || "30d";
  const range = OUTPUT_TIME_RANGES[rangeKey] || OUTPUT_TIME_RANGES["30d"];
  const cutoff = range.milliseconds ? Date.now() - range.milliseconds : 0;
  const records = [...container.querySelectorAll("[data-output-timestamp]")];
  let visible = 0;
  records.forEach((record) => {
    const timestamp = Number(record.dataset.outputTimestamp) || 0;
    const show = !cutoff || timestamp >= cutoff;
    record.hidden = !show;
    if (show) visible += 1;
  });
  const count = container.querySelector(":scope > .output-time-filter .output-time-count");
  const nextCount = records.length ? `${formatNumber(visible)} of ${formatNumber(records.length)} records` : "";
  if (count && count.textContent !== nextCount) count.textContent = nextCount;
}

function initializeTimedOutputs() {
  document.querySelectorAll("[data-timed-output]").forEach((container) => {
    if (!container.dataset.activeRange) container.dataset.activeRange = container.dataset.defaultRange || "30d";
    createOutputTimeFilter(container);
    applyOutputTimeFilter(container);
    if (container._timedOutputObserver) return;
    container._timedOutputObserver = new MutationObserver((mutations) => {
      const onlyToolbarChanges = mutations.every((mutation) => mutation.target instanceof Element && mutation.target.closest(".output-time-filter"));
      if (onlyToolbarChanges) return;
      createOutputTimeFilter(container);
      applyOutputTimeFilter(container);
    });
    container._timedOutputObserver.observe(container, { childList: true, subtree: true });
  });
}

window.markTimedOutput = markTimedOutput;

initializeSortableHeaders();
initializeTimedOutputs();

els.loginForm.addEventListener("submit",event=>{event.preventDefault();signIn(els.adminCodeInput.value);});
els.logoutBtn.addEventListener("click",()=>signOut()); els.refreshBtn.addEventListener("click",refreshActive); els.reloadAnalyticsBtn.addEventListener("click",loadAnalytics); els.reloadOrdersBtn.addEventListener("click",loadOrders); els.reloadCodesBtn.addEventListener("click",loadCodes); els.reloadPromosBtn.addEventListener("click",loadPromos); els.reloadFeedbackBtn.addEventListener("click",loadFeedback); els.reloadSupportBtn.addEventListener("click",loadSupport);
els.analyticsRange.addEventListener("change",loadAnalytics);
els.analyticsHitsPrev.addEventListener("click",()=>loadAnalyticsHitPage(analyticsHitPaging.history.at(-1) || null,"newer"));
els.analyticsHitsNext.addEventListener("click",()=>loadAnalyticsHitPage(analyticsHitPaging.nextCursor,"older"));
els.orderStatusFilter.addEventListener("change",()=>{setMessage(els.ordersMessage,"","");loadOrders();});
els.orderSearch.addEventListener("input",()=>{orderSearchTerm=els.orderSearch.value;renderFilteredOrders();});
els.clearOrderSearchBtn.addEventListener("click",()=>{els.orderSearch.value="";orderSearchTerm="";renderFilteredOrders();});
els.cleanupCreatedOrdersBtn.addEventListener("click",cleanupCreatedOrders);
els.supportSort.addEventListener("change",()=>renderTicketList(sortedSupportTickets()));
document.querySelectorAll(".nav button").forEach(button=>button.addEventListener("click",()=>openTab(button.dataset.tab)));
document.querySelectorAll("[data-open-tab]").forEach(button=>button.addEventListener("click",()=>{
  openTab(button.dataset.openTab);
  if (button.dataset.openDrawerAfter) openControlDrawer(button.dataset.openDrawerAfter);
}));
document.querySelectorAll("[data-drawer-open]").forEach(button=>button.addEventListener("click",()=>openControlDrawer(button.dataset.drawerOpen)));
document.querySelectorAll("[data-drawer-close]").forEach(button=>button.addEventListener("click",closeControlDrawer));
$("drawerBackdrop")?.addEventListener("click",closeControlDrawer);
els.adminSiteSearch.addEventListener("input",()=>{selectedSite=null;els.selectedAdminSite.classList.add("hidden");clearTimeout(siteSearchTimer);siteSearchTimer=setTimeout(searchAdminSites,230);});
els.siteSearchMode.addEventListener("change",()=>{els.adminSiteSearch.value="";selectedSite=null;els.selectedAdminSite.classList.add("hidden");els.siteResults.classList.add("hidden");});
els.generateCodeBtn.addEventListener("click",generateLocalCode); els.createCodeBtn.addEventListener("click",createCode);
els.codeFilter.addEventListener("input",()=>{clearTimeout(codeFilterTimer);codeFilterTimer=setTimeout(loadCodes,260);});
els.newPromoCode.addEventListener("input",()=>{els.newPromoCode.value=sanitizePromoInput(els.newPromoCode.value);});
els.promoSiteSearch.addEventListener("input",()=>{clearTimeout(promoSiteSearchTimer);promoSiteSearchTimer=setTimeout(searchPromoSites,230);});
els.promoFreeSite.addEventListener("change",()=>{if(els.promoFreeSite.checked){els.promoDiscountType.value="percent";els.promoDiscountValue.value="100";els.promoOneTimeAccess.checked=true;}});
els.promoOneTimeUse.addEventListener("change",()=>{if(els.promoOneTimeUse.checked)els.promoMaxRedemptions.value="1";});
els.promoEditOneTimeUse.addEventListener("change",()=>{if(els.promoEditOneTimeUse.checked)els.promoEditMaxRedemptions.value="1";});
els.createPromoBtn.addEventListener("click",createPromo);
els.closePromoEditBtn.addEventListener("click",closePromoEditor);
els.cancelPromoEditBtn.addEventListener("click",closePromoEditor);
els.savePromoEditBtn.addEventListener("click",savePromo);
els.promoEditOverlay.addEventListener("click",(event)=>{if(event.target===els.promoEditOverlay)closePromoEditor();});
els.promoEditDiscountValue.addEventListener("keydown",(event)=>{if(event.key==="Enter"){event.preventDefault();savePromo();}});
els.promoFilter.addEventListener("input",()=>{els.promoFilter.value=sanitizePromoInput(els.promoFilter.value);clearTimeout(promoFilterTimer);promoFilterTimer=setTimeout(loadPromoCodes,260);});
els.freeTrialEnabledInput.addEventListener("change",saveFreeTrialEnabled);
els.reloadFreeTrialsBtn.addEventListener("click",loadFreeTrials);
els.trialLimitSiteSearch.addEventListener("input",()=>{clearTimeout(trialLimitSiteSearchTimer);trialLimitSiteSearchTimer=setTimeout(searchTrialLimitSites,230);});
els.saveTrialLimitBtn.addEventListener("click",saveTrialSiteLimit);
els.clearTrialLimitBtn.addEventListener("click",()=>clearTrialSiteLimit());
els.feedbackRecipientFilter.addEventListener("input",()=>{feedbackRecipientFilter=els.feedbackRecipientFilter.value;renderFeedbackRecipients();});
els.feedbackEnabledInput.addEventListener("change",saveFeedbackEnabled);
els.feedbackManualEmails.addEventListener("input",updateFeedbackSelectionCount);
els.selectVisibleRecipientsBtn.addEventListener("click",selectVisibleFeedbackRecipients); els.clearRecipientsBtn.addEventListener("click",clearFeedbackRecipients); els.sendFeedbackBtn.addEventListener("click",sendFeedbackRequests);
document.querySelectorAll("[data-support-filter]").forEach(button=>button.addEventListener("click",()=>{supportFilter=button.dataset.supportFilter;document.querySelectorAll("[data-support-filter]").forEach(item=>item.classList.toggle("active",item===button));loadSupport();}));
els.supportSearch?.addEventListener("input",()=>{clearTimeout(supportSearchTimer);supportSearchTimer=setTimeout(loadSupport,220);});
document.querySelector(".dashboard-trend")?.addEventListener("toggle",(event)=>{if(event.currentTarget.open&&dashboardData)requestAnimationFrame(()=>drawTrend(dashboardData.daily||[],dashboardData.summary?.currency||"GBP"));});
window.addEventListener("hashchange",()=>{const tab=location.hash.replace(/^#/,"");if(adminCode&&tab&&tab!==activeTab&&$(`tab-${tab}`))openTab(tab);});
window.addEventListener("keydown",(event)=>{if(event.key!=="Escape")return;if(!els.promoEditOverlay.classList.contains("hidden"))closePromoEditor();else closeControlDrawer();});
window.addEventListener("resize",()=>{if(dashboardData&&!$("tab-dashboard").classList.contains("hidden"))drawTrend(dashboardData.daily||[],dashboardData.summary?.currency||"GBP");});

try { els.staySignedInInput.checked = Boolean(localStorage.getItem(SESSION_KEY)); } catch (_) {}
if(adminCode) signIn(adminCode); else setTimeout(()=>els.adminCodeInput.focus(),0);
