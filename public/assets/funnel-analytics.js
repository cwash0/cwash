(function initialiseFunnelAnalytics() {
  const ENDPOINT = "/.netlify/functions/track-funnel-event";
  const VISITOR_KEY = "laundryAnalyticsVisitor";
  const SESSION_KEY = "laundryAnalyticsSession";
  const ONCE_PREFIX = "laundryFunnelEvent:";

  function randomId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function storedId(storage, key) {
    try {
      let value = String(storage.getItem(key) || "").trim();
      if (!value) {
        value = randomId();
        storage.setItem(key, value);
      }
      return value;
    } catch (_) {
      return randomId();
    }
  }

  function deviceType() {
    const width = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    if (width < 768) return "mobile";
    if (width < 1100) return "tablet";
    return "desktop";
  }

  function inferredAuthState() {
    try {
      return String(localStorage.getItem("laundryActivateAccessCode") || "").trim()
        ? "authenticated"
        : "anonymous";
    } catch (_) {
      return "unknown";
    }
  }

  function inferredTrialEligibility() {
    try {
      const claim = JSON.parse(localStorage.getItem("zaftFreeTrialClaim") || "null");
      if (claim?.used || claim?.activatedAt) return "used";
      if (claim?.token) return "claimed";
      return "unknown";
    } catch (_) {
      return "unknown";
    }
  }

  function wasTrackedOnce(key) {
    if (!key) return false;
    try {
      const storageKey = `${ONCE_PREFIX}${key}`;
      if (sessionStorage.getItem(storageKey)) return true;
      sessionStorage.setItem(storageKey, "1");
      return false;
    } catch (_) {
      return false;
    }
  }

  function track(eventName, dimensions = {}, options = {}) {
    if (!eventName || wasTrackedOnce(options.once)) return false;
    const payload = {
      event_name: eventName,
      event_id: randomId(),
      source: String(dimensions.source || "direct"),
      route: String(dimensions.route || `${location.pathname}${location.search || ""}`),
      device_type: String(dimensions.device_type || deviceType()),
      session_id: storedId(sessionStorage, SESSION_KEY),
      visitor_id: storedId(localStorage, VISITOR_KEY),
      auth_state: String(dimensions.auth_state || inferredAuthState()),
      trial_eligibility: String(dimensions.trial_eligibility || inferredTrialEligibility()),
      webdriver: Boolean(navigator.webdriver)
    };
    const body = JSON.stringify(payload);

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(ENDPOINT, blob)) return true;
      }
    } catch (_) {}

    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      }).catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }

  window.CircuitWashAnalytics = Object.freeze({ track });
})();
