const TRIAL_API = "/.netlify/functions/free-trial";
const SITE_API = "/.netlify/functions/public-sites";
const TRIAL_TOKEN_KEY = "zaftFreeTrialBrowserToken";
const TRIAL_CLAIM_KEY = "zaftFreeTrialClaim";
const EMAIL_STORAGE_KEY = "laundryAccessEmail";
const CHECKOUT_API = "/.netlify/functions/stripe-checkout";
const PURCHASE_STORAGE_KEY = "laundryAccessPurchase";
const ACTIVATE_SESSION_KEY = "laundryActivateAccessCode";
const ANALYTICS_VISITOR_KEY = "laundryAnalyticsVisitor";
const ANALYTICS_SESSION_KEY = "laundryAnalyticsSession";
const SITE_FULL_CHECKOUT_CONTEXT_KEY = "laundryPendingSiteFullCheckout";

function mountSiteFullPaymentSheet() {
  const host = document.getElementById("trialSiteFullPaymentHost");
  host.innerHTML = `
    <div id="siteFullPaymentMethods" class="payment-sheet hidden" role="dialog" aria-modal="true" aria-labelledby="siteFullPaymentSheetTitle">
      <div class="payment-sheet-backdrop" data-close-site-full-payment></div>
      <div class="payment-sheet-panel">
        <div class="payment-sheet-header">
          <div>
            <h2 id="siteFullPaymentSheetTitle">Choose payment method</h2>
            <p id="siteFullPaymentSheetSubtitle">1-year access for this laundry room.</p>
          </div>
          <button id="siteFullPaymentSheetCloseBtn" class="payment-sheet-close" type="button" aria-label="Close payment options">Close</button>
        </div>
        <div id="siteFullPaymentSheetLoader" class="payment-sheet-loader" role="status" aria-live="polite" aria-hidden="true">
          <div class="checkout-loading-spinner" aria-hidden="true"></div>
          <strong>Preparing secure checkout</strong>
          <span>Loading payment options...</span>
        </div>
        <div id="siteFullPaymentSheetContent" class="payment-sheet-content">
          <div class="payment-sheet-total" aria-live="polite"><span>Total</span><strong id="siteFullPaymentSheetTotal">&mdash;</strong></div>
          <div class="stripe-checkout-panel">
            <section id="siteFullExpressCheckout" class="express-checkout hidden" aria-labelledby="siteFullExpressCheckoutHeading">
              <p id="siteFullExpressCheckoutHeading" class="payment-method-label">Express checkout</p>
              <div id="siteFullExpressCheckoutElement"></div>
            </section>
            <div id="siteFullPaymentDivider" class="payment-divider hidden"><span>Or pay with card</span></div>
            <section id="siteFullCardFieldsWrap" class="stripe-payment-method" aria-labelledby="siteFullCardPaymentHeading">
              <div class="card-method-header">
                <div class="card-method-copy"><span class="card-method-icon" aria-hidden="true"></span><div class="card-method-title"><h3 id="siteFullCardPaymentHeading">Card payment</h3><span id="siteFullCardPoweredBy" class="card-powered-by">Secure checkout</span></div></div>
                <button id="siteFullCardPaymentToggle" class="card-expand-button" type="button" aria-controls="siteFullCardFieldsForm" aria-expanded="true" aria-label="Collapse card payment"><span class="card-expand-indicator" aria-hidden="true"></span></button>
              </div>
              <div id="siteFullCardFieldsForm" class="card-fields-form" role="region" aria-labelledby="siteFullCardPaymentHeading" aria-hidden="false">
                <form id="siteFullStripePaymentForm" class="stripe-payment-form">
                  <div id="siteFullPaymentElement" class="payment-element"></div>
                  <button id="siteFullStripeSubmitBtn" class="stripe-checkout-button" type="submit" disabled>Pay securely</button>
                  <p id="siteFullStripeMessage" class="stripe-note" aria-live="polite">Secure encrypted payment.</p>
                </form>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>`;
  return host;
}

const siteFullPaymentRoot = mountSiteFullPaymentSheet();

