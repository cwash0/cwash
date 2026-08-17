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
let supportFilter = "ALL";
let selectedTicketId = null;
let feedbackData = null;
let feedbackRecipientFilter = "";
let ordersData = [];
let orderSearchTerm = "";
let codesData = [];
let promosData = [];
let analyticsData = null;
let editingPromo = null;
let promoFilterTimer = null;
let promoSiteSearchTimer = null;
let trialLimitSiteSearchTimer = null;
let supportTicketsData = [];
let storeData = null;
let selectedStoreCustomerCode = "";
let storeCustomerFilter = "";
let editingStoreProductId = null;
let activeDrawer = null;
const selectedFeedbackEmails = new Set();
const sortState = {
  recentOrders: { key: "date", direction: "desc" },
  orders: { key: "date", direction: "desc" },
  codes: { key: "createdAt", direction: "desc" },
  promos: { key: "createdAt", direction: "desc" },
  analyticsHits: { key: "createdAt", direction: "desc" },
  feedbackResponses: { key: "submittedAt", direction: "desc" },
  feedbackInvitations: { key: "sentAt", direction: "desc" }
};

const $ = (id) => document.getElementById(id);
const els = {
  loginOverlay: $("loginOverlay"), loginForm: $("loginForm"), adminCodeInput: $("adminCodeInput"), staySignedInInput: $("staySignedInInput"), loginMessage: $("loginMessage"), app: $("app"),
  refreshBtn: $("refreshBtn"), logoutBtn: $("logoutBtn"), lastUpdated: $("lastUpdated"), commandHealthText: $("commandHealthText"),
  navOrdersBadge: $("navOrdersBadge"), navStoreBadge: $("navStoreBadge"), navSupportBadge: $("navSupportBadge"),
  metricRevenue: $("metricRevenue"), metricRevenueSub: $("metricRevenueSub"), metricOrders: $("metricOrders"), metricOrdersSub: $("metricOrdersSub"),
  metricActivations: $("metricActivations"), metricSupport: $("metricSupport"), metricSupportSub: $("metricSupportSub"), trendChart: $("trendChart"),
  recentOrdersBody: $("recentOrdersBody"), methodBreakdown: $("methodBreakdown"), topSites: $("topSites"), emailDelivery: $("emailDelivery"),
  reloadAnalyticsBtn: $("reloadAnalyticsBtn"), analyticsTodayMetric: $("analyticsTodayMetric"), analyticsWeekMetric: $("analyticsWeekMetric"), analyticsNoOrderMetric: $("analyticsNoOrderMetric"), analyticsUniqueMetric: $("analyticsUniqueMetric"), analyticsRejectedAdminMetric: $("analyticsRejectedAdminMetric"), analyticsBotSub: $("analyticsBotSub"), analyticsTopSites: $("analyticsTopSites"), analyticsSearchModes: $("analyticsSearchModes"), analyticsReferrers: $("analyticsReferrers"), analyticsHitsBody: $("analyticsHitsBody"), adminLoginAttemptsBody: $("adminLoginAttemptsBody"),
  ordersBody: $("ordersBody"), reloadOrdersBtn: $("reloadOrdersBtn"), orderStatusFilter: $("orderStatusFilter"), orderSearch: $("orderSearch"), clearOrderSearchBtn: $("clearOrderSearchBtn"), ordersSummary: $("ordersSummary"), cleanupCreatedHours: $("cleanupCreatedHours"), cleanupCreatedOrdersBtn: $("cleanupCreatedOrdersBtn"), ordersMessage: $("ordersMessage"), siteSearchMode: $("siteSearchMode"), adminSiteSearch: $("adminSiteSearch"),
  siteResults: $("siteResults"), selectedAdminSite: $("selectedAdminSite"), newCode: $("newCode"), newCodeWeeklyLimit: $("newCodeWeeklyLimit"), generateCodeBtn: $("generateCodeBtn"), createCodeBtn: $("createCodeBtn"),
  codeCreateMessage: $("codeCreateMessage"), codeFilter: $("codeFilter"), reloadCodesBtn: $("reloadCodesBtn"), codesBody: $("codesBody"),
  newPromoCode: $("newPromoCode"), promoDiscountType: $("promoDiscountType"), promoDiscountValue: $("promoDiscountValue"), promoMaxRedemptions: $("promoMaxRedemptions"), promoSiteSearch: $("promoSiteSearch"), promoSiteResults: $("promoSiteResults"), selectedPromoSite: $("selectedPromoSite"), promoFreeSite: $("promoFreeSite"), promoOneTimeUse: $("promoOneTimeUse"), promoOneTimeAccess: $("promoOneTimeAccess"), createPromoBtn: $("createPromoBtn"), promoCreateMessage: $("promoCreateMessage"), promoFilter: $("promoFilter"), reloadPromosBtn: $("reloadPromosBtn"), promosBody: $("promosBody"),
  freeTrialEnabledInput: $("freeTrialEnabledInput"), freeTrialEnabledStatus: $("freeTrialEnabledStatus"), freeTrialIssuedMetric: $("freeTrialIssuedMetric"), freeTrialActivatedMetric: $("freeTrialActivatedMetric"), freeTrialWaitingMetric: $("freeTrialWaitingMetric"), freeTrialRateMetric: $("freeTrialRateMetric"), freeTrialRows: $("freeTrialRows"), reloadFreeTrialsBtn: $("reloadFreeTrialsBtn"), freeTrialMessage: $("freeTrialMessage"), trialLimitSiteSearch: $("trialLimitSiteSearch"), trialLimitSiteResults: $("trialLimitSiteResults"), selectedTrialLimitSite: $("selectedTrialLimitSite"), trialWeeklyLimitInput: $("trialWeeklyLimitInput"), saveTrialLimitBtn: $("saveTrialLimitBtn"), clearTrialLimitBtn: $("clearTrialLimitBtn"), freeTrialLimitRows: $("freeTrialLimitRows"),
  promoEditOverlay: $("promoEditOverlay"), promoEditCode: $("promoEditCode"), promoEditDiscountType: $("promoEditDiscountType"), promoEditDiscountValue: $("promoEditDiscountValue"), promoEditMaxRedemptions: $("promoEditMaxRedemptions"), promoEditOneTimeUse: $("promoEditOneTimeUse"), promoEditOneTimeAccess: $("promoEditOneTimeAccess"), promoEditMessage: $("promoEditMessage"), closePromoEditBtn: $("closePromoEditBtn"), cancelPromoEditBtn: $("cancelPromoEditBtn"), savePromoEditBtn: $("savePromoEditBtn"),
  reloadStoreBtn: $("reloadStoreBtn"), storeMembersMetric: $("storeMembersMetric"), storeMembersSub: $("storeMembersSub"), storeProductsMetric: $("storeProductsMetric"), storeRevenueMetric: $("storeRevenueMetric"), storeRevenueSub: $("storeRevenueSub"), storeFulfilmentMetric: $("storeFulfilmentMetric"),
  storeEligibleCustomerCount: $("storeEligibleCustomerCount"), storeCustomerListCount: $("storeCustomerListCount"), storeCustomerFilter: $("storeCustomerFilter"), storeClearCustomerFilterBtn: $("storeClearCustomerFilterBtn"), storeCustomerList: $("storeCustomerList"), storeSelectedCustomer: $("storeSelectedCustomer"), storeInviteDelivery: $("storeInviteDelivery"), storeInviteDeliveryOptions: $("storeInviteDeliveryOptions"), storeMemberInviteLimit: $("storeMemberInviteLimit"), createStoreMemberBtn: $("createStoreMemberBtn"), storeMemberResult: $("storeMemberResult"), storeMemberMessage: $("storeMemberMessage"), storeMembersBody: $("storeMembersBody"),
  storeProductFormTitle: $("storeProductFormTitle"), storeProductName: $("storeProductName"), storeProductPrice: $("storeProductPrice"), storeProductDescription: $("storeProductDescription"), storeProductImageUrl: $("storeProductImageUrl"), storeProductSortOrder: $("storeProductSortOrder"), storeProductImagePreview: $("storeProductImagePreview"), storeProductActive: $("storeProductActive"), cancelStoreProductEditBtn: $("cancelStoreProductEditBtn"), saveStoreProductBtn: $("saveStoreProductBtn"), storeProductMessage: $("storeProductMessage"), storeProductList: $("storeProductList"), storeCleanupStaleOrdersBtn: $("storeCleanupStaleOrdersBtn"), storeCleanupMessage: $("storeCleanupMessage"), storeOrdersList: $("storeOrdersList"),
  reloadFeedbackBtn: $("reloadFeedbackBtn"), feedbackEnabledInput: $("feedbackEnabledInput"), feedbackEnabledStatus: $("feedbackEnabledStatus"), feedbackManualEmails: $("feedbackManualEmails"), feedbackRecipientFilter: $("feedbackRecipientFilter"), feedbackRecipientList: $("feedbackRecipientList"),
  selectVisibleRecipientsBtn: $("selectVisibleRecipientsBtn"), clearRecipientsBtn: $("clearRecipientsBtn"), feedbackSelectionCount: $("feedbackSelectionCount"), sendFeedbackBtn: $("sendFeedbackBtn"), feedbackSendMessage: $("feedbackSendMessage"),
  feedbackResponsesMetric: $("feedbackResponsesMetric"), feedbackResponseRate: $("feedbackResponseRate"), feedbackRatingMetric: $("feedbackRatingMetric"), feedbackRecommendMetric: $("feedbackRecommendMetric"), feedbackInvitesMetric: $("feedbackInvitesMetric"), feedbackInvitesSub: $("feedbackInvitesSub"), feedbackDistribution: $("feedbackDistribution"), feedbackResponsesBody: $("feedbackResponsesBody"), feedbackInvitationsBody: $("feedbackInvitationsBody"),
  reloadSupportBtn: $("reloadSupportBtn"), supportSort: $("supportSort"), ticketList: $("ticketList"), supportDetail: $("supportDetail")
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
  store: "operations",
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
  if (tab === "store") loadStore();
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
  else if (activeTab === "store") await loadStore();
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
  renderBreakdown(els.topSites, data.sites || [], "siteName", "orders");
  renderEmailDelivery(s);
  drawTrend(data.daily || [], s.currency || "GBP");
}

