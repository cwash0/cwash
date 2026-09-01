const TRIAL_CLAIM_KEY = "zaftFreeTrialClaim";
const ACTIVATE_SESSION_KEY = "laundryActivateAccessCode";
const trialEntries = [...document.querySelectorAll("[data-primary-action]")];
const mobileSticky = document.getElementById("mobileSticky");
const prominentActions = [...document.querySelectorAll(".hero [data-primary-action], .final-cta [data-primary-action]")];
const trialStatus = document.getElementById("trialStatus");
const retryTrialStatus = document.getElementById("retryTrialStatus");
let prominentActionVisible = true;
let landingState = { authState: "anonymous", trialEligibility: "unknown", actionKind: "trial" };

function hasSavedAccess() {
  try { return Boolean(String(localStorage.getItem(ACTIVATE_SESSION_KEY) || "").trim()); }
  catch (_) { return false; }
}

function cachedTrialClaim() {
  try {
    const claim = JSON.parse(localStorage.getItem(TRIAL_CLAIM_KEY) || "null");
    if (!claim?.token) {
      localStorage.removeItem(TRIAL_CLAIM_KEY);
      return null;
    }
    return claim;
  } catch (_) {
    return null;
  }
}

function clearCachedTrialClaim() {
  try { localStorage.removeItem(TRIAL_CLAIM_KEY); } catch (_) {}
}

function saveCachedTrialClaim(claim) {
  try { localStorage.setItem(TRIAL_CLAIM_KEY, JSON.stringify(claim)); } catch (_) {}
}

function claimedTrialHref(claim) {
  const token = String(claim?.token || "").trim();
  return token ? `/trial-activate.html#trial=${encodeURIComponent(token)}` : "/trial-activate.html";
}

function updateHeader(authenticated) {
  document.querySelectorAll("[data-header-access-label]").forEach((label) => {
    label.textContent = authenticated ? "Start a wash" : "Have a code?";
  });
}

function setPrimaryAction({ href, label, actionKind, trialEligibility }) {
  landingState = { ...landingState, actionKind, trialEligibility };
  trialEntries.forEach((entry) => {
    entry.href = href;
    entry.dataset.actionKind = actionKind;
    entry.dataset.readyLabel = label;
    entry.classList.remove("is-loading", "is-unavailable", "is-navigating");
    entry.removeAttribute("aria-busy");
    entry.removeAttribute("aria-disabled");
    entry.removeAttribute("tabindex");
    const text = entry.querySelector(".button-label");
    if (text) text.textContent = label;
  });
  setTrialStatus("");
}

function setTrialStatus(message, { retry = false } = {}) {
  if (!trialStatus) return;
  const text = trialStatus.querySelector("span");
  if (text) text.textContent = message;
  retryTrialStatus?.classList.toggle("hidden", !retry);
  trialStatus.classList.toggle("hidden", !message && !retry);
}

function setTrialUnavailable() {
  landingState = { ...landingState, actionKind: "trial", trialEligibility: "unavailable" };
  trialEntries.forEach((entry) => {
    entry.classList.remove("is-loading", "is-navigating");
    entry.classList.add("is-unavailable");
    entry.setAttribute("aria-disabled", "true");
    entry.tabIndex = -1;
    entry.removeAttribute("aria-busy");
    const text = entry.querySelector(".button-label");
    if (text) text.textContent = "Try your first wash free";
  });
  setTrialStatus("The free trial could not be checked. Your paid and access-code paths are still available.", { retry: true });
}

async function freeTrialState(claim) {
  if (!claim) return "available";
  if (claim.used || claim.activatedAt) return "used";
  const response = await fetch("/.netlify/functions/free-trial", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "session", trialToken: claim.token })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    if (data.error === "trial_used") {
      saveCachedTrialClaim({ ...claim, used: true, activatedAt: data.activatedAt || new Date().toISOString() });
      return "used";
    }
    if (response.status === 400 || response.status === 404 || data.error === "trial_not_found") {
      clearCachedTrialClaim();
      return "available";
    }
    throw new Error("trial_status_failed");
  }
  if (data.used) {
    saveCachedTrialClaim({ ...claim, used: true, activatedAt: data.activatedAt || new Date().toISOString() });
    return "used";
  }
  return "claimed";
}

function trackLandingView() {
  window.CircuitWashAnalytics?.track("landing_view", {
    source: "homepage",
    auth_state: landingState.authState,
    trial_eligibility: landingState.trialEligibility
  }, { once: "landing_view" });
}