let selectedSite = null;
let searchTimer = null;
let searchRequest = 0;
let claiming = false;
let siteFullCheckoutConfig = null;
let siteFullCheckoutStripe = null;
let siteFullCheckoutElements = null;
let siteFullCheckoutCardElement = null;
let siteFullCheckoutExpressElement = null;
let siteFullCheckoutReady = false;
let siteFullCheckoutCardReady = false;
let siteFullCheckoutExpressReady = false;
let siteFullCheckoutWalletAvailable = false;
let siteFullCheckoutCardExpanded = true;
let siteFullCheckoutBusy = false;

const els = {
  unavailable: document.getElementById("trialUnavailable"),
  claimed: document.getElementById("trialClaimed"),
  siteFull: document.getElementById("trialSiteFull"),
  siteFullName: document.getElementById("trialSiteFullName"),
  siteFullBuy: document.getElementById("trialSiteFullBuy"),
  siteFullCheckoutMessage: document.getElementById("trialSiteFullCheckoutMessage"),
  siteFullPurchaseResult: document.getElementById("trialSiteFullPurchaseResult"),
  siteFullPurchasedCode: document.getElementById("trialSiteFullPurchasedCode"),
  siteFullPurchasedCodeValue: document.getElementById("trialSiteFullPurchasedCodeValue"),
  siteFullPurchasedCodeHint: document.getElementById("trialSiteFullPurchasedCodeHint"),
  siteFullPurchaseEmailStatus: document.getElementById("trialSiteFullPurchaseEmailStatus"),
  progress: document.getElementById("trialProgress"),
  form: document.getElementById("trialFormPanel"),
  emailPanel: document.getElementById("trialEmailPanel"),
  emailForm: document.getElementById("trialEmailForm"),
  email: document.getElementById("trialEmail"),
  emailMessage: document.getElementById("trialEmailMessage"),
  emailContinue: document.getElementById("trialEmailContinue"),
  emailSite: document.getElementById("trialEmailSite"),
  search: document.getElementById("trialSiteSearch"),
  results: document.getElementById("trialSiteResults"),
  selected: document.getElementById("selectedTrialSite"),
  message: document.getElementById("trialMessage"),
  helpToggle: document.getElementById("siteHelpToggle"),
  helpPanel: document.getElementById("siteHelpPanel"),
  siteFullPaymentSheet: siteFullPaymentRoot.querySelector("#siteFullPaymentMethods"),
  siteFullPaymentSheetClose: siteFullPaymentRoot.querySelector("#siteFullPaymentSheetCloseBtn"),
  siteFullPaymentSheetSubtitle: siteFullPaymentRoot.querySelector("#siteFullPaymentSheetSubtitle"),
  siteFullPaymentSheetLoader: siteFullPaymentRoot.querySelector("#siteFullPaymentSheetLoader"),
  siteFullPaymentSheetContent: siteFullPaymentRoot.querySelector("#siteFullPaymentSheetContent"),
  siteFullPaymentSheetTotal: siteFullPaymentRoot.querySelector("#siteFullPaymentSheetTotal"),
  siteFullExpressCheckout: siteFullPaymentRoot.querySelector("#siteFullExpressCheckout"),
  siteFullExpressCheckoutElement: siteFullPaymentRoot.querySelector("#siteFullExpressCheckoutElement"),
  siteFullPaymentDivider: siteFullPaymentRoot.querySelector("#siteFullPaymentDivider"),
  siteFullCardFieldsWrap: siteFullPaymentRoot.querySelector("#siteFullCardFieldsWrap"),
  siteFullCardPaymentToggle: siteFullPaymentRoot.querySelector("#siteFullCardPaymentToggle"),
  siteFullCardPoweredBy: siteFullPaymentRoot.querySelector("#siteFullCardPoweredBy"),
  siteFullCardFieldsForm: siteFullPaymentRoot.querySelector("#siteFullCardFieldsForm"),
  siteFullStripePaymentForm: siteFullPaymentRoot.querySelector("#siteFullStripePaymentForm"),
  siteFullPaymentElement: siteFullPaymentRoot.querySelector("#siteFullPaymentElement"),
  siteFullStripeSubmit: siteFullPaymentRoot.querySelector("#siteFullStripeSubmitBtn"),
  siteFullStripeMessage: siteFullPaymentRoot.querySelector("#siteFullStripeMessage")
};

function setMessage(text, tone = "") {
  els.message.textContent = text;
  els.message.className = `trial-message ${tone}`.trim();
}