function renderCommandStatus(data) {
  const operations = data.operations || {};
  const supportUnread = Number(data.support?.unread) || 0;
  const pendingFulfilment = Number(operations.pendingFulfilment) || 0;
  const staleOrders = Number(operations.staleCreatedOrders) || 0;
  const failedEmails = Number(operations.recentEmailFailures) || 0;
  const activeIssues = supportUnread + pendingFulfilment + staleOrders + failedEmails;

  els.commandHealthText.textContent = activeIssues
    ? `${formatNumber(activeIssues)} item${activeIssues === 1 ? "" : "s"} need attention`
    : "Operations are clear";
  els.commandHealthText.closest(".command-status")?.classList.toggle("attention", activeIssues > 0);
  setNavBadge(els.navOrdersBadge, staleOrders + pendingFulfilment);
  setNavBadge(els.navStoreBadge, pendingFulfilment);
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

async function loadAnalytics() {
  els.analyticsHitsBody.innerHTML = '<tr><td colspan="5" class="muted">Loading...</td></tr>';
  els.adminLoginAttemptsBody.innerHTML = '<tr><td colspan="3" class="muted">Loading...</td></tr>';
  try {
    analyticsData = await api("analytics", { limit: 150 });
    renderAnalytics(analyticsData);
  } catch (error) {
    els.analyticsHitsBody.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(error.message)}</td></tr>`;
    els.adminLoginAttemptsBody.innerHTML = `<tr><td colspan="3" class="muted">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderAnalytics(data) {
  const s = data.summary || {};
  els.analyticsTodayMetric.textContent = formatNumber(s.todayHits);
  els.analyticsWeekMetric.textContent = formatNumber(s.sevenDayHits);
  els.analyticsNoOrderMetric.textContent = formatNumber(s.noOrderEstimate);
  els.analyticsUniqueMetric.textContent = formatNumber(s.uniqueVisitors);
  els.analyticsRejectedAdminMetric.textContent = formatNumber(s.rejectedAdminLogins);
  els.analyticsBotSub.textContent = `${formatNumber(s.thirtyDayHits)} hits in 30 days · ${formatNumber(s.botHits)} filtered bots`;
  renderBreakdown(els.analyticsTopSites, data.topSites || [], "siteName", "hits");
  renderBreakdown(els.analyticsSearchModes, data.modes || [], "mode", "hits");
  renderBreakdown(els.analyticsReferrers, data.referrers || [], "referrer", "hits");
  renderAnalyticsHits(sortItems("analyticsHits", data.recentHits || []));
  renderAdminLoginAttempts(data.adminLoginAttempts || []);
}

function renderAnalyticsHits(hits) {
  els.analyticsHitsBody.innerHTML = "";
  if (!hits.length) {
    els.analyticsHitsBody.innerHTML = '<tr><td colspan="5" class="muted">No tracked site selections yet.</td></tr>';
    return;
  }
  hits.forEach((hit) => {
    const tr = document.createElement("tr");
    markTimedOutput(tr, hit.createdAt);
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
  els.ordersBody.innerHTML = '<tr><td colspan="8" class="muted">Loading…</td></tr>';
  try { const data = await api("orders", { limit: 200, status: els.orderStatusFilter.value }); ordersData = data.orders || []; renderFilteredOrders(); }
  catch (error) { els.ordersBody.innerHTML = `<tr><td colspan="8" class="muted">${escapeHtml(error.message)}</td></tr>`; }
}

function filteredOrders() {
  const term = orderSearchTerm.trim().toLowerCase();
  if (!term) return [...ordersData];
  return ordersData.filter((order) => [
    order.orderId,
    order.siteName,
    order.siteId,
    order.paymentMethod,
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
  if (!orders.length) { tbody.innerHTML = `<tr><td colspan="${compact ? 5 : 8}" class="muted">No orders yet.</td></tr>`; return; }
  orders.forEach((order) => {
    const tr = document.createElement("tr");
    markTimedOutput(tr, order.completedAt || order.createdAt);
    if (compact) {
      appendCell(tr, formatDate(order.completedAt || order.createdAt)); appendCell(tr, order.siteName); appendCell(tr, paymentMethodLabel(order.paymentMethod)); appendCell(tr, money(order.amount, order.currency)); appendPillCell(tr, order.emailStatus || "—");
    } else {
      appendCell(tr, formatDateTime(order.completedAt || order.createdAt)); appendCell(tr, order.orderId, "mono"); appendCell(tr, order.siteName); appendCell(tr, paymentMethodLabel(order.paymentMethod)); appendCell(tr, order.code || "—", "mono"); appendCell(tr, order.email || "—"); appendCell(tr, money(order.amount, order.currency)); appendPillCell(tr, order.status);
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

async function loadStore() {
  if (!els.storeProductList) return;
  els.storeProductList.innerHTML = '<div class="muted">Loading products...</div>';
  els.storeOrdersList.innerHTML = '<div class="muted">Loading orders...</div>';
  try {
    storeData = await api("store_data");
    renderStoreAdmin();
  } catch (error) {
    els.storeProductList.innerHTML = `<div class="message bad">${escapeHtml(error.message)}</div>`;
    els.storeOrdersList.innerHTML = "";
  }
}

function updateStoreInviteDelivery() {
  const customer = selectedStoreCustomer();
  const hasEmail = Boolean(customer?.email);
  if (!hasEmail) els.storeInviteDelivery.value = "POPUP";
  els.storeInviteDeliveryOptions.querySelectorAll('input[name="storeInviteDeliveryChoice"]').forEach((input) => {
    input.disabled = !customer || (!hasEmail && input.value !== "POPUP");
    input.checked = input.value === els.storeInviteDelivery.value;
    input.closest("label")?.setAttribute("aria-disabled", String(input.disabled));
  });
  els.createStoreMemberBtn.disabled = !customer;
  els.createStoreMemberBtn.textContent = customer ? "Create member invitation" : "Select a customer to continue";
  renderSelectedStoreCustomer(customer);
}

function renderStoreAdmin() {
  const summary = storeData?.summary || {};
  els.storeMembersMetric.textContent = formatNumber(summary.activeMembers);
  els.storeMembersSub.textContent = `${formatNumber(summary.memberInvites)} member-generated invitations`;
  els.storeProductsMetric.textContent = formatNumber(summary.activeProducts);
  els.storeRevenueMetric.textContent = money(summary.revenue, summary.currency);
  els.storeRevenueSub.textContent = `${formatNumber(summary.completedOrders)} completed orders`;
  els.storeFulfilmentMetric.textContent = formatNumber(summary.pendingFulfilment);
  els.storeEligibleCustomerCount.textContent = formatNumber(storeInviteCustomers().length);
  if (!storeInviteCustomers().some((customer) => customer.code === selectedStoreCustomerCode)) selectedStoreCustomerCode = "";
  renderStoreInviteCustomers();
  renderStoreMembers();
  renderStoreProducts();
  renderStoreOrders();
}

function storeInviteCustomers() {
  return storeData?.inviteCustomers || [];
}

function selectedStoreCustomer() {
  return storeInviteCustomers().find((customer) => customer.code === selectedStoreCustomerCode) || null;
}

function visibleStoreInviteCustomers() {
  const term = storeCustomerFilter.trim().toLowerCase();
  return storeInviteCustomers().filter((customer) => !term || `${customer.email} ${customer.code} ${customer.siteName}`.toLowerCase().includes(term));
}

function storeCustomerInitials(customer = {}) {
  const source = String(customer.email || customer.siteName || customer.code || "?").split("@")[0];
  const parts = source.replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)).toUpperCase() || "?";
}

function renderSelectedStoreCustomer(customer) {
  els.storeSelectedCustomer.innerHTML = "";
  els.storeSelectedCustomer.classList.toggle("empty", !customer);

  const avatar = document.createElement("div");
  avatar.className = "store-customer-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = customer ? storeCustomerInitials(customer) : "?";

  const copy = document.createElement("div");
  copy.className = "store-selected-copy";
  const eyebrow = document.createElement("span");
  eyebrow.textContent = "Selected customer";
  const title = document.createElement("strong");
  title.textContent = customer ? (customer.email || customer.siteName || customer.code) : "Choose someone from the list";
  const meta = document.createElement("small");
  meta.textContent = customer
    ? [customer.code, customer.siteName, customer.email ? "Email available" : "No email on file"].filter(Boolean).join(" · ")
    : "Their access details will appear here.";
  copy.append(eyebrow, title, meta);
  els.storeSelectedCustomer.append(avatar, copy);

  if (customer) {
    const status = document.createElement("span");
    status.className = "store-selected-status";
    status.textContent = customer.email ? "Email ready" : "Popup only";
    els.storeSelectedCustomer.appendChild(status);
  }
}

function renderStoreInviteCustomers() {
  const customers = visibleStoreInviteCustomers();
  const total = storeInviteCustomers().length;
  els.storeCustomerList.innerHTML = "";
  els.storeCustomerListCount.textContent = storeCustomerFilter
    ? `${formatNumber(customers.length)} of ${formatNumber(total)}`
    : `${formatNumber(total)} available`;
  els.storeClearCustomerFilterBtn.classList.toggle("hidden", !storeCustomerFilter);
  if (!customers.length) {
    const empty = document.createElement("div");
    empty.className = "store-empty";
    empty.textContent = storeInviteCustomers().length ? "No matching customers." : "No eligible customers found.";
    els.storeCustomerList.appendChild(empty);
    updateStoreInviteDelivery();
    return;
  }
  customers.forEach((customer) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `store-customer-row${customer.code === selectedStoreCustomerCode ? " active" : ""}`;
    button.setAttribute("aria-pressed", String(customer.code === selectedStoreCustomerCode));
    const avatar = document.createElement("div");
    avatar.className = "store-customer-row-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = storeCustomerInitials(customer);
    const main = document.createElement("div");
    main.className = "store-customer-row-main";
    const label = document.createElement("strong");
    label.textContent = customer.email || "No email on file";
    const meta = document.createElement("span");
    meta.textContent = customer.siteName || "Site unavailable";
    main.append(label, meta);
    const side = document.createElement("div");
    side.className = "store-customer-row-side";
    const code = document.createElement("span");
    code.className = "store-customer-code";
    code.textContent = customer.code;
    const delivery = document.createElement("div");
    delivery.className = "store-customer-delivery";
    delivery.textContent = customer.email ? "Email or popup" : "Popup only";
    side.append(code, delivery);
    button.append(avatar, main, side);
    button.addEventListener("click", () => {
      selectedStoreCustomerCode = customer.code;
      els.storeInviteDelivery.value = customer.email ? "EMAIL" : "POPUP";
      els.storeMemberResult.classList.add("hidden");
      setMessage(els.storeMemberMessage, "", "");
      renderStoreInviteCustomers();
    });
    els.storeCustomerList.appendChild(button);
  });
  updateStoreInviteDelivery();
}

async function createStoreMember() {
  const customer = selectedStoreCustomer();
  if (!customer) return setMessage(els.storeMemberMessage, "Select a customer first.", "bad");
  const delivery = els.storeInviteDelivery.value;
  if ((delivery === "EMAIL" || delivery === "BOTH") && !customer.email) {
    return setMessage(els.storeMemberMessage, "This customer has no email on file. Choose laundry login popup.", "bad");
  }
  els.createStoreMemberBtn.disabled = true;
  setMessage(els.storeMemberMessage, "Creating invitation...", "");
  try {
    const result = await api("store_create_member", {
      inviteLimit: els.storeMemberInviteLimit.value,
      delivery,
      laundryAccessCode: customer.code
    });
    selectedStoreCustomerCode = "";
    renderStoreMemberResult(result);
    const note = result.emailStatus === "SENT" && result.popupEnabled
      ? "Invitation created for email and the login popup."
      : result.emailStatus === "SENT"
        ? "Invitation created and emailed."
        : result.popupEnabled
          ? "Invitation created for the customer's next laundry login."
      : result.emailStatus === "FAILED"
        ? "Invitation created, but the email failed. Share the link below."
        : "Invitation created. Share the link below.";
    setMessage(els.storeMemberMessage, note, result.emailStatus === "FAILED" ? "bad" : "ok");
    await loadStore();
  } catch (error) {
    setMessage(els.storeMemberMessage, error.message, "bad");
  } finally {
    updateStoreInviteDelivery();
  }
}

function renderStoreMemberResult(result) {
  els.storeMemberResult.innerHTML = "";
  const code = document.createElement("strong");
  code.className = "mono";
  code.textContent = result.code;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "button small";
  copy.textContent = "Copy access link";
  copy.addEventListener("click", async () => {
    await copyText(result.link);
    copy.textContent = "Copied";
  });
  els.storeMemberResult.append(code, copy);
  els.storeMemberResult.classList.remove("hidden");
}

function renderStoreMembers() {
  const members = storeData?.members || [];
  els.storeMembersBody.innerHTML = "";
  if (!members.length) {
    els.storeMembersBody.innerHTML = '<tr><td colspan="9" class="muted">No store members yet.</td></tr>';
    return;
  }
  members.forEach((member) => {
    const tr = document.createElement("tr");
    const customer = document.createElement("td");
    const email = document.createElement("strong");
    email.textContent = member.email || "Shareable code";
    const source = document.createElement("span");
    source.className = "store-cell-sub";
    source.textContent = member.source === "ADMIN"
      ? `Admin invite - ${titleCase(member.delivery || "email")}`
      : "Member invite";
    customer.append(email, source);
    tr.appendChild(customer);
    appendCell(tr, member.code, "mono");
    appendCell(tr, member.inviterEmail || member.inviterCode || "-");

    const inviteCell = document.createElement("td");
    const inviteLabel = document.createElement("strong");
    inviteLabel.textContent = `${member.invitesRemaining} of ${member.inviteLimit} left`;
    const usage = document.createElement("span");
    usage.className = "store-cell-sub";
    usage.textContent = `${member.inviteCount} created`;
    inviteCell.append(inviteLabel, usage);
    tr.appendChild(inviteCell);
    appendCell(tr, member.completedOrders);
    appendCell(tr, money(member.creditBalance || 0, "GBP"));
    appendCell(tr, formatDateTime(member.lastUsedAt));
    appendPillCell(tr, member.active ? "Active" : "Inactive");

    const actions = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "row-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "button small";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      await copyText(`${location.origin}/store.html?code=${encodeURIComponent(member.code)}`);
      copy.textContent = "Copied";
    });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = `button small ${member.active ? "danger" : "primary"}`;
    toggle.textContent = member.active ? "Disable" : "Enable";
    toggle.addEventListener("click", () => toggleStoreMember(member, toggle));
    wrap.append(copy, toggle);
    actions.appendChild(wrap);
    tr.appendChild(actions);
    els.storeMembersBody.appendChild(tr);
  });
}

async function saveStoreMemberInviteLimit(memberId, input, button) {
  button.disabled = true;
  try {
    await api("store_set_member_invite_limit", { memberId, inviteLimit: input.value });
    button.textContent = "Saved";
    await loadStore();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
}

async function toggleStoreMember(member, button) {
  button.disabled = true;
  try {
    await api("store_set_member_active", { memberId: member.id, active: !member.active });
    await loadStore();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
}

function renderStoreProducts() {
  const products = storeData?.products || [];
  els.storeProductList.innerHTML = "";
  if (!products.length) {
    els.storeProductList.innerHTML = '<div class="store-empty">No products yet.</div>';
    return;
  }
  products.forEach((product) => {
    const row = document.createElement("article");
    row.className = "store-product-row";
    const image = document.createElement("div");
    image.className = "store-product-thumb";
    if (product.imageUrl) {
      const img = document.createElement("img");
      img.src = product.imageUrl;
      img.alt = "";
      img.addEventListener("error", () => { img.remove(); image.textContent = "No image"; });
      image.appendChild(img);
    } else image.textContent = "No image";
    const copy = document.createElement("div");
    copy.className = "store-product-copy";
    const title = document.createElement("strong");
    title.textContent = product.name;
    const description = document.createElement("span");
    description.textContent = product.description || "No description";
    copy.append(title, description);
    const meta = document.createElement("div");
    meta.className = "store-product-meta";
    const price = document.createElement("strong");
    price.textContent = money(product.price, product.currency);
    const order = document.createElement("span");
    order.textContent = `Order ${product.sortOrder}`;
    meta.append(price, order);
    const status = document.createElement("span");
    status.className = `pill ${product.active ? "active" : "inactive"}`;
    status.textContent = product.active ? "Active" : "Hidden";
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "button small";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => editStoreProduct(product));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button small danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteStoreProduct(product, remove));
    actions.append(edit, remove);
    row.append(image, copy, meta, status, actions);
    els.storeProductList.appendChild(row);
  });
}

function editStoreProduct(product) {
  editingStoreProductId = product.id;
  els.storeProductFormTitle.textContent = "Edit product";
  els.storeProductName.value = product.name;
  els.storeProductPrice.value = product.price;
  els.storeProductDescription.value = product.description;
  els.storeProductImageUrl.value = product.imageUrl;
  els.storeProductSortOrder.value = product.sortOrder;
  els.storeProductActive.checked = product.active;
  els.saveStoreProductBtn.textContent = "Save product";
  els.cancelStoreProductEditBtn.classList.remove("hidden");
  updateStoreImagePreview();
  openControlDrawer("storeProductDrawer");
}

function resetStoreProductForm() {
  editingStoreProductId = null;
  els.storeProductFormTitle.textContent = "Add product";
  els.storeProductName.value = "";
  els.storeProductPrice.value = "";
  els.storeProductDescription.value = "";
  els.storeProductImageUrl.value = "";
  els.storeProductSortOrder.value = "0";
  els.storeProductActive.checked = true;
  els.saveStoreProductBtn.textContent = "Add product";
  els.cancelStoreProductEditBtn.classList.add("hidden");
  els.storeProductImagePreview.classList.add("hidden");
  setMessage(els.storeProductMessage, "", "");
}

async function saveStoreProduct() {
  const payload = {
    productId: editingStoreProductId,
    name: els.storeProductName.value,
    price: els.storeProductPrice.value,
    description: els.storeProductDescription.value,
    imageUrl: els.storeProductImageUrl.value,
    sortOrder: els.storeProductSortOrder.value,
    active: els.storeProductActive.checked
  };
  els.saveStoreProductBtn.disabled = true;
  setMessage(els.storeProductMessage, editingStoreProductId ? "Saving product..." : "Adding product...", "");
  try {
    await api(editingStoreProductId ? "store_update_product" : "store_create_product", payload);
    resetStoreProductForm();
    await loadStore();
  } catch (error) {
    setMessage(els.storeProductMessage, error.message, "bad");
  } finally {
    els.saveStoreProductBtn.disabled = false;
  }
}

async function deleteStoreProduct(product, button) {
  if (!window.confirm(`Delete ${product.name}? Existing orders will keep their product details.`)) return;
  button.disabled = true;
  try {
    await api("store_delete_product", { productId: product.id });
    if (editingStoreProductId === product.id) resetStoreProductForm();
    await loadStore();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
}

function updateStoreImagePreview() {
  const url = els.storeProductImageUrl.value.trim();
  els.storeProductImagePreview.innerHTML = "";
  if (!/^https?:\/\//i.test(url) && !/^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(url)) {
    els.storeProductImagePreview.classList.add("hidden");
    return;
  }
  const image = document.createElement("img");
  image.src = url;
  image.alt = "Product image preview";
  image.addEventListener("error", () => {
    els.storeProductImagePreview.textContent = "Image could not be loaded.";
  });
  els.storeProductImagePreview.appendChild(image);
  els.storeProductImagePreview.classList.remove("hidden");
}

function renderStoreOrders() {
  const orders = (storeData?.orders || []).filter((order) => order.status === "COMPLETED");
  els.storeOrdersList.innerHTML = "";
  if (!orders.length) {
    els.storeOrdersList.innerHTML = '<div class="store-empty">No merch orders yet.</div>';
    return;
  }
  orders.forEach((order) => {
    const row = document.createElement("article");
    row.className = "store-order-row";
    markTimedOutput(row, order.completedAt || order.createdAt);
    const orderMain = document.createElement("div");
    orderMain.className = "store-order-main";
    const title = document.createElement("strong");
    title.textContent = order.orderNumber || "Merch order";
    const payment = document.createElement("span");
    payment.textContent = `${order.quantity} x ${order.productName} - ${money(order.amount, order.currency)} - ${titleCase(order.fulfilmentStatus)} - ${formatDateTime(order.completedAt || order.createdAt)}`;
    const reference = document.createElement("code");
    reference.textContent = "Paid order";
    orderMain.append(title, payment, reference);
    const customer = document.createElement("div");
    customer.className = "store-order-address";
    const name = document.createElement("strong");
    name.textContent = order.recipientName;
    const email = document.createElement("span");
    email.textContent = order.customerEmail;
    const address = document.createElement("span");
    address.textContent = [order.addressLine1, order.addressLine2, order.city, order.postcode, order.country].filter(Boolean).join(", ");
    customer.append(name, email, address);
    const controls = document.createElement("div");
    controls.className = "store-order-controls";
    const select = document.createElement("select");
    ["PENDING", "PROCESSING", "SHIPPED", "CANCELLED"].forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = titleCase(status);
      option.selected = status === order.fulfilmentStatus;
      select.appendChild(option);
    });
    select.disabled = order.status !== "COMPLETED";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "button small primary";
    save.textContent = "Update";
    save.disabled = order.status !== "COMPLETED";
    save.addEventListener("click", () => updateStoreOrder(order.orderId, select.value, save));
    controls.append(select, save);
    row.append(orderMain, customer, controls);
    els.storeOrdersList.appendChild(row);
  });
}

async function updateStoreOrder(orderId, fulfilmentStatus, button) {
  button.disabled = true;
  try {
    await api("store_set_order_fulfilment", { orderId, fulfilmentStatus });
    await loadStore();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
}

async function cleanupStoreStaleOrders() {
  els.storeCleanupStaleOrdersBtn.disabled = true;
  setMessage(els.storeCleanupMessage, "Clearing stale merch orders...", "");
  try {
    const result = await api("cleanup_created_orders", { scope: "store", olderThanHours: 24 });
    setMessage(
      els.storeCleanupMessage,
      `Deleted ${formatNumber(result.deleted || 0)} stale checkout attempts.`,
      "ok"
    );
    await loadStore();
  } catch (error) {
    setMessage(els.storeCleanupMessage, error.message, "bad");
  } finally {
    els.storeCleanupStaleOrdersBtn.disabled = false;
  }
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
    const data=await api("support_list",{status:supportFilter,limit:150}); supportTicketsData=data.tickets||[]; renderTicketList(sortedSupportTickets());
    if(selectedTicketId && !supportTicketsData.some(t=>t.id===selectedTicketId)){selectedTicketId=null;els.supportDetail.className="surface support-empty";els.supportDetail.textContent="Select a support message.";}
  } catch(error){els.ticketList.innerHTML=`<div class="muted">${escapeHtml(error.message)}</div>`;}
}

function renderTicketList(tickets){els.ticketList.innerHTML="";if(!tickets.length){els.ticketList.innerHTML='<div class="muted">No support messages.</div>';return;}tickets.forEach(ticket=>{const button=document.createElement("button");button.type="button";button.className=`ticket ${ticket.isRead?"":"unread"} ${ticket.id===selectedTicketId?"active":""}`;markTimedOutput(button,ticket.lastActivityAt);button.innerHTML=`<div class="ticket-head"><span class="ticket-from"></span><span class="ticket-time">${escapeHtml(formatDate(ticket.lastActivityAt))}</span></div><div class="ticket-subject"></div><div class="ticket-snippet"></div>`;button.querySelector(".ticket-from").textContent=ticket.fromName||ticket.fromEmail;button.querySelector(".ticket-subject").textContent=ticket.subject;button.querySelector(".ticket-snippet").textContent=ticket.snippet;button.addEventListener("click",()=>openTicket(ticket.id));els.ticketList.appendChild(button);});}

async function openTicket(ticketId){selectedTicketId=ticketId;els.supportDetail.className="surface";els.supportDetail.innerHTML='<div class="muted">Loading…</div>';try{const data=await api("support_get",{ticketId});renderTicket(data.ticket,data.replies||[]);await loadSupport();}catch(error){els.supportDetail.textContent=error.message;}}

function renderTicket(ticket,replies){els.supportDetail.innerHTML="";const head=document.createElement("div");head.className="panel-head";const title=document.createElement("div");const h=document.createElement("h2");h.textContent=ticket.subject;const p=document.createElement("p");p.textContent=`${ticket.fromName?ticket.fromName+" · ":""}${ticket.fromEmail}`;title.append(h,p);const controls=document.createElement("div");controls.style.display="flex";controls.style.flexWrap="wrap";controls.style.gap="7px";["OPEN","PENDING","CLOSED"].forEach(status=>{const b=document.createElement("button");b.type="button";b.className=`button small ${ticket.status===status?"primary":""}`;b.textContent=status==="PENDING"?"Waiting":titleCase(status);b.addEventListener("click",()=>changeTicketStatus(ticket.id,status));controls.appendChild(b);});const deleteButton=document.createElement("button");deleteButton.type="button";deleteButton.className="button small danger";deleteButton.textContent="Delete";deleteButton.addEventListener("click",()=>deleteSupportTicket(ticket.id,deleteButton));controls.appendChild(deleteButton);head.append(title,controls);els.supportDetail.appendChild(head);
  const conversation=document.createElement("div");conversation.className="conversation";conversation.appendChild(makeBubble("Customer",ticket.receivedAt,ticket.body,false));replies.forEach(reply=>{const inbound=String(reply.direction||"").toUpperCase()==="INBOUND";conversation.appendChild(makeBubble(inbound?"Customer":"Support",reply.sentAt,reply.body,!inbound));});els.supportDetail.appendChild(conversation);
  const form=document.createElement("form");form.style.marginTop="14px";form.innerHTML='<div class="field"><label>Reply</label><textarea required placeholder="Write a clear reply…"></textarea></div><div style="display:flex;justify-content:flex-end;margin-top:9px"><button class="button primary" type="submit">Send reply</button></div><div class="message" aria-live="polite"></div>';form.addEventListener("submit",event=>sendSupportReply(event,ticket.id));els.supportDetail.appendChild(form);}

function makeBubble(label,date,body,isReply){const div=document.createElement("div");div.className=`bubble ${isReply?"reply":""}`;const meta=document.createElement("div");meta.className="bubble-meta";const a=document.createElement("span");a.textContent=label;const b=document.createElement("span");b.textContent=formatDateTime(date);meta.append(a,b);const content=document.createElement("div");content.className="bubble-body";content.textContent=body;div.append(meta,content);return div;}

async function sendSupportReply(event,ticketId){event.preventDefault();const form=event.currentTarget;const textarea=form.querySelector("textarea");const button=form.querySelector("button");const message=form.querySelector(".message");button.disabled=true;setMessage(message,"Sending…","");try{await api("support_reply",{ticketId,message:textarea.value});textarea.value="";setMessage(message,"Reply sent.","ok");await openTicket(ticketId);await loadDashboard();}catch(error){setMessage(message,error.message,"bad");}finally{button.disabled=false;}}

async function changeTicketStatus(ticketId,status){try{await api("support_status",{ticketId,status});await openTicket(ticketId);await loadDashboard();}catch(error){alert(error.message);}}

async function deleteSupportTicket(ticketId,button){
  const confirmed=window.confirm("Permanently delete this support conversation and all replies? This cannot be undone.");
  if(!confirmed)return;
  button.disabled=true;
  try{
    await api("support_delete",{ticketId});
    selectedTicketId=null;
    els.supportDetail.className="surface support-empty";
    els.supportDetail.textContent="Select a support message.";
    await Promise.all([loadSupport(),loadDashboard()]);
  }catch(error){
    alert(error.message);
    button.disabled=false;
  }
}

const SORT_ACCESSORS = {
  recentOrders: { date: item => dateValue(item.completedAt || item.createdAt), siteName: item => item.siteName, paymentMethod: item => item.paymentMethod, amount: item => Number(item.amount) || 0, emailStatus: item => item.emailStatus },
  orders: { date: item => dateValue(item.completedAt || item.createdAt), orderId: item => item.orderId, siteName: item => item.siteName, paymentMethod: item => item.paymentMethod, code: item => item.code, email: item => item.email, amount: item => Number(item.amount) || 0, status: item => item.status },
  codes: { createdAt: item => dateValue(item.createdAt), code: item => item.code, siteName: item => item.siteName, source: item => item.source, weeklyUses: item => Number(item.weeklyUses) || 0, weeklyLimit: item => Number(item.weeklyLimit) || 0, maxTotalUses: item => Number(item.maxTotalUses) || Number.MAX_SAFE_INTEGER, uses: item => Number(item.uses) || 0, lastUsedAt: item => dateValue(item.lastUsedAt), expiresAt: item => dateValue(item.expiresAt), active: item => item.active ? 1 : 0 },
  promos: { createdAt: item => dateValue(item.createdAt), code: item => item.code, discountValue: item => Number(item.discountValue) || 0, siteName: item => item.siteName || "", maxRedemptions: item => Number(item.maxRedemptions) || Number.MAX_SAFE_INTEGER, successfulOrders: item => Number(item.successfulOrders) || 0, createdOrders: item => Number(item.createdOrders) || 0, customers: item => Number(item.customers) || 0, discountTotal: item => Number(item.discountTotal) || 0, netRevenue: item => Number(item.netRevenue) || 0, lastUsedAt: item => dateValue(item.lastUsedAt), active: item => item.active ? 1 : 0 },
  analyticsHits: { createdAt: item => dateValue(item.createdAt), siteName: item => item.siteName, searchQuery: item => item.searchQuery, searchMode: item => item.searchMode, referrer: item => item.referrer },
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
  else if (tableName === "analyticsHits") renderAnalyticsHits(sortItems("analyticsHits", analyticsData?.recentHits || []));
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
els.logoutBtn.addEventListener("click",()=>signOut()); els.refreshBtn.addEventListener("click",refreshActive); els.reloadAnalyticsBtn.addEventListener("click",loadAnalytics); els.reloadOrdersBtn.addEventListener("click",loadOrders); els.reloadCodesBtn.addEventListener("click",loadCodes); els.reloadPromosBtn.addEventListener("click",loadPromos); els.reloadStoreBtn.addEventListener("click",loadStore); els.reloadFeedbackBtn.addEventListener("click",loadFeedback); els.reloadSupportBtn.addEventListener("click",loadSupport);
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
els.createStoreMemberBtn.addEventListener("click",createStoreMember);
els.storeInviteDelivery.addEventListener("change",updateStoreInviteDelivery);
els.storeInviteDeliveryOptions.querySelectorAll('input[name="storeInviteDeliveryChoice"]').forEach((input) => input.addEventListener("change", () => {
  if (!input.checked) return;
  els.storeInviteDelivery.value = input.value;
  updateStoreInviteDelivery();
}));
els.storeCustomerFilter.addEventListener("input",()=>{storeCustomerFilter=els.storeCustomerFilter.value;renderStoreInviteCustomers();});
els.storeClearCustomerFilterBtn.addEventListener("click",()=>{els.storeCustomerFilter.value="";storeCustomerFilter="";renderStoreInviteCustomers();els.storeCustomerFilter.focus();});
els.saveStoreProductBtn.addEventListener("click",saveStoreProduct);
els.cancelStoreProductEditBtn.addEventListener("click",resetStoreProductForm);
els.storeProductImageUrl.addEventListener("input",updateStoreImagePreview);
els.storeCleanupStaleOrdersBtn.addEventListener("click",cleanupStoreStaleOrders);
els.feedbackRecipientFilter.addEventListener("input",()=>{feedbackRecipientFilter=els.feedbackRecipientFilter.value;renderFeedbackRecipients();});
els.feedbackEnabledInput.addEventListener("change",saveFeedbackEnabled);
els.feedbackManualEmails.addEventListener("input",updateFeedbackSelectionCount);
els.selectVisibleRecipientsBtn.addEventListener("click",selectVisibleFeedbackRecipients); els.clearRecipientsBtn.addEventListener("click",clearFeedbackRecipients); els.sendFeedbackBtn.addEventListener("click",sendFeedbackRequests);
document.querySelectorAll("[data-support-filter]").forEach(button=>button.addEventListener("click",()=>{supportFilter=button.dataset.supportFilter;document.querySelectorAll("[data-support-filter]").forEach(item=>item.classList.toggle("active",item===button));loadSupport();}));
document.querySelector(".dashboard-trend")?.addEventListener("toggle",(event)=>{if(event.currentTarget.open&&dashboardData)requestAnimationFrame(()=>drawTrend(dashboardData.daily||[],dashboardData.summary?.currency||"GBP"));});
window.addEventListener("hashchange",()=>{const tab=location.hash.replace(/^#/,"");if(adminCode&&tab&&tab!==activeTab&&$(`tab-${tab}`))openTab(tab);});
window.addEventListener("keydown",(event)=>{if(event.key!=="Escape")return;if(!els.promoEditOverlay.classList.contains("hidden"))closePromoEditor();else closeControlDrawer();});
window.addEventListener("resize",()=>{if(dashboardData&&!$("tab-dashboard").classList.contains("hidden"))drawTrend(dashboardData.daily||[],dashboardData.summary?.currency||"GBP");});

try { els.staySignedInInput.checked = Boolean(localStorage.getItem(SESSION_KEY)); } catch (_) {}
updateStoreInviteDelivery();
if(adminCode) signIn(adminCode); else setTimeout(()=>els.adminCodeInput.focus(),0);