async function initialiseLanding() {
  const authenticated = hasSavedAccess();
  landingState.authState = authenticated ? "authenticated" : "anonymous";
  document.documentElement.dataset.authState = landingState.authState;
  updateHeader(authenticated);

  if (authenticated) {
    setPrimaryAction({ href: "/activate.html", label: "Start a wash", actionKind: "wash", trialEligibility: "unknown" });
    trackLandingView();
    return;
  }

  const localClaim = cachedTrialClaim();
  if (localClaim?.used || localClaim?.activatedAt) {
    setPrimaryAction({ href: "/pay.html", label: "Get an access code", actionKind: "paid-access", trialEligibility: "used" });
    trackLandingView();
    return;
  }

  trialEntries.forEach((entry) => {
    entry.classList.add("is-loading");
    entry.setAttribute("aria-busy", "true");
    entry.setAttribute("aria-disabled", "true");
    entry.tabIndex = -1;
  });
  setTrialStatus("");

  try {
    const response = await fetch("/.netlify/functions/free-trial", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status" })
    });
    if (!response.ok) throw new Error("trial_status_failed");
    const data = await response.json();
    if (!data?.enabled) {
      setPrimaryAction({ href: "/pay.html", label: "Get an access code", actionKind: "paid-access", trialEligibility: "disabled" });
      setTrialStatus("Free trials are not available right now.");
      trackLandingView();
      return;
    }

    const state = await freeTrialState(localClaim);
    if (state === "claimed") {
      setPrimaryAction({ href: claimedTrialHref(localClaim), label: "Continue your free wash", actionKind: "trial", trialEligibility: "claimed" });
    } else if (state === "used") {
      setPrimaryAction({ href: "/pay.html", label: "Get an access code", actionKind: "paid-access", trialEligibility: "used" });
    } else {
      setPrimaryAction({ href: "/trial.html", label: "Try your first wash free", actionKind: "trial", trialEligibility: "available" });
    }
    trackLandingView();
  } catch (_) {
    setTrialUnavailable();
    trackLandingView();
  }
}

function beginNavigation(entry, event) {
  if (entry.classList.contains("is-loading") || entry.classList.contains("is-unavailable") || entry.classList.contains("is-navigating")) {
    event.preventDefault();
    return;
  }

  const source = entry.dataset.source || "landing";
  if (entry.dataset.actionKind === "trial") {
    window.CircuitWashAnalytics?.track("trial_cta_clicked", {
      source,
      auth_state: landingState.authState,
      trial_eligibility: landingState.trialEligibility
    });
  }

  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  const destination = entry.href;
  trialEntries.forEach((action) => {
    action.classList.add("is-navigating");
    action.setAttribute("aria-disabled", "true");
    action.tabIndex = -1;
    const label = action.querySelector(".button-label");
    if (label) label.textContent = "Starting…";
  });
  window.requestAnimationFrame(() => window.setTimeout(() => location.assign(destination), 20));
}

trialEntries.forEach((entry) => entry.addEventListener("click", (event) => beginNavigation(entry, event)));

document.querySelectorAll("[data-access-code-entry]").forEach((entry) => entry.addEventListener("click", () => {
  window.CircuitWashAnalytics?.track("access_code_clicked", {
    source: entry.dataset.source || (entry.closest(".final-cta") ? "final-secondary" : "returning-user-section"),
    auth_state: landingState.authState,
    trial_eligibility: landingState.trialEligibility
  });
}));

retryTrialStatus?.addEventListener("click", initialiseLanding);
document.getElementById("currentYear").textContent = new Date().getFullYear();

let stickyQueued = false;
function updateStickyCta() {
  const shouldShow = window.scrollY > 360 && !prominentActionVisible;
  mobileSticky?.classList.toggle("is-visible", shouldShow);
  mobileSticky?.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  stickyQueued = false;
}
window.addEventListener("scroll", () => {
  if (stickyQueued) return;
  stickyQueued = true;
  window.requestAnimationFrame(updateStickyCta);
}, { passive: true });

if ("IntersectionObserver" in window) {
  const visibleActions = new Set();
  const stickyObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.isIntersecting ? visibleActions.add(entry.target) : visibleActions.delete(entry.target));
    prominentActionVisible = visibleActions.size > 0;
    updateStickyCta();
  }, { threshold: .45 });
  prominentActions.forEach((cta) => stickyObserver.observe(cta));
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) initialiseLanding();
});

initialiseLanding();