function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normaliseEmail(value);
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function setEmailMessage(text, tone = "") {
  els.emailMessage.textContent = text;
  els.emailMessage.className = `trial-message ${tone}`.trim();
}

function getSiteFullCheckoutEmail() {
  const currentEmail = normaliseEmail(els.email.value);
  if (currentEmail) return currentEmail;
  try { return normaliseEmail(localStorage.getItem(EMAIL_STORAGE_KEY)); } catch (_) { return ""; }
}

function setSiteFullCheckoutMessage(text = "", tone = "") {
  els.siteFullCheckoutMessage.textContent = String(text || "");
  els.siteFullCheckoutMessage.className = `trial-site-full-checkout-message ${tone}`.trim();
}

function setSiteFullStripeMessage(text = "Secure encrypted payment.", tone = "") {
  els.siteFullStripeMessage.textContent = String(text || "");
  els.siteFullStripeMessage.className = `stripe-note ${tone}`.trim();
}

function formatSiteFullMoney(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: String(siteFullCheckoutConfig?.currency || "GBP").toUpperCase()
  }).format(Number(value) || 0);
}

function siteFullCheckoutTotal() {
  return String(siteFullCheckoutConfig?.price || "0.00");
}

function moneyToCents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function setSiteFullCheckoutLoading(loading) {
  const active = Boolean(loading);
  els.siteFullPaymentSheet.classList.toggle("is-loading", active);
  els.siteFullPaymentSheet.setAttribute("aria-busy", String(active));
  els.siteFullPaymentSheetLoader.setAttribute("aria-hidden", String(!active));
  els.siteFullPaymentSheetContent.setAttribute("aria-hidden", String(active));
}

function setSiteFullCheckoutCardExpanded(expanded) {
  siteFullCheckoutCardExpanded = Boolean(expanded);
  els.siteFullCardFieldsWrap.classList.toggle("is-condensed", !siteFullCheckoutCardExpanded);
  els.siteFullCardFieldsWrap.classList.toggle("is-expanded", siteFullCheckoutCardExpanded);
  els.siteFullCardFieldsForm.setAttribute("aria-hidden", String(!siteFullCheckoutCardExpanded));
  els.siteFullCardPoweredBy.setAttribute("aria-hidden", String(siteFullCheckoutCardExpanded));
  els.siteFullCardPaymentToggle.disabled = !siteFullCheckoutWalletAvailable;
  els.siteFullCardPaymentToggle.setAttribute("aria-hidden", String(!siteFullCheckoutWalletAvailable));
  els.siteFullCardPaymentToggle.setAttribute("aria-expanded", String(siteFullCheckoutCardExpanded));
  els.siteFullCardPaymentToggle.setAttribute("aria-label", siteFullCheckoutCardExpanded ? "Collapse card payment" : "Expand card payment");
  if ("inert" in els.siteFullStripePaymentForm) els.siteFullStripePaymentForm.inert = !siteFullCheckoutCardExpanded;
}

function setSiteFullCheckoutOpen(open) {
  const active = Boolean(open);
  els.siteFullPaymentSheet.classList.toggle("hidden", !active);
  document.body.classList.toggle("site-full-payment-open", active);
  if (active) {
    setSiteFullCheckoutCardExpanded(!siteFullCheckoutWalletAvailable);
    window.setTimeout(() => els.siteFullPaymentSheetClose.focus(), 0);
  }
}

function closeSiteFullCheckout() {
  if (siteFullCheckoutBusy) return;
  setSiteFullCheckoutOpen(false);
}

function resetSiteFullCheckoutElements() {
  try { siteFullCheckoutCardElement?.unmount(); } catch (_) {}
  try { siteFullCheckoutExpressElement?.unmount(); } catch (_) {}
  els.siteFullPaymentElement.replaceChildren();
  els.siteFullExpressCheckoutElement.replaceChildren();
  els.siteFullExpressCheckout.classList.add("hidden");
  els.siteFullPaymentDivider.classList.add("hidden");
  els.siteFullPaymentSheet.classList.remove("has-wallet-payment");
  siteFullCheckoutWalletAvailable = false;
  siteFullCheckoutElements = null;
  siteFullCheckoutCardElement = null;
  siteFullCheckoutExpressElement = null;
  siteFullCheckoutReady = false;
  siteFullCheckoutCardReady = false;
  siteFullCheckoutExpressReady = false;
  setSiteFullCheckoutCardExpanded(true);
}

