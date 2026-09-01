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
  const EMAIL_KEY = "laundryAccessEmail";
  const PURCHASE_KEY = "laundryAccessPurchase";
  const ACCESS_CODE_KEY = "laundryActivateAccessCode";
  const SESSION_KEY = "laundryAnalyticsSession";
  const SUBMISSION_KEY = "circuitWashSupportSubmission";

  configureBackNavigation();
  prefillEmail();
  track("support_page_viewed", {}, { once: "support-page-viewed" });
  form.addEventListener("submit", submitSupportRequest);

  async function prefillEmail() {
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
        body: JSON.stringify({ action: "context", accessCode, orderId })
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
      errorMessage.textContent = error.message || "We couldn’t send your message. Please try again.";
    } finally {
      setLoading(false);
    }
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
