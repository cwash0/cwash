const TRIAL_CLAIM_KEY = "zaftFreeTrialClaim";
const trialEntries = [...document.querySelectorAll("[data-trial-entry]")];
const mobileSticky = document.getElementById("mobileSticky");
const prominentActivationCtas = [...document.querySelectorAll(".primary-activation-cta")];
let prominentActivationVisible = true;

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

function setTrialVisible(visible) {
  trialEntries.forEach((entry) => entry.classList.toggle("hidden", !visible));
}

function setTrialDestination(href, claimed = false) {
  trialEntries.forEach((entry) => {
    entry.href = href;
    entry.classList.remove("is-loading");
    entry.removeAttribute("aria-busy");
    entry.removeAttribute("aria-disabled");
    if (entry.id === "freeTrialCard") {
      const label = entry.querySelector(".quick-copy strong");
      if (label) label.textContent = claimed ? "Continue free activation" : "Try CircuitWash free";
    } else if (claimed) entry.textContent = "Continue free activation";
  });
}

function claimedTrialHref(claim) {
  const token = String(claim?.token || "").trim();
  return token ? `/trial-activate.html#trial=${encodeURIComponent(token)}` : "/trial-activate.html";
}

async function freeTrialState(claim) {
  if (!claim) return "available";
  if (claim.used || claim.activatedAt) return "activated";
  try {
    const response = await fetch("/.netlify/functions/free-trial", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "session", trialToken: claim.token })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      if (response.status === 400 || response.status === 404 || data.error === "trial_not_found") {
        clearCachedTrialClaim();
        return "available";
      }
      return "claimed";
    }
    if (data.used) {
      saveCachedTrialClaim({ ...claim, used: true, activatedAt: data.activatedAt || new Date().toISOString() });
      return "activated";
    }
    return "claimed";
  } catch (_) {
    return "claimed";
  }
}

trialEntries.forEach((entry) => entry.addEventListener("click", (event) => {
  if (entry.classList.contains("is-loading")) event.preventDefault();
}));

fetch("/.netlify/functions/free-trial", {
  method: "POST",
  cache: "no-store",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "status" })
})
  .then((response) => response.ok ? response.json() : null)
  .then(async (data) => {
    if (!data?.enabled) return setTrialVisible(false);
    const claim = cachedTrialClaim();
    const state = await freeTrialState(claim);
    if (state === "activated") return setTrialVisible(false);
    setTrialDestination(state === "claimed" ? claimedTrialHref(claim) : "/trial.html", state === "claimed");
    setTrialVisible(true);
  })
  .catch(() => setTrialVisible(false));

document.getElementById("currentYear").textContent = new Date().getFullYear();

let stickyQueued = false;
function updateStickyCta() {
  const shouldShow = window.scrollY > 360 && !prominentActivationVisible;
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
  const visibleCtas = new Set();
  const stickyObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.isIntersecting ? visibleCtas.add(entry.target) : visibleCtas.delete(entry.target));
    prominentActivationVisible = visibleCtas.size > 0;
    updateStickyCta();
  }, { threshold: .45 });
  prominentActivationCtas.forEach((cta) => stickyObserver.observe(cta));
}