function siteFullStripeAppearance() {
  return {
    theme: "night",
    variables: {
      colorPrimary: "#22d3ee",
      colorBackground: "#17202b",
      colorText: "#eef4f8",
      colorDanger: "#ed7d7d",
      colorTextSecondary: "#a9b7c7",
      borderRadius: "10px",
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    },
    rules: {
      ".Input": { border: "1px solid #435267", boxShadow: "none" },
      ".Input:focus": { border: "1px solid #22d3ee", boxShadow: "0 0 0 2px rgba(34, 211, 238, 0.18)" },
      ".Tab": { border: "1px solid #435267", boxShadow: "none" },
      ".Tab--selected": { border: "1px solid #22d3ee", boxShadow: "0 0 0 1px rgba(34, 211, 238, 0.25)" }
    }
  };
}

function siteFullWalletMethods() {
  const userAgent = navigator.userAgent || "";
  const android = /Android/i.test(userAgent);
  const ios = /iPad|iPhone|iPod/i.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return {
    applePay: android ? "never" : "always",
    googlePay: ios ? "never" : "always",
    link: "never"
  };
}

function updateSiteFullWallets(event = {}) {
  const methods = event.availablePaymentMethods || event.paymentMethods || {};
  siteFullCheckoutWalletAvailable = Boolean(methods && Object.values(methods).some(Boolean));
  els.siteFullPaymentSheet.classList.toggle("has-wallet-payment", siteFullCheckoutWalletAvailable);
  els.siteFullExpressCheckout.classList.toggle("hidden", !siteFullCheckoutWalletAvailable);
  els.siteFullPaymentDivider.classList.toggle("hidden", !siteFullCheckoutWalletAvailable);
  setSiteFullCheckoutCardExpanded(!siteFullCheckoutWalletAvailable);
}

function markSiteFullCheckoutReady() {
  if (siteFullCheckoutReady || !siteFullCheckoutCardReady || !siteFullCheckoutExpressReady) return;
  const readyElements = siteFullCheckoutElements;
  window.setTimeout(() => {
    if (siteFullCheckoutReady || siteFullCheckoutElements !== readyElements || !siteFullCheckoutCardReady || !siteFullCheckoutExpressReady) return;
    siteFullCheckoutReady = true;
    els.siteFullStripeSubmit.disabled = false;
    els.siteFullStripeSubmit.textContent = `Activate access - ${formatSiteFullMoney(siteFullCheckoutTotal())}`;
    setSiteFullCheckoutLoading(false);
  }, 120);
}

async function checkoutRequest(options = {}) {
  const response = await fetch(CHECKOUT_API, { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || "Secure checkout is unavailable. Please try again.");
    error.code = data.error || "request_failed";
    throw error;
  }
  return data;
}

async function prepareSiteFullCheckoutElements() {
  if (siteFullCheckoutReady && siteFullCheckoutElements) {
    setSiteFullCheckoutLoading(false);
    return;
  }
  if (!window.Stripe) throw new Error("Secure checkout could not load. Refresh and try again.");
  if (!siteFullCheckoutConfig) siteFullCheckoutConfig = await checkoutRequest();
  if (Number(siteFullCheckoutTotal()) <= 0) throw new Error("Paid access is unavailable right now.");

  els.siteFullPaymentSheetTotal.textContent = formatSiteFullMoney(siteFullCheckoutTotal());
  resetSiteFullCheckoutElements();
  siteFullCheckoutStripe = siteFullCheckoutStripe || window.Stripe(siteFullCheckoutConfig.publishableKey);
  siteFullCheckoutElements = siteFullCheckoutStripe.elements({
    mode: "payment",
    amount: moneyToCents(siteFullCheckoutTotal()),
    currency: String(siteFullCheckoutConfig.currency || "gbp").toLowerCase(),
    paymentMethodTypes: ["card"],
    appearance: siteFullStripeAppearance()
  });

  siteFullCheckoutExpressElement = siteFullCheckoutElements.create("expressCheckout", {
    emailRequired: false,
    layout: { maxColumns: 1, maxRows: 2, overflow: "auto" },
    paymentMethods: siteFullWalletMethods(),
    buttonHeight: 54,
    buttonTheme: { applePay: "black", googlePay: "black" }
  });
  siteFullCheckoutExpressElement.on("ready", (event) => {
    updateSiteFullWallets(event);
    siteFullCheckoutExpressReady = true;
    window.requestAnimationFrame(markSiteFullCheckoutReady);
  });
  siteFullCheckoutExpressElement.on("availablepaymentmethodschange", updateSiteFullWallets);
  siteFullCheckoutExpressElement.on("confirm", () => confirmSiteFullPurchase({ wallet: true }));
  siteFullCheckoutExpressElement.mount(els.siteFullExpressCheckoutElement);

  siteFullCheckoutCardElement = siteFullCheckoutElements.create("payment", {
    fields: { billingDetails: { email: "never" } },
    layout: { type: "tabs", defaultCollapsed: false }
  });
  siteFullCheckoutCardElement.on("ready", () => {
    siteFullCheckoutCardReady = true;
    markSiteFullCheckoutReady();
  });
  siteFullCheckoutCardElement.on("change", (event) => {
    if (event.error) setSiteFullStripeMessage(event.error.message, "bad");
    else if (els.siteFullStripeMessage.classList.contains("bad")) setSiteFullStripeMessage();
  });
  siteFullCheckoutCardElement.mount(els.siteFullPaymentElement);
}

