(function initialiseSupportPage() {
  const form = document.getElementById("support-form");
  const emailInput = document.getElementById("support-email");
  const messageInput = document.getElementById("support-message");
  const errorMessage = document.getElementById("support-error");
  const submitButton = document.getElementById("support-submit");
  const formView = document.getElementById("support-form-view");
  const successView = document.getElementById("support-success");
  const successEmail = document.getElementById("support-success-email");
  const ticketId = document.getElementById("support-ticket-id");
  const backLink = document.getElementById("support-back");
  const honeypotInput = document.getElementById("support-company-website");
  const turnstileContainer = document.getElementById("support-turnstile");
  const EMAIL_KEY = "laundryAccessEmail";
  const PURCHASE_KEY = "laundryAccessPurchase";
  const ACCESS_CODE_KEY = "laundryActivateAccessCode";
  const SESSION_KEY = "laundryAnalyticsSession";
  const SUBMISSION_KEY = "circuitWashSupportSubmission";
  let formToken = "";
  let turnstileEnabled = false;
  let turnstileToken = "";
  let turnstileWidgetId = null;

  configureBackNavigation();
  const securityPromise = initialiseBotProtection();
  securityPromise.then(prefillEmail).catch(() => {});
  track("support_page_viewed", {}, { once: "support-page-viewed" });
  form.addEventListener("submit", submitSupportRequest);

  async function prefillEmail() {
    if (!formToken) return;
    const localEmail = storedEmail();
    if (localEmail) emailInput.value = localEmail;

    const purchase = storedPurchase();
    const accessCode = storedValue(localStorage, ACCESS_CODE_KEY) || String(purchase?.code || "").trim();
    const orderId = String(purchase?.orderId || "").trim();
    if (!accessCode && !orderId) return;
    try {
      const response = await fetch("/.netlify/functions/support-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "context", accessCode, orderId, formToken, sessionId: storedValue(sessionStorage, SESSION_KEY) })
      });
      const data = await response.json();
      if (response.ok && data.email && !emailInput.value) emailInput.value = data.email;
    } catch (_) {}
  }

  async function submitSupportRequest(event) {
    event.preventDefault();
    if (submitButton.disabled) return;
    errorMessage.textContent = "";

    if (!form.reportValidity()) return;
    const email = emailInput.value.trim().toLowerCase();
    const message = messageInput.value.trim();
    if (message.length < 10) {
      errorMessage.textContent = "Tell us a little more so we can help.";
      messageInput.focus();
      return;
    }

    await securityPromise;
    if (!formToken) {
      errorMessage.textContent = "The security check did not load. Refresh the page and try again.";
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      errorMessage.textContent = "Complete the security check before sending your message.";
      return;
    }

    setLoading(true);
    try {
      const purchase = storedPurchase();
      const response = await fetch("/.netlify/functions/support-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          email,
          message,
          companyWebsite: honeypotInput?.value || "",
          formToken,
          turnstileToken,
          idempotencyKey: submissionKey(),
          accessCode: storedValue(localStorage, ACCESS_CODE_KEY) || String(purchase?.code || "").trim(),
          orderId: String(purchase?.orderId || "").trim(),
          sessionId: storedValue(sessionStorage, SESSION_KEY),
          sourceRoute: sourceRoute(),
          machineId: sourceMachineId()
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || "We couldn’t send your message. Please try again.");

      try { localStorage.setItem(EMAIL_KEY, email); } catch (_) {}
      try { sessionStorage.removeItem(SUBMISSION_KEY); } catch (_) {}
      track("support_ticket_submitted", { source: sourceRoute() });
      successEmail.textContent = data.email || email;
      ticketId.textContent = data.ticketId || "submitted";
      formView.hidden = true;
      successView.hidden = false;
      successView.focus();
    } catch (error) {
      resetTurnstile();
      errorMessage.textContent = error.message || "We couldn’t send your message. Please try again.";
    } finally {
      setLoading(false);
    }
  }

  async function initialiseBotProtection() {
    try {
      const response = await fetch("/.netlify/functions/support-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "config" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.formToken) throw new Error("security_unavailable");
      formToken = String(data.formToken);
      turnstileEnabled = Boolean(data.turnstile?.enabled && data.turnstile?.siteKey);
      if (turnstileEnabled) await mountTurnstile(String(data.turnstile.siteKey));
    } catch (_) {
      formToken = "";
      turnstileEnabled = false;
    }
  }

  function mountTurnstile(siteKey) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => fail(new Error("turnstile_timeout")), 10000);
      const finish = () => {
        if (settled) return false;
        settled = true;
        window.clearTimeout(timeoutId);
        return true;
      };
      const fail = (error) => {
        if (!finish()) return;
        reject(error instanceof Error ? error : new Error("turnstile_unavailable"));
      };
      const render = () => {
        if (settled) return;
        if (!window.turnstile || !turnstileContainer) return fail(new Error("turnstile_unavailable"));
        try {
          turnstileContainer.hidden = false;
          turnstileWidgetId = window.turnstile.render(turnstileContainer, {
            sitekey: siteKey,
            action: "support_submit",
            theme: "dark",
            size: "flexible",
            callback: (token) => { turnstileToken = String(token || ""); },
            "expired-callback": () => { turnstileToken = ""; },
            "timeout-callback": () => { turnstileToken = ""; },
            "error-callback": () => { turnstileToken = ""; }
          });
        } catch (error) {
          return fail(error);
        }
        if (finish()) resolve();
      };
      if (window.turnstile) return render();
      const existing = document.getElementById("support-turnstile-script");
      if (existing) {
        existing.addEventListener("load", render, { once: true });
        existing.addEventListener("error", fail, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.id = "support-turnstile-script";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", fail, { once: true });
      document.head.appendChild(script);
    });
  }

  function resetTurnstile() {
    if (!turnstileEnabled || turnstileWidgetId === null || !window.turnstile) return;
    turnstileToken = "";
    try { window.turnstile.reset(turnstileWidgetId); } catch (_) {}
  }

  function storedEmail() {
    const direct = storedValue(localStorage, EMAIL_KEY);
    if (direct) return direct;
    try {
      const purchase = storedPurchase();
      return String(purchase?.email || purchase?.customerEmail || "").trim().toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function storedPurchase() {
    try { return JSON.parse(localStorage.getItem(PURCHASE_KEY) || "null") || {}; }
    catch (_) { return {}; }
  }

  function submissionKey() {
    let value = storedValue(sessionStorage, SUBMISSION_KEY);
    if (!value) {
      value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try { sessionStorage.setItem(SUBMISSION_KEY, value); } catch (_) {}
    }
    return value;
  }

  function sourceRoute() {
    return validatedSourceRoute() || "/support.html";
  }

  function validatedSourceRoute() {
    const source = new URLSearchParams(location.search).get("source");
    if (!source || !source.startsWith("/") || source.startsWith("//")) return "";
    try {
      const url = new URL(source.slice(0, 300), location.origin);
      if (url.origin !== location.origin) return "";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (_) {
      return "";
    }
  }

  function configureBackNavigation() {
    if (!backLink) return;
    backLink.href = validatedSourceRoute() || "/";
    backLink.addEventListener("click", (event) => {
      if (!document.referrer || history.length <= 1) return;
      try {
        if (new URL(document.referrer).origin !== location.origin) return;
        event.preventDefault();
        history.back();
      } catch (_) {}
    });
  }

  function sourceMachineId() {
    return new URLSearchParams(location.search).get("machine") || "";
  }

  function storedValue(storage, key) {
    try { return String(storage.getItem(key) || "").trim(); } catch (_) { return ""; }
  }

  function setLoading(loading) {
    submitButton.disabled = loading;
    submitButton.classList.toggle("is-loading", loading);
    submitButton.setAttribute("aria-busy", String(loading));
  }

  function track(name, dimensions, options) {
    window.CircuitWashAnalytics?.track(name, dimensions, options);
  }
})();
