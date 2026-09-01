const TRIAL_API = "/.netlify/functions/free-trial";
const SITE_API = "/.netlify/functions/public-sites";
const TRIAL_TOKEN_KEY = "zaftFreeTrialBrowserToken";
const TRIAL_CLAIM_KEY = "zaftFreeTrialClaim";

let selectedSite = null;
let searchTimer = null;
let searchRequest = 0;
let claiming = false;

const els = {
  unavailable: document.getElementById("trialUnavailable"),
  claimed: document.getElementById("trialClaimed"),
  form: document.getElementById("trialFormPanel"),
  search: document.getElementById("trialSiteSearch"),
  results: document.getElementById("trialSiteResults"),
  selected: document.getElementById("selectedTrialSite"),
  message: document.getElementById("trialMessage")
};

function setMessage(text, tone = "") {
  els.message.textContent = text;
  els.message.className = `trial-message ${tone}`.trim();
}

function cachedClaim() {
  try {
    const raw = localStorage.getItem(TRIAL_CLAIM_KEY);
    const claim = raw ? JSON.parse(raw) : null;
    if (!claim?.token) {
      localStorage.removeItem(TRIAL_CLAIM_KEY);
      return null;
    }
    return claim;
  } catch (_) {
    return null;
  }
}

function browserToken() {
  try {
    let token = String(localStorage.getItem(TRIAL_TOKEN_KEY) || "").trim();
    if (!token) {
      token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(TRIAL_TOKEN_KEY, token);
    }
    return token;
  } catch (_) {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
}

async function api(action, payload = {}) {
  const response = await fetch(TRIAL_API, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || "The free trial could not be started.");
    error.code = data.error || "request_failed";
    throw error;
  }
  return data;
}

async function initialise() {
  try {
    const status = await api("status");
    if (!status.enabled) {
      els.unavailable.classList.remove("hidden");
      return;
    }
    const claim = cachedClaim();
    if (claim) {
      try {
        await api("session", { trialToken: claim.token });
        els.claimed.classList.remove("hidden");
        return;
      } catch (_) {
        try { localStorage.removeItem(TRIAL_CLAIM_KEY); } catch (_) {}
      }
    }
    els.form.classList.remove("hidden");
    els.search.focus();
  } catch (_) {
    els.unavailable.classList.remove("hidden");
  }
}

async function searchSites() {
  const query = els.search.value.trim();
  const requestId = ++searchRequest;
  selectedSite = null;
  els.selected.classList.add("hidden");
  setMessage("");
  if (query.length < 2) {
    els.results.classList.add("hidden");
    els.search.setAttribute("aria-expanded", "false");
    return;
  }
  els.results.innerHTML = '<div class="trial-result-status loading"><span class="result-spinner" aria-hidden="true"></span><span>Finding laundry rooms...</span></div>';
  els.results.classList.remove("hidden");
  els.search.setAttribute("aria-expanded", "true");
  try {
    const response = await fetch(SITE_API, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, mode: "all" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error("Search failed");
    if (requestId !== searchRequest) return;
    renderResults(data.sites || []);
  } catch (_) {
    if (requestId !== searchRequest) return;
    els.results.innerHTML = '<div class="trial-result-status"><span>Could not search laundry rooms. Try again.</span></div>';
  }
}

function renderResults(sites) {
  els.results.innerHTML = "";
  if (!sites.length) {
    els.results.innerHTML = '<div class="trial-result-status"><strong>No laundry rooms found</strong><span>Check the spelling or try an address or postcode.</span></div>';
    return;
  }
  sites.forEach((site) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "trial-result";
    const title = document.createElement("strong");
    title.textContent = site.name;
    button.appendChild(title);
    if (site.address) {
      const address = document.createElement("span");
      address.textContent = site.address;
      button.appendChild(address);
    }
    const chevron = document.createElement("span");
    chevron.className = "result-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "›";
    button.appendChild(chevron);
    button.addEventListener("click", () => selectSite(site));
    els.results.appendChild(button);
  });
}

function selectSite(site) {
  if (claiming) return;
  selectedSite = site;
  els.search.value = site.name;
  els.results.classList.add("hidden");
  els.search.setAttribute("aria-expanded", "false");
  renderSelectedSite(site, "opening");
  setMessage("");
  claimTrial();
}

function renderSelectedSite(site, state = "") {
  els.selected.innerHTML = "";
  els.selected.className = `selected-site ${state}`.trim();
  const check = document.createElement("span");
  check.className = "selected-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = state === "opening" ? "" : state === "error" ? "!" : "✓";
  els.selected.appendChild(check);
  const copy = document.createElement("span");
  copy.className = "selected-copy";
  const title = document.createElement("strong");
  title.textContent = site.name;
  copy.appendChild(title);
  if (site.address) {
    const address = document.createElement("span");
    address.textContent = site.address;
    copy.appendChild(address);
  }
  els.selected.appendChild(copy);
  if (state === "opening") {
    const status = document.createElement("span");
    status.className = "selected-status";
    status.textContent = "Opening";
    els.selected.appendChild(status);
  }
}

async function claimTrial() {
  if (!selectedSite || claiming) return;
  claiming = true;
  els.search.disabled = true;
  setMessage("");
  try {
    const result = await api("claim", { siteId: selectedSite.id, browserToken: browserToken() });
    const claim = { token: result.trialToken, site: result.site, claimedAt: new Date().toISOString() };
    try {
      localStorage.setItem(TRIAL_CLAIM_KEY, JSON.stringify(claim));
    } catch (_) {}
    window.CircuitWashAnalytics?.track("trial_started", {
      source: new URLSearchParams(location.search).get("source") || "trial-site-selected",
      auth_state: "anonymous",
      trial_eligibility: "claimed"
    }, { once: "trial_started" });
    location.assign(`${result.activationUrl || "/trial-activate.html"}#trial=${encodeURIComponent(result.trialToken)}`);
  } catch (error) {
    if (error.code === "trial_already_claimed") {
      els.form.classList.add("hidden");
      els.claimed.classList.remove("hidden");
      return;
    }
    if (error.code === "trial_used") {
      setMessage("This free trial has already been used in this browser.", "bad");
      renderSelectedSite(selectedSite, "error");
      return;
    }
    if (error.code === "trial_disabled") {
      els.form.classList.add("hidden");
      els.unavailable.classList.remove("hidden");
      return;
    }
    if (error.code === "site_trial_limit_reached") {
      setMessage("Free trials for this laundry room are full this week. Search for another site.", "bad");
    } else {
      setMessage(error.message, "bad");
    }
    renderSelectedSite(selectedSite, "error");
  } finally {
    claiming = false;
    els.search.disabled = false;
  }
}

els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  selectedSite = null;
  els.selected.classList.add("hidden");
  searchTimer = setTimeout(searchSites, 230);
});
initialise();