async function beginSiteFullPurchase() {
  if (siteFullCheckoutBusy || !selectedSite) return;
  const customerEmail = getSiteFullCheckoutEmail();
  if (!isValidEmail(customerEmail)) {
    setSiteFullCheckoutMessage("Your email is missing. Choose the laundry room again and enter it to continue.", "bad");
    return;
  }

  try {
    localStorage.setItem(EMAIL_STORAGE_KEY, customerEmail);
    localStorage.setItem(SITE_FULL_CHECKOUT_CONTEXT_KEY, JSON.stringify({ site: selectedSite, email: customerEmail }));
  } catch (_) {}
  setSiteFullCheckoutMessage("");
  setSiteFullStripeMessage();
  els.siteFullPaymentSheetSubtitle.textContent = `1-year access for ${selectedSite.name}.`;
  setSiteFullCheckoutOpen(true);
  setSiteFullCheckoutLoading(true);
  els.siteFullBuy.disabled = true;
  try {
    await prepareSiteFullCheckoutElements();
    window.CircuitWashAnalytics?.track("trial_checkout_started", {
      source: "trial-site-full",
      auth_state: "anonymous",
      trial_eligibility: "unavailable"
    }, { once: "trial_site_full_checkout_started" });
  } catch (error) {
    resetSiteFullCheckoutElements();
    setSiteFullCheckoutOpen(false);
    setSiteFullCheckoutMessage(error.message || "Secure checkout could not be opened. Please try again.", "bad");
  } finally {
    els.siteFullBuy.disabled = false;
  }
}

function getCheckoutAnalyticsId(storage, key) {
  try {
    let value = storage.getItem(key);
    if (!value) {
      value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      storage.setItem(key, value);
    }
    return value;
  } catch (_) {
    return "";
  }
}

async function createSiteFullPaymentIntent() {
  if (!selectedSite?.id) throw new Error("The laundry room could not be found.");
  const customerEmail = getSiteFullCheckoutEmail();
  if (!isValidEmail(customerEmail)) throw new Error("Enter a valid email address.");
  try { localStorage.setItem(SITE_FULL_CHECKOUT_CONTEXT_KEY, JSON.stringify({ site: selectedSite, email: customerEmail })); } catch (_) {}
  return checkoutRequest({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "create_payment_intent",
      siteId: selectedSite.id,
      customerEmail,
      analyticsVisitorId: getCheckoutAnalyticsId(localStorage, ANALYTICS_VISITOR_KEY),
      analyticsSessionId: getCheckoutAnalyticsId(sessionStorage, ANALYTICS_SESSION_KEY)
    })
  });
}

function siteFullCheckoutReturnUrl() {
  return `${location.origin}/trial.html?siteFullCheckout=return`;
}

