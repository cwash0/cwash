const TRIAL_CLAIM_KEY = "zaftFreeTrialClaim";
const ACTIVATE_SESSION_KEY = "laundryActivateAccessCode";
const primaryAction = document.querySelector("[data-primary-action]");
const paidAccessAction = document.querySelector("[data-paid-access-action]");
const headerCodeAction = document.querySelector("[data-access-code-entry]");
let landingState = { authState: "anonymous", trialEligibility: "unknown", actionKind: "wash" };

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

function setActionVisible(action, visible) {
  if (!action) return;
  if (visible) {
    action.removeAttribute("hidden");
    action.removeAttribute("aria-hidden");
    action.tabIndex = 0;
    return;
  }
  action.setAttribute("hidden", "");
  action.setAttribute("aria-hidden", "true");
  action.tabIndex = -1;
}

function setPrimaryActionResolving() {
  if (!primaryAction) return;
  primaryAction.classList.remove("is-navigating");
  primaryAction.classList.add("is-resolving");
  primaryAction.setAttribute("aria-busy", "true");
  primaryAction.setAttribute("aria-disabled", "true");
  primaryAction.setAttribute("aria-label", "Checking wash options");
  primaryAction.tabIndex = -1;
  setActionVisible(paidAccessAction, false);
  setActionVisible(headerCodeAction, false);
}

function setPrimaryAction({ href, actionKind, trialEligibility, showPaidAccess = false, showHeaderCode = true }) {
  landingState = { ...landingState, actionKind, trialEligibility };
  if (!primaryAction) return;
  primaryAction.href = href;
  primaryAction.dataset.actionKind = actionKind;
  const label = primaryAction.querySelector("[data-primary-action-label]");
  if (label) label.textContent = actionKind === "trial" ? "Try your first wash free" : "Start a wash";
  primaryAction.classList.remove("is-resolving");
  primaryAction.removeAttribute("aria-busy");
  primaryAction.removeAttribute("aria-disabled");
  primaryAction.removeAttribute("aria-label");
  primaryAction.tabIndex = 0;
  setActionVisible(paidAccessAction, showPaidAccess);
  setActionVisible(headerCodeAction, showHeaderCode);
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
  setPrimaryActionResolving();
  const authenticated = hasSavedAccess();
  landingState.authState = authenticated ? "authenticated" : "anonymous";
  document.documentElement.dataset.authState = landingState.authState;

  if (authenticated) {
    setPrimaryAction({
      href: "/activate.html",
      actionKind: "wash",
      trialEligibility: "unknown",
      showHeaderCode: false
    });
    trackLandingView();
    return;
  }

  const localClaim = cachedTrialClaim();
  if (localClaim?.used || localClaim?.activatedAt) {
    setPrimaryAction({ href: "/pay.html", actionKind: "paid-access", trialEligibility: "used" });
    trackLandingView();
    return;
  }

  // Local state is enough to choose the useful destination immediately. The
  // server check below can still correct it without holding the CTA disabled.
  if (localClaim) {
    setPrimaryAction({ href: claimedTrialHref(localClaim), actionKind: "trial", trialEligibility: "claimed" });
  } else {
    setPrimaryAction({ href: "/trial.html", actionKind: "trial", trialEligibility: "available" });
  }

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
      setPrimaryAction({
        href: "/activate.html",
        actionKind: "wash",
        trialEligibility: "disabled",
        showPaidAccess: true,
        showHeaderCode: false
      });
      trackLandingView();
      return;
    }

    const state = await freeTrialState(localClaim);
    if (state === "claimed") {
      setPrimaryAction({ href: claimedTrialHref(localClaim), actionKind: "trial", trialEligibility: "claimed" });
    } else if (state === "used") {
      setPrimaryAction({ href: "/pay.html", actionKind: "paid-access", trialEligibility: "used" });
    } else {
      setPrimaryAction({ href: "/trial.html", actionKind: "trial", trialEligibility: "available" });
    }
  } catch (_) {
    setPrimaryAction({
      href: "/activate.html",
      actionKind: "wash",
      trialEligibility: "unavailable",
      showPaidAccess: true,
      showHeaderCode: false
    });
  }

  trackLandingView();
}

function beginNavigation(event) {
  if (!primaryAction || primaryAction.classList.contains("is-resolving") || primaryAction.classList.contains("is-navigating")) {
    event.preventDefault();
    return;
  }

  const source = primaryAction.dataset.source || "landing";
  if (primaryAction.dataset.actionKind === "trial") {
    window.CircuitWashAnalytics?.track("trial_cta_clicked", {
      source,
      auth_state: landingState.authState,
      trial_eligibility: landingState.trialEligibility
    });
  }

  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  const destination = primaryAction.href;
  primaryAction.classList.add("is-navigating");
  const reducedMotion = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const navigationDelay = reducedMotion ? 0 : 90;
  window.requestAnimationFrame(() => window.setTimeout(() => location.assign(destination), navigationDelay));
}

primaryAction?.addEventListener("click", beginNavigation);

document.querySelectorAll("[data-access-code-entry]").forEach((entry) => entry.addEventListener("click", () => {
  window.CircuitWashAnalytics?.track("access_code_clicked", {
    source: entry.dataset.source || "landing",
    auth_state: landingState.authState,
    trial_eligibility: landingState.trialEligibility
  });
}));

window.addEventListener("pageshow", (event) => {
  if (event.persisted) initialiseLanding();
});

initialiseLanding();