async function confirmSiteFullPurchase({ wallet = false } = {}) {
  if (!siteFullCheckoutStripe || !siteFullCheckoutElements || siteFullCheckoutBusy) return;
  siteFullCheckoutBusy = true;
  els.siteFullStripeSubmit.disabled = true;
  els.siteFullStripeSubmit.textContent = "Processing payment…";
  setSiteFullStripeMessage("Confirming payment…");
  try {
    const submitted = await siteFullCheckoutElements.submit();
    if (submitted?.error) throw submitted.error;
    const intent = await createSiteFullPaymentIntent();
    const confirmParams = { return_url: siteFullCheckoutReturnUrl() };
    if (!wallet) confirmParams.payment_method_data = { billing_details: { email: getSiteFullCheckoutEmail() } };
    const result = await siteFullCheckoutStripe.confirmPayment({
      elements: siteFullCheckoutElements,
      clientSecret: intent.clientSecret,
      confirmParams,
      redirect: "if_required"
    });
    if (result.error) throw result.error;
    if (result.paymentIntent?.status === "succeeded") {
      await completeSiteFullPurchase(result.paymentIntent.id);
    } else {
      setSiteFullStripeMessage("Payment is still processing. Please wait a moment and try again.", "bad");
    }
  } catch (error) {
    setSiteFullStripeMessage(error.message || "Your payment could not be completed. Please try again.", "bad");
  } finally {
    siteFullCheckoutBusy = false;
    els.siteFullStripeSubmit.disabled = !siteFullCheckoutReady;
    els.siteFullStripeSubmit.textContent = siteFullCheckoutConfig
      ? `Activate access - ${formatSiteFullMoney(siteFullCheckoutTotal())}`
      : "Pay securely";
  }
}

function saveSiteFullPurchase(result) {
  const purchase = {
    code: String(result.code || ""),
    orderId: String(result.orderId || ""),
    email: String(result.email || getSiteFullCheckoutEmail() || ""),
    emailSent: Boolean(result.emailSent),
    emailStatus: String(result.emailStatus || ""),
    amount: String(result.amount || ""),
    subtotal: String(result.subtotal || ""),
    discountAmount: String(result.discountAmount || ""),
    promoCode: String(result.promoCode || ""),
    accessTerm: String(result.accessTerm || ""),
    maxTotalUses: result.maxTotalUses ? Number(result.maxTotalUses) : null,
    deleteAfterUse: Boolean(result.deleteAfterUse),
    site: result.site || selectedSite || {},
    savedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem(PURCHASE_STORAGE_KEY, JSON.stringify(purchase));
    localStorage.setItem(ACTIVATE_SESSION_KEY, purchase.code);
    localStorage.setItem(EMAIL_STORAGE_KEY, purchase.email);
    localStorage.removeItem(SITE_FULL_CHECKOUT_CONTEXT_KEY);
  } catch (_) {}
  return purchase;
}

function showSiteFullPurchaseSuccess(result) {
  const purchase = saveSiteFullPurchase(result);
  setSiteFullCheckoutOpen(false);
  setSiteFullCheckoutMessage("");
  els.siteFull.querySelector(".trial-state-copy")?.classList.add("hidden");
  els.siteFull.querySelector(".state-actions")?.classList.add("hidden");
  els.siteFullPurchaseResult.classList.remove("hidden");
  els.siteFullPurchasedCodeValue.textContent = purchase.code;
  els.siteFullPurchasedCodeHint.textContent = "Tap to copy";
  els.siteFullPurchaseEmailStatus.textContent = purchase.emailSent
    ? `Code emailed to ${purchase.email} and saved on this device.`
    : `Code saved on this device. Email delivery to ${purchase.email} was not confirmed.`;
  window.CircuitWashAnalytics?.track("trial_converted_to_paid", {
    source: "trial-site-full",
    auth_state: "authenticated",
    trial_eligibility: "unavailable"
  }, { once: `trial_site_full_converted:${purchase.orderId || "purchase"}` });
}

async function completeSiteFullPurchase(paymentIntentId) {
  setSiteFullCheckoutMessage("Creating your access code…");
  setSiteFullStripeMessage("Creating your access code…");
  const result = await checkoutRequest({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete_payment_intent", paymentIntentId })
  });
  try { history.replaceState({}, "", "/trial.html"); } catch (_) {}
  if (!selectedSite && result.site) selectedSite = result.site;
  showSiteFullPurchaseSuccess(result);
}

async function restoreSiteFullCheckoutReturn() {
  const params = new URLSearchParams(location.search);
  const paymentIntentId = String(params.get("payment_intent") || "");
  if (params.get("siteFullCheckout") !== "return" || !paymentIntentId) return false;

  let checkoutContext = null;
  try {
    checkoutContext = JSON.parse(localStorage.getItem(SITE_FULL_CHECKOUT_CONTEXT_KEY) || "null");
  } catch (_) {}
  if (checkoutContext?.site) selectedSite = checkoutContext.site;
  if (isValidEmail(checkoutContext?.email)) els.email.value = normaliseEmail(checkoutContext.email);
  showSiteFull(selectedSite || { name: "this laundry room" });
  els.siteFullBuy.disabled = true;
  setSiteFullCheckoutMessage("Confirming your payment…");
  try {
    await completeSiteFullPurchase(paymentIntentId);
  } catch (error) {
    setSiteFullCheckoutMessage(error.message || "Payment was received, but the access code could not be displayed. Please contact support.", "bad");
  } finally {
    els.siteFullBuy.disabled = false;
  }
  return true;
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
  if (await restoreSiteFullCheckoutReturn()) return;
  try {
    const status = await api("status");
    if (!status.enabled) {
      els.unavailable.classList.remove("hidden");
      return;
    }
    const claim = cachedClaim();
    if (claim) {
      try {
        const session = await api("session", { trialToken: claim.token });
        if (!isValidEmail(session.email) && session.site) {
          selectedSite = session.site;
          showEmailStep(session.site);
          return;
        }
        els.claimed.classList.remove("hidden");
        return;
      } catch (_) {
        try { localStorage.removeItem(TRIAL_CLAIM_KEY); } catch (_) {}
      }
    }
    els.form.classList.remove("hidden");
    try {
      const savedEmail = localStorage.getItem(EMAIL_STORAGE_KEY);
      if (savedEmail) els.email.value = savedEmail;
    } catch (_) {}
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
  showEmailStep(site);
}

function showEmailStep(site) {
  renderSelectedSite(site, "", els.emailSite);
  setMessage("");
  setEmailMessage("");
  els.email.classList.remove("invalid");
  els.email.removeAttribute("aria-invalid");
  els.form.classList.add("hidden");
  els.emailPanel.classList.remove("hidden");
  els.progress.textContent = "2 of 2";
  document.body.classList.add("trial-email-active");
  window.setTimeout(() => els.email.focus(), 0);
}

function renderSelectedSite(site, state = "", target = els.selected) {
  target.innerHTML = "";
  const persistentClasses = target === els.emailSite ? " trial-email-site" : "";
  target.className = `selected-site${persistentClasses} ${state}`.trim();
  const check = document.createElement("span");
  check.className = "selected-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = state === "opening" ? "" : state === "error" ? "!" : "✓";
  target.appendChild(check);
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
  target.appendChild(copy);
  if (state === "opening") {
    const status = document.createElement("span");
    status.className = "selected-status";
    status.textContent = "Opening";
    target.appendChild(status);
  } else if (target === els.emailSite) {
    const changeButton = document.createElement("button");
    changeButton.type = "button";
    changeButton.className = "trial-email-site-change";
    changeButton.setAttribute("aria-label", "Change laundry room");
    changeButton.title = "Change laundry room";
    changeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16"></path><path d="M14.5 4.5 19.5 9.5 9 20H4v-5z"></path><path d="m13 6 5 5"></path></svg>';
    changeButton.addEventListener("click", returnToSiteSearch);
    target.appendChild(changeButton);
  }
}

function returnToSiteSearch() {
  if (claiming) return;
  selectedSite = null;
  els.emailPanel.classList.add("hidden");
  els.form.classList.remove("hidden");
  document.body.classList.remove("trial-email-active");
  els.progress.textContent = "1 of 2";
  els.search.disabled = false;
  els.search.value = "";
  els.selected.replaceChildren();
  els.selected.classList.add("hidden");
  setEmailMessage("");
  window.setTimeout(() => els.search.focus(), 0);
}

function showSiteFull(site) {
  const siteName = String(site?.name || "this laundry room");
  if (site?.id) selectedSite = site;
  els.form.classList.add("hidden");
  els.emailPanel.classList.add("hidden");
  document.body.classList.remove("trial-email-active");
  els.siteFullName.textContent = siteName;
  els.siteFullPaymentSheetSubtitle.textContent = `1-year access for ${siteName}.`;
  els.siteFull.querySelector(".trial-state-copy")?.classList.remove("hidden");
  els.siteFull.querySelector(".state-actions")?.classList.remove("hidden");
  els.siteFullPurchaseResult.classList.add("hidden");
  setSiteFullCheckoutMessage("");
  els.progress?.classList.add("hidden");
  document.body.classList.add("trial-site-full-active");
  els.siteFull.classList.remove("hidden");
}

async function claimTrial() {
  if (!selectedSite || claiming) return;
  const customerEmail = normaliseEmail(els.email.value);
  if (!isValidEmail(customerEmail)) {
    els.email.classList.add("invalid");
    els.email.setAttribute("aria-invalid", "true");
    setEmailMessage(customerEmail ? "Enter a valid email address to continue." : "Enter your email address to continue.", "bad");
    els.email.focus();
    return;
  }
  try { localStorage.setItem(EMAIL_STORAGE_KEY, customerEmail); } catch (_) {}
  claiming = true;
  els.email.disabled = true;
  els.emailContinue.disabled = true;
  els.emailContinue.textContent = "Preparing your free wash…";
  setEmailMessage("");
  try {
    const result = await api("claim", { siteId: selectedSite.id, browserToken: browserToken(), customerEmail });
    const claim = { token: result.trialToken, site: result.site, email: result.email || customerEmail, claimedAt: new Date().toISOString() };
    try {
      localStorage.setItem(TRIAL_CLAIM_KEY, JSON.stringify(claim));
      localStorage.setItem(EMAIL_STORAGE_KEY, claim.email);
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
      els.emailPanel.classList.add("hidden");
      document.body.classList.remove("trial-email-active");
      els.claimed.classList.remove("hidden");
      return;
    }
    if (error.code === "trial_used") {
      setEmailMessage("This free trial has already been used in this browser.", "bad");
      renderSelectedSite(selectedSite, "error", els.emailSite);
      return;
    }
    if (error.code === "trial_disabled") {
      els.form.classList.add("hidden");
      els.emailPanel.classList.add("hidden");
      document.body.classList.remove("trial-email-active");
      els.unavailable.classList.remove("hidden");
      return;
    }
    if (error.code === "site_trial_limit_reached") {
      showSiteFull(selectedSite);
      return;
    } else {
      setEmailMessage(error.message, "bad");
    }
    renderSelectedSite(selectedSite, "error", els.emailSite);
  } finally {
    claiming = false;
    els.email.disabled = false;
    els.emailContinue.disabled = false;
    els.emailContinue.innerHTML = 'Continue to your free wash <span aria-hidden="true">&rarr;</span>';
  }
}

els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  selectedSite = null;
  els.selected.classList.add("hidden");
  searchTimer = setTimeout(searchSites, 230);
});

els.helpToggle?.addEventListener("click", () => {
  const expanded = els.helpToggle.getAttribute("aria-expanded") === "true";
  els.helpToggle.setAttribute("aria-expanded", String(!expanded));
  els.helpPanel?.setAttribute("aria-hidden", String(expanded));
});

els.siteFullBuy?.addEventListener("click", beginSiteFullPurchase);
els.siteFullPaymentSheetClose?.addEventListener("click", closeSiteFullCheckout);
siteFullPaymentRoot.querySelectorAll("[data-close-site-full-payment]").forEach((element) => element.addEventListener("click", closeSiteFullCheckout));
els.siteFullCardPaymentToggle?.addEventListener("click", () => {
  if (!siteFullCheckoutWalletAvailable) return;
  setSiteFullCheckoutCardExpanded(!siteFullCheckoutCardExpanded);
});
els.siteFullStripePaymentForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  confirmSiteFullPurchase();
});
els.siteFullPurchasedCode?.addEventListener("click", async () => {
  const code = els.siteFullPurchasedCodeValue.textContent.trim();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    els.siteFullPurchasedCodeHint.textContent = "Copied";
  } catch (_) {
    els.siteFullPurchasedCodeHint.textContent = "Press and hold to copy";
  }
});
els.emailForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  claimTrial();
});
els.email?.addEventListener("input", () => {
  els.email.classList.remove("invalid");
  els.email.removeAttribute("aria-invalid");
  setEmailMessage("");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.siteFullPaymentSheet.classList.contains("hidden")) closeSiteFullCheckout();
});

initialise();
