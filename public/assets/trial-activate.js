const TRIAL_API = "/.netlify/functions/free-trial";
const SITE_API = "/.netlify/functions/public-sites";
const TRIAL_CLAIM_KEY = "zaftFreeTrialClaim";
const SERVICE_UUID = "569a1101-b87f-490c-92cb-11ba5ea5167c";
const RX_UUID = "569a2000-b87f-490c-92cb-11ba5ea5167c";
const TX_UUID = "569a2001-b87f-490c-92cb-11ba5ea5167c";
const OCCUPANCY_UUID = "00002a37-0000-1000-8000-00805f9b34fb";
const HEART_RATE_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb";
const BLUEFY_APP_STORE_URL = "https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055";
const BLUEFY_OPEN_FALLBACK_MS = 1400;
const BLUEFY_PENDING_URL_KEY = "zaftPendingBluefyTrialUrl";
const BLUEFY_PENDING_RETRY_KEY = "zaftPendingBluefyTrialRetryAt";
const BLUEFY_PENDING_RETRY_MS = 2500;
const TRIAL_PURCHASE_ENDPOINT = "/.netlify/functions/stripe-checkout";
const PURCHASE_STORAGE_KEY = "laundryAccessPurchase";
const EMAIL_STORAGE_KEY = "laundryAccessEmail";
const ACTIVATE_SESSION_KEY = "laundryActivateAccessCode";
const ANALYTICS_VISITOR_KEY = "laundryAnalyticsVisitor";
const ANALYTICS_SESSION_KEY = "laundryAnalyticsSession";
const CMD = {
  HANDSHAKE: "[HANDSHAKE:ENABLE]",
  VERSION: "[VERSION]",
  COIN_DISABLE: "[COIN:DISABLE:OCCUPIED_LOW]",
  EXEC: "[EXEC]"
};
const DEFAULT_WASHER_CYCLES = {
  standardEco: "Standard Eco",
  extraWash: "Extra Wash",
  extraWashRinse: "Extra Wash + Rinse"
};

function mountTrialPurchasePaymentSheet() {
  const host = document.getElementById("trialPurchasePaymentHost");
  host.innerHTML = `
    <div id="trialPaymentMethods" class="payment-sheet hidden" role="dialog" aria-modal="true" aria-labelledby="trialPaymentSheetTitle">
      <div class="payment-sheet-backdrop" data-close-trial-payment-sheet></div>
      <div class="payment-sheet-panel">
        <div class="payment-sheet-header">
          <div>
            <h2 id="trialPaymentSheetTitle">Choose payment method</h2>
            <p id="trialPaymentSheetSubtitle">1-year access for this laundry room.</p>
          </div>
          <button id="trialPaymentSheetCloseBtn" class="payment-sheet-close" type="button" aria-label="Close payment options">Close</button>
        </div>
        <div id="trialPaymentSheetLoader" class="payment-sheet-loader" role="status" aria-live="polite" aria-hidden="true">
          <div class="checkout-loading-spinner" aria-hidden="true"></div>
          <strong>Preparing secure checkout</strong>
          <span>Loading payment options...</span>
        </div>
        <div id="trialPaymentSheetContent" class="payment-sheet-content">
          <div class="payment-sheet-total" aria-live="polite"><span>Total</span><strong id="trialPaymentSheetTotal">&mdash;</strong></div>
          <div class="stripe-checkout-panel">
            <section id="trialExpressCheckout" class="express-checkout hidden" aria-labelledby="trialExpressCheckoutHeading">
              <p id="trialExpressCheckoutHeading" class="payment-method-label">Express checkout</p>
              <div id="trialExpressCheckoutElement"></div>
            </section>
            <div id="trialPaymentDivider" class="payment-divider hidden"><span>Or pay with card</span></div>
            <section id="trialCardFieldsWrap" class="stripe-payment-method" aria-labelledby="trialCardPaymentHeading">
              <div class="card-method-header">
                <div class="card-method-copy"><span class="card-method-icon" aria-hidden="true"></span><div class="card-method-title"><h3 id="trialCardPaymentHeading">Card payment</h3><span id="trialCardPoweredBy" class="card-powered-by">Secure checkout</span></div></div>
                <button id="trialCardPaymentToggle" class="card-expand-button" type="button" aria-controls="trialCardFieldsForm" aria-expanded="true" aria-label="Collapse card payment"><span class="card-expand-indicator" aria-hidden="true"></span></button>
              </div>
              <div id="trialCardFieldsForm" class="card-fields-form" role="region" aria-labelledby="trialCardPaymentHeading" aria-hidden="false">
                <form id="trialStripePaymentForm" class="stripe-payment-form">
                  <div id="trialPaymentElement" class="payment-element"></div>
                  <button id="trialStripeSubmitBtn" class="stripe-checkout-button" type="submit" disabled>Pay securely</button>
                  <p id="trialStripeMessage" class="stripe-note" aria-live="polite">Secure encrypted payment.</p>
                </form>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>`;
  return host;
}

const trialPurchasePaymentRoot = mountTrialPurchasePaymentSheet();

const els = {
  root: document.getElementById("trialActivateRoot"),
  title: document.getElementById("trialSiteTitle"),
  changeSite: document.getElementById("changeTrialSiteBtn"),
  loading: document.getElementById("trialLoading"),
  error: document.getElementById("trialError"),
  errorTitle: document.getElementById("trialErrorTitle"),
  errorText: document.getElementById("trialErrorText"),
  trialPill: document.getElementById("trialPill"),
  outcome: document.getElementById("trialOutcome"),
  outcomeTitle: document.getElementById("trialOutcomeTitle"),
  outcomeCycle: document.getElementById("trialOutcomeCycle"),
  outcomeReassurance: document.getElementById("trialOutcomeReassurance"),
  completionStatus: document.getElementById("trialCompletionStatus"),
  accessOffer: document.getElementById("trialAccessOffer"),
  purchaseCta: document.getElementById("trialPurchaseCta"),
  purchaseOfferContent: document.getElementById("trialPurchaseOfferContent"),
  purchaseMessage: document.getElementById("trialPurchaseMessage"),
  purchaseResult: document.getElementById("trialPurchaseResult"),
  purchasedCode: document.getElementById("trialPurchasedCode"),
  purchasedCodeValue: document.getElementById("trialPurchasedCodeValue"),
  purchasedCodeHint: document.getElementById("trialPurchasedCodeHint"),
  purchaseEmailStatus: document.getElementById("trialPurchaseEmailStatus"),
  purchaseUseCode: document.getElementById("trialPurchaseUseCode"),
  outcomeActions: document.getElementById("trialOutcomeActions"),
  outcomeRetry: document.getElementById("trialOutcomeRetry"),
  outcomeDone: document.getElementById("trialOutcomeDone"),
  controls: document.getElementById("trialControls"),
  status: document.getElementById("trialStatus"),
  connectionModule: document.getElementById("trialConnectionModule"),
  connectionTitle: document.getElementById("trialConnectionTitle"),
  deviceMap: document.getElementById("trialDeviceMap"),
  connect: document.getElementById("trialConnectBtn"),
  cycles: document.getElementById("trialMachineButtons"),
  cycleSection: document.getElementById("trialCycleSection"),
  cycleHint: document.getElementById("trialCycleHint"),
  machinePicker: document.getElementById("trialMachinePickerOverlay"),
  machinePickerList: document.getElementById("trialMachinePickerList"),
  closeMachinePicker: document.getElementById("closeTrialMachinePickerBtn"),
  inUse: document.getElementById("trialInUseNotice"),
  activity: document.getElementById("trialActivity"),
  activityText: document.getElementById("trialActivityText"),
  allowance: document.getElementById("trialAllowanceText"),
  modal: document.getElementById("trialSiteModal"),
  closeModal: document.getElementById("closeTrialSiteModal"),
  search: document.getElementById("trialChangeSiteSearch"),
  searchSpinner: document.getElementById("trialChangeSiteSearchSpinner"),
  results: document.getElementById("trialChangeSiteResults"),
  siteMessage: document.getElementById("trialChangeSiteMessage"),
  trialPaymentSheet: trialPurchasePaymentRoot.querySelector("#trialPaymentMethods"),
  trialPaymentSheetClose: trialPurchasePaymentRoot.querySelector("#trialPaymentSheetCloseBtn"),
  trialPaymentSheetSubtitle: trialPurchasePaymentRoot.querySelector("#trialPaymentSheetSubtitle"),
  trialPaymentSheetLoader: trialPurchasePaymentRoot.querySelector("#trialPaymentSheetLoader"),
  trialPaymentSheetContent: trialPurchasePaymentRoot.querySelector("#trialPaymentSheetContent"),
  trialPaymentSheetTotal: trialPurchasePaymentRoot.querySelector("#trialPaymentSheetTotal"),
  trialExpressCheckout: trialPurchasePaymentRoot.querySelector("#trialExpressCheckout"),
  trialExpressCheckoutElement: trialPurchasePaymentRoot.querySelector("#trialExpressCheckoutElement"),
  trialPaymentDivider: trialPurchasePaymentRoot.querySelector("#trialPaymentDivider"),
  trialCardFieldsWrap: trialPurchasePaymentRoot.querySelector("#trialCardFieldsWrap"),
  trialCardPaymentToggle: trialPurchasePaymentRoot.querySelector("#trialCardPaymentToggle"),
  trialCardPoweredBy: trialPurchasePaymentRoot.querySelector("#trialCardPoweredBy"),
  trialCardFieldsForm: trialPurchasePaymentRoot.querySelector("#trialCardFieldsForm"),
  trialStripePaymentForm: trialPurchasePaymentRoot.querySelector("#trialStripePaymentForm"),
  trialPaymentElement: trialPurchasePaymentRoot.querySelector("#trialPaymentElement"),
  trialStripeSubmit: trialPurchasePaymentRoot.querySelector("#trialStripeSubmitBtn"),
  trialStripeMessage: trialPurchasePaymentRoot.querySelector("#trialStripeMessage")
};

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });
const cycleButtons = [];
let claim = null;
let trialToken = "";
let machines = [];
let selectedMachineKey = "";
let connectedDeviceName = "";
let searchTimer = null;
let device = null;
let server = null;
let service = null;
let rxChar = null;
let txChar = null;
let rxBuf = new Uint8Array(0);
let messageQueue = [];
let waiters = [];
let completed = false;
let iosBluefyPromptRequested = false;
let bluefyCopyToastTimer = null;
let machinePickerReturnFocus = null;
let currentSite = null;
let currentOutcomeContext = null;
let bluetoothFailureStage = "idle";
let unexpectedBluetoothDisconnectReported = false;
let trialPurchaseConfig = null;
let trialPurchaseStripe = null;
let trialPurchaseElements = null;
let trialPurchaseCardElement = null;
let trialPurchaseExpressElement = null;
let trialPurchaseReady = false;
let trialPurchaseCardReady = false;
let trialPurchaseExpressReady = false;
let trialPurchaseWalletAvailable = false;
let trialPurchaseCardExpanded = true;
let trialPurchaseBusy = false;

const trialSiteSelector = window.CircuitWashSiteSelector.create({
  input: els.search,
  results: els.results,
  spinner: els.searchSpinner,
  formatAddress: window.CircuitWashSiteSelector.formatAddress,
  currentSiteId: () => currentSite?.id || "",
  onSelect: (site, button, state) => {
    if (state.selected || String(site.id || "") === String(currentSite?.id || "")) closeSiteModal();
    else changeSite(site, button);
  }
});

function readClaim() {
  try {
    const raw = localStorage.getItem(TRIAL_CLAIM_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved?.token) return saved;
  } catch (_) {
    // Fall through to the URL fragment fallback below.
  }
  const params = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  const token = String(params.get("trial") || "").trim();
  if (!token) return null;
  const nextClaim = { token, claimedAt: new Date().toISOString() };
  try { localStorage.setItem(TRIAL_CLAIM_KEY, JSON.stringify(nextClaim)); } catch (_) {}
  try { history.replaceState({}, "", `${location.pathname}${location.search}`); } catch (_) {}
  return nextClaim;
}

function saveClaim(nextClaim) {
  claim = nextClaim;
  try { localStorage.setItem(TRIAL_CLAIM_KEY, JSON.stringify(nextClaim)); } catch (_) {}
}

async function api(action, payload = {}) {
  const response = await fetch(TRIAL_API, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, trialToken, ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || "Activation could not be loaded.");
    error.code = data.error || "request_failed";
    error.status = response.status;
    throw error;
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function machineKey(machine) {
  return String(machine?.id || machine?.name || "");
}

function reportBluetoothFailure(eventName, { stage, error, machine, bluetoothDeviceName } = {}) {
  const tracker = window.CircuitWashAnalytics;
  if (!tracker?.track) return;
  const failure = error || new Error("Bluetooth operation failed");
  const failureStage = String(stage || bluetoothFailureStage || "unknown");
  const rawErrorCode = String(failure?.code || failure?.name || "");
  tracker.track(eventName, {
    source: "trial-activation",
    auth_state: "anonymous",
    trial_eligibility: "claimed",
    site_id: String(currentSite?.id || ""),
    site_name: String(currentSite?.name || ""),
    machine_id: machineKey(machine),
    machine_name: String(machine?.name || ""),
    bluetooth_device_name: String(bluetoothDeviceName || connectedDeviceName || machine?.bluetoothName || ""),
    failure_stage: failureStage,
    error_code: !rawErrorCode || rawErrorCode === "Error" ? `${failureStage}_failed` : rawErrorCode,
    error_message: String(failure?.message || failure || "Bluetooth operation failed")
  });
}

function isBluetoothChooserCancellation(stage, error) {
  // Some Bluetooth browsers report chooser cancellation only as "Device Request Failed".
  // Until requestDevice() returns a device, there is no reliable failure/cancel distinction.
  return stage === "device_request";
}

function selectedMachine() {
  return machines.find((machine) => machineKey(machine) === selectedMachineKey) || null;
}

function machineType(machine) {
  const type = String(machine?.type || "").trim().toLowerCase();
  return type === "washer" ? "washer" : type === "dryer" ? "dryer" : "machine";
}

function machineTypeLabel(machine) {
  const type = machineType(machine);
  return type === "washer" ? "Washer" : type === "dryer" ? "Dryer" : "Machine";
}

function machineIconMarkup(machine) {
  const type = machineType(machine);
  if (type === "washer" || type === "dryer") {
    return `<img class="machine-image machine-image-${type}" src="/assets/${type}.svg" alt="" aria-hidden="true" draggable="false">`;
  }
  return '<svg class="machine-symbol" viewBox="0 0 32 32" aria-hidden="true"><rect x="5.5" y="3" width="21" height="26" rx="4"></rect><path d="M6 10.5h20"></path><circle cx="10.5" cy="7" r="1"></circle><path d="M15 7h7"></path><circle cx="16" cy="19.5" r="7"></circle></svg>';
}

function machineCycles(machine) {
  const cycles = machine?.cycles || {};
  if (machine?.type === "washer" && Object.keys(cycles).length === 1 && cycles.full) return DEFAULT_WASHER_CYCLES;
  return cycles;
}

function cycleLabel(key, value) {
  if (typeof value === "string") return value;
  return value?.label || key;
}

function setActivity(main, sub = "", tone = "") {
  els.activityText.textContent = sub ? `${main} - ${sub}` : main;
  els.activity.className = `activity-strip ${tone}`.trim();
}

function setStatus(text, tone = "") {
  const machineName = selectedMachine()?.name || "machine";
  const normalised = String(text || "").trim();
  const lower = normalised.toLowerCase();
  let state = "ready";
  let title = "Ready to connect";

  if (lower.includes("connecting")) {
    state = "connecting";
    title = `Connecting to ${machineName}…`;
  } else if (lower.includes("starting")) {
    state = "starting";
    title = `Starting ${machineName}…`;
  } else if (lower.includes("started") || lower.includes("activated")) {
    state = "started";
    title = `${machineName} started`;
  } else if (tone === "ok" || (lower.includes("connected") && !lower.includes("not connected"))) {
    state = "connected";
    title = `Connected to ${machineName}`;
  } else if (tone === "bad" || lower.includes("couldn") || lower.includes("unavailable")) {
    state = lower.includes("couldn’t start") || lower.includes("couldn't start") ? "start-error" : "error";
    title = lower.includes("bluetooth unavailable") ? "Bluetooth unavailable" : normalised || `Couldn’t connect to ${machineName}`;
  } else if (tone === "warn" || lower.includes("in use") || lower.includes("limit")) {
    state = "warning";
    title = lower.includes("in use") ? `${machineName} is in use` : normalised;
  }

  els.connectionModule.dataset.state = state;
  els.status.className = `status-pill ${tone}`.trim();
  els.status.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(normalised || title)}</span>`;
  els.connectionTitle.textContent = title;
  els.allowance.classList.toggle("is-visible", state === "started");
  updateConnectLabel();
}

function showError(title, text) {
  els.root.classList.remove("post-activation-success");
  els.root.classList.remove("trial-outcome-active");
  els.loading.classList.add("hidden");
  els.controls.classList.add("hidden");
  els.outcome.classList.add("hidden");
  els.errorTitle.textContent = title;
  els.errorText.textContent = text;
  els.error.classList.remove("hidden");
  els.changeSite.disabled = true;
  setActivity("Activation unavailable", "", "warn");
}

function outcomeContext({ machine = null, cycleKey = "", cycleLabel: label = "", activation = null, activatedAt = "" } = {}) {
  const resolvedMachine = machine || activation?.machine || selectedMachine();
  const resolvedCycleKey = String(cycleKey || activation?.cycle?.key || "");
  const rawCycleLabel = String(label || activation?.cycle?.label || "");
  const cycle = rawCycleLabel
    ? cyclePresentation(resolvedMachine, resolvedCycleKey, rawCycleLabel)
    : null;
  return {
    activationId: String(activation?.id || ""),
    machine: resolvedMachine,
    machineId: machineKey(resolvedMachine),
    machineName: String(resolvedMachine?.name || ""),
    cycleKey: resolvedCycleKey,
    cycleLabel: rawCycleLabel,
    cycleSummary: cycle ? `${cycle.title}${cycle.meta ? ` · ${cycle.meta}` : ""}` : "",
    site: currentSite || claim?.site || null,
    timestamp: String(activatedAt || activation?.activatedAt || activation?.preparedAt || new Date().toISOString())
  };
}

function renderContinuationPrompt() {
  if (!currentSite) return;
  els.trialPaymentSheetSubtitle.textContent = `1-year access for ${currentSite.name}.`;
}

function normaliseTrialPurchaseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidTrialPurchaseEmail(value) {
  const email = normaliseTrialPurchaseEmail(value);
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getTrialPurchaseEmail() {
  const claimedEmail = normaliseTrialPurchaseEmail(claim?.email);
  if (claimedEmail) return claimedEmail;
  try { return normaliseTrialPurchaseEmail(localStorage.getItem(EMAIL_STORAGE_KEY)); } catch (_) { return ""; }
}

function setTrialPurchaseMessage(text = "", tone = "") {
  els.purchaseMessage.textContent = String(text || "");
  els.purchaseMessage.className = `trial-purchase-message ${tone}`.trim();
}

function setTrialStripeMessage(text = "Secure encrypted payment.", tone = "") {
  els.trialStripeMessage.textContent = String(text || "");
  els.trialStripeMessage.className = `stripe-note ${tone}`.trim();
}

function formatTrialPurchaseMoney(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: trialPurchaseConfig?.currency || "GBP"
  }).format(Number(value) || 0);
}

function trialPurchaseTotal() {
  return String(trialPurchaseConfig?.price || "0.00");
}

function moneyToCents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function setTrialPurchaseLoading(loading) {
  const active = Boolean(loading);
  els.trialPaymentSheet.classList.toggle("is-loading", active);
  els.trialPaymentSheet.setAttribute("aria-busy", String(active));
  els.trialPaymentSheetLoader.setAttribute("aria-hidden", String(!active));
  els.trialPaymentSheetContent.setAttribute("aria-hidden", String(active));
}

function setTrialPurchaseSheetOpen(open) {
  const active = Boolean(open);
  els.trialPaymentSheet.classList.toggle("hidden", !active);
  document.body.classList.toggle("trial-purchase-payment-open", active);
  if (active) {
    setTrialPurchaseCardExpanded(!trialPurchaseWalletAvailable);
    window.setTimeout(() => els.trialPaymentSheetClose.focus(), 0);
  }
}

function setTrialPurchaseCardExpanded(expanded) {
  trialPurchaseCardExpanded = Boolean(expanded);
  els.trialCardFieldsWrap.classList.toggle("is-condensed", !trialPurchaseCardExpanded);
  els.trialCardFieldsWrap.classList.toggle("is-expanded", trialPurchaseCardExpanded);
  els.trialCardFieldsForm.setAttribute("aria-hidden", String(!trialPurchaseCardExpanded));
  els.trialCardPoweredBy.setAttribute("aria-hidden", String(trialPurchaseCardExpanded));
  els.trialCardPaymentToggle.disabled = !trialPurchaseWalletAvailable;
  els.trialCardPaymentToggle.setAttribute("aria-hidden", String(!trialPurchaseWalletAvailable));
  els.trialCardPaymentToggle.setAttribute("aria-expanded", String(trialPurchaseCardExpanded));
  els.trialCardPaymentToggle.setAttribute("aria-label", trialPurchaseCardExpanded ? "Collapse card payment" : "Expand card payment");
  if ("inert" in els.trialStripePaymentForm) els.trialStripePaymentForm.inert = !trialPurchaseCardExpanded;
}

function closeTrialPurchaseSheet() {
  if (trialPurchaseBusy) return;
  setTrialPurchaseSheetOpen(false);
}

function resetTrialPurchaseElements() {
  try { trialPurchaseCardElement?.unmount(); } catch (_) {}
  try { trialPurchaseExpressElement?.unmount(); } catch (_) {}
  els.trialPaymentElement.replaceChildren();
  els.trialExpressCheckoutElement.replaceChildren();
  els.trialExpressCheckout.classList.add("hidden");
  els.trialPaymentDivider.classList.add("hidden");
  els.trialPaymentSheet.classList.remove("has-wallet-payment");
  trialPurchaseWalletAvailable = false;
  trialPurchaseElements = null;
  trialPurchaseCardElement = null;
  trialPurchaseExpressElement = null;
  trialPurchaseReady = false;
  trialPurchaseCardReady = false;
  trialPurchaseExpressReady = false;
  setTrialPurchaseCardExpanded(true);
}

function trialPurchaseStripeAppearance() {
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

function trialPurchaseWalletMethods() {
  const userAgent = navigator.userAgent || "";
  const android = /Android/i.test(userAgent);
  const ios = /iPad|iPhone|iPod/i.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return {
    applePay: android ? "never" : "always",
    googlePay: ios ? "never" : "always",
    link: "never"
  };
}

function updateTrialPurchaseWallets(event = {}) {
  const methods = event.availablePaymentMethods || event.paymentMethods || {};
  trialPurchaseWalletAvailable = Boolean(methods && Object.values(methods).some(Boolean));
  els.trialPaymentSheet.classList.toggle("has-wallet-payment", trialPurchaseWalletAvailable);
  els.trialExpressCheckout.classList.toggle("hidden", !trialPurchaseWalletAvailable);
  els.trialPaymentDivider.classList.toggle("hidden", !trialPurchaseWalletAvailable);
  setTrialPurchaseCardExpanded(!trialPurchaseWalletAvailable);
}

function markTrialPurchaseReady() {
  if (trialPurchaseReady || !trialPurchaseCardReady || !trialPurchaseExpressReady) return;
  const readyElements = trialPurchaseElements;
  window.setTimeout(() => {
    if (trialPurchaseReady || trialPurchaseElements !== readyElements || !trialPurchaseCardReady || !trialPurchaseExpressReady) return;
    trialPurchaseReady = true;
    els.trialStripeSubmit.disabled = false;
    els.trialStripeSubmit.textContent = `Activate access - ${formatTrialPurchaseMoney(trialPurchaseTotal())}`;
    setTrialPurchaseLoading(false);
  }, 120);
}

async function trialCheckoutRequest(options = {}) {
  const response = await fetch(TRIAL_PURCHASE_ENDPOINT, { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || "Secure checkout is unavailable. Please try again.");
    error.code = data.error || "request_failed";
    throw error;
  }
  return data;
}

async function prepareTrialPurchaseElements() {
  if (trialPurchaseReady && trialPurchaseElements) {
    setTrialPurchaseLoading(false);
    return;
  }
  if (!window.Stripe) throw new Error("Secure checkout could not load. Refresh and try again.");
  if (!trialPurchaseConfig) trialPurchaseConfig = await trialCheckoutRequest();
  if (Number(trialPurchaseTotal()) <= 0) throw new Error("Paid access is unavailable right now.");

  els.trialPaymentSheetTotal.textContent = formatTrialPurchaseMoney(trialPurchaseTotal());
  resetTrialPurchaseElements();
  trialPurchaseStripe = trialPurchaseStripe || window.Stripe(trialPurchaseConfig.publishableKey);
  trialPurchaseElements = trialPurchaseStripe.elements({
    mode: "payment",
    amount: moneyToCents(trialPurchaseTotal()),
    currency: trialPurchaseConfig.currency.toLowerCase(),
    paymentMethodTypes: ["card"],
    appearance: trialPurchaseStripeAppearance()
  });

  trialPurchaseExpressElement = trialPurchaseElements.create("expressCheckout", {
    emailRequired: true,
    layout: { maxColumns: 1, maxRows: 2, overflow: "auto" },
    paymentMethods: trialPurchaseWalletMethods(),
    buttonHeight: 54,
    buttonTheme: { applePay: "black", googlePay: "black" }
  });
  trialPurchaseExpressElement.on("ready", (event) => {
    updateTrialPurchaseWallets(event);
    trialPurchaseExpressReady = true;
    window.requestAnimationFrame(markTrialPurchaseReady);
  });
  trialPurchaseExpressElement.on("availablepaymentmethodschange", updateTrialPurchaseWallets);
  trialPurchaseExpressElement.on("confirm", () => confirmTrialPurchase({ wallet: true }));
  trialPurchaseExpressElement.mount(els.trialExpressCheckoutElement);

  trialPurchaseCardElement = trialPurchaseElements.create("payment", {
    fields: { billingDetails: { email: "never" } },
    layout: { type: "tabs", defaultCollapsed: false }
  });
  trialPurchaseCardElement.on("ready", () => {
    trialPurchaseCardReady = true;
    markTrialPurchaseReady();
  });
  trialPurchaseCardElement.on("change", (event) => {
    if (event.error) setTrialStripeMessage(event.error.message, "bad");
    else if (els.trialStripeMessage.classList.contains("bad")) setTrialStripeMessage();
  });
  trialPurchaseCardElement.mount(els.trialPaymentElement);
}

async function beginTrialPurchase() {
  if (trialPurchaseBusy || !currentSite) return;
  const customerEmail = getTrialPurchaseEmail();
  if (!isValidTrialPurchaseEmail(customerEmail)) {
    setTrialPurchaseMessage("Your trial email is missing. Please return to the free-trial page and enter it again.", "bad");
    return;
  }

  setTrialPurchaseMessage("");
  setTrialStripeMessage();
  setTrialPurchaseSheetOpen(true);
  setTrialPurchaseLoading(true);
  els.purchaseCta.disabled = true;
  try {
    await prepareTrialPurchaseElements();
    window.CircuitWashAnalytics?.track("trial_checkout_started", {
      source: "trial-completion-offer",
      auth_state: "authenticated",
      trial_eligibility: "used"
    }, { once: "trial_checkout_started" });
  } catch (error) {
    resetTrialPurchaseElements();
    setTrialPurchaseSheetOpen(false);
    setTrialPurchaseMessage(error.message || "Secure checkout could not be opened. Please try again.", "bad");
  } finally {
    els.purchaseCta.disabled = false;
  }
}

function getTrialPurchaseAnalyticsId(storage, key) {
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

async function createTrialPurchaseIntent() {
  if (!currentSite) throw new Error("The laundry room could not be found.");
  const customerEmail = getTrialPurchaseEmail();
  if (!isValidTrialPurchaseEmail(customerEmail)) throw new Error("Enter a valid email address.");
  return trialCheckoutRequest({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "create_payment_intent",
      siteId: currentSite.id,
      customerEmail,
      analyticsVisitorId: getTrialPurchaseAnalyticsId(localStorage, ANALYTICS_VISITOR_KEY),
      analyticsSessionId: getTrialPurchaseAnalyticsId(sessionStorage, ANALYTICS_SESSION_KEY)
    })
  });
}

function trialPurchaseReturnUrl() {
  return `${location.origin}/trial-activate.html?trialCheckout=return`;
}

async function confirmTrialPurchase({ wallet = false } = {}) {
  if (!trialPurchaseStripe || !trialPurchaseElements || trialPurchaseBusy) return;
  trialPurchaseBusy = true;
  els.trialStripeSubmit.disabled = true;
  els.trialStripeSubmit.textContent = "Processing payment…";
  setTrialStripeMessage("Confirming payment…");
  try {
    const submitted = await trialPurchaseElements.submit();
    if (submitted?.error) throw submitted.error;
    const intent = await createTrialPurchaseIntent();
    const confirmParams = { return_url: trialPurchaseReturnUrl() };
    if (!wallet) {
      confirmParams.payment_method_data = { billing_details: { email: getTrialPurchaseEmail() } };
    }
    const result = await trialPurchaseStripe.confirmPayment({
      elements: trialPurchaseElements,
      clientSecret: intent.clientSecret,
      confirmParams,
      redirect: "if_required"
    });
    if (result.error) throw result.error;
    if (result.paymentIntent?.status === "succeeded") {
      await completeTrialPurchase(result.paymentIntent.id);
    } else {
      setTrialStripeMessage("Payment is still processing. Please wait a moment and try again.", "bad");
    }
  } catch (error) {
    setTrialStripeMessage(error.message || "Your payment could not be completed. Please try again.", "bad");
  } finally {
    trialPurchaseBusy = false;
    els.trialStripeSubmit.disabled = !trialPurchaseReady;
    els.trialStripeSubmit.textContent = trialPurchaseConfig
      ? `Activate access - ${formatTrialPurchaseMoney(trialPurchaseTotal())}`
      : "Pay securely";
  }
}

function saveTrialPurchase(result) {
  const purchase = {
    code: String(result.code || ""),
    orderId: String(result.orderId || ""),
    email: String(result.email || getTrialPurchaseEmail() || ""),
    emailSent: Boolean(result.emailSent),
    emailStatus: String(result.emailStatus || ""),
    amount: String(result.amount || ""),
    subtotal: String(result.subtotal || ""),
    discountAmount: String(result.discountAmount || ""),
    promoCode: String(result.promoCode || ""),
    accessTerm: String(result.accessTerm || ""),
    maxTotalUses: result.maxTotalUses ? Number(result.maxTotalUses) : null,
    deleteAfterUse: Boolean(result.deleteAfterUse),
    site: result.site || currentSite || {},
    savedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem(PURCHASE_STORAGE_KEY, JSON.stringify(purchase));
    localStorage.setItem(ACTIVATE_SESSION_KEY, purchase.code);
    localStorage.setItem(EMAIL_STORAGE_KEY, purchase.email);
  } catch (_) {}
  return purchase;
}

function showTrialPurchaseSuccess(result) {
  const purchase = saveTrialPurchase(result);
  setTrialPurchaseSheetOpen(false);
  setTrialPurchaseMessage("");
  els.purchaseOfferContent.classList.add("hidden");
  els.purchaseResult.classList.remove("hidden");
  els.accessOffer.setAttribute("aria-labelledby", "trialPurchaseResultTitle");
  els.purchasedCodeValue.textContent = purchase.code;
  els.purchasedCodeHint.textContent = "Tap to copy";
  els.purchaseEmailStatus.textContent = purchase.emailSent
    ? `Code emailed to ${purchase.email} and saved on this device.`
    : `Code saved on this device. Email delivery to ${purchase.email} was not confirmed.`;
  els.purchaseUseCode.href = "/activate.html";
  window.CircuitWashAnalytics?.track("trial_converted_to_paid", {
    source: "trial-completion-offer",
    auth_state: "authenticated",
    trial_eligibility: "used"
  }, { once: `trial_converted_to_paid:${purchase.orderId || "purchase"}` });
}

async function completeTrialPurchase(paymentIntentId) {
  setTrialPurchaseMessage("Creating your access code…");
  setTrialStripeMessage("Creating your access code…");
  const result = await trialCheckoutRequest({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete_payment_intent", paymentIntentId })
  });
  try { history.replaceState({}, "", "/trial-activate.html"); } catch (_) {}
  showTrialPurchaseSuccess(result);
}

async function restoreTrialPurchaseReturn() {
  const params = new URLSearchParams(location.search);
  const paymentIntentId = String(params.get("payment_intent") || "");
  if (params.get("trialCheckout") !== "return" || !paymentIntentId) return;
  els.purchaseCta.disabled = true;
  setTrialPurchaseMessage("Confirming your payment…");
  try {
    await completeTrialPurchase(paymentIntentId);
  } catch (error) {
    setTrialPurchaseMessage(error.message || "Payment was received, but the access code could not be displayed. Please contact support.", "bad");
  } finally {
    els.purchaseCta.disabled = false;
  }
}

function showActivationOutcome(state, context = {}) {
  const details = outcomeContext(context);
  currentOutcomeContext = details;
  completed = state === "success" || state === "uncertain";
  els.loading.classList.add("hidden");
  els.error.classList.add("hidden");
  els.controls.classList.add("hidden");
  els.outcome.classList.remove("hidden");
  els.outcome.dataset.state = state;
  els.root.classList.add("trial-outcome-active");
  els.root.classList.toggle("post-activation-success", state === "success");
  els.changeSite.disabled = true;
  els.outcomeCycle.textContent = details.cycleSummary;
  els.outcomeCycle.classList.toggle("hidden", !details.cycleSummary);
  els.accessOffer.classList.toggle("hidden", state !== "success");
  els.completionStatus.classList.toggle("hidden", state !== "success");
  els.outcomeActions.classList.toggle("hidden", !["failure", "uncertain"].includes(state));
  els.outcomeRetry.classList.toggle("hidden", state !== "failure");
  els.outcomeDone.textContent = state === "failure" ? "Not now" : "Done";
  els.outcomeReassurance.classList.remove("hidden");
  els.trialPill.classList.toggle("hidden", state !== "failure");

  if (state === "pending") {
    els.outcomeTitle.textContent = details.machineName ? `Starting ${details.machineName}…` : "Starting your machine…";
    els.outcomeReassurance.textContent = "Keep this page open while CircuitWash confirms the activation.";
    setActivity("Activation pending", details.machineName, "warn");
  } else if (state === "success") {
    els.outcomeTitle.textContent = details.machineName ? `${details.machineName} activated` : "Machine activated";
    els.outcomeReassurance.textContent = "";
    els.outcomeReassurance.classList.add("hidden");
    els.allowance.textContent = "Free start complete";
    setActivity("Machine activated", details.machineName, "ok");
    renderContinuationPrompt();
    window.CircuitWashAnalytics?.track("trial_conversion_screen_viewed", {
      source: "trial-completion",
      auth_state: "anonymous",
      trial_eligibility: "used"
    }, { once: "trial_conversion_screen_viewed" });
  } else if (state === "uncertain") {
    els.outcomeTitle.textContent = details.machineName ? `We couldn’t confirm ${details.machineName}` : "We couldn’t confirm the machine start";
    els.outcomeReassurance.textContent = "The start may have reached the machine. Check it before trying again. If you need help, open the menu in the top right.";
    setActivity("Activation unconfirmed", details.machineName, "warn");
  } else {
    els.outcomeTitle.textContent = details.machineName ? `${details.machineName} didn’t start` : "The machine didn’t start";
    els.outcomeReassurance.textContent = "No completed activation was recorded. Reconnect and try again, or get help if the problem continues.";
    setActivity("Could not start", details.machineName, "bad");
  }
}

function applySession(data) {
  const siteName = data.site?.name || "Your site";
  currentSite = data.site || null;
  els.title.textContent = siteName;
  els.title.title = siteName;
  machines = Array.isArray(data.machines) ? data.machines : [];
  selectedMachineKey = machines.length ? machineKey(machines[0]) : "";
  saveClaim({ ...claim, token: trialToken, site: data.site, email: data.email || claim?.email || "", used: Boolean(data.used), activatedAt: data.activatedAt || claim?.activatedAt || null, activation: data.activation || claim?.activation || null });
  renderContinuationPrompt();
  if (data.used) {
    showActivationOutcome("success", { activation: data.activation, activatedAt: data.activatedAt });
    return;
  }
  if (data.activation?.status === "pending") {
    showActivationOutcome("uncertain", { activation: data.activation });
    return;
  }
  els.loading.classList.add("hidden");
  els.error.classList.add("hidden");
  els.outcome.classList.add("hidden");
  els.root.classList.remove("trial-outcome-active");
  els.root.classList.remove("post-activation-success");
  els.controls.classList.remove("hidden");
  els.changeSite.disabled = false;
  els.allowance.textContent = "1 free activation remaining";
  renderMachines();
  renderCycles();
  setConnectedUI(false);
  setStatus(machines.length ? `ready to connect (${machines[0].name})` : "no machines available");
  setActivity("Ready", "", "");
}

function renderMachines() {
  if (!machines.length) {
    els.deviceMap.innerHTML = '<div class="machine-empty">No machines are configured for this site.</div>';
    els.machinePickerList.innerHTML = "";
    els.connect.disabled = true;
    showIOSNote();
    return;
  }
  if (!machines.some((machine) => machineKey(machine) === selectedMachineKey)) selectedMachineKey = machineKey(machines[0]);
  const machine = selectedMachine();
  const machineId = String(machine?.bluetoothName || machineKey(machine) || "").trim();
  els.deviceMap.innerHTML = `
    <button id="trialMachinePickerTrigger" class="machine-selector" type="button" aria-haspopup="dialog" aria-expanded="false">
      <span class="machine-type-icon" data-machine-type="${machineType(machine)}">${machineIconMarkup(machine)}</span>
      <span class="machine-selector-copy">
        <strong>${escapeHtml(machine?.name || "Choose a machine")}</strong>
        ${machineId ? `<code>${escapeHtml(machineId)}</code>` : ""}
      </span>
      <span class="machine-selector-change"><span>Change</span><i aria-hidden="true"></i></span>
    </button>
  `;
  document.getElementById("trialMachinePickerTrigger")?.addEventListener("click", openMachinePicker);
  renderMachinePicker();
  updateConnectLabel();
  showIOSNote();
}

function renderMachinePicker() {
  els.machinePickerList.innerHTML = "";
  machines.forEach((machine) => {
    const key = machineKey(machine);
    const selected = key === selectedMachineKey;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `machine-option ${selected ? "is-selected" : ""}`.trim();
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(selected));
    button.innerHTML = `<span class="machine-type-icon" data-machine-type="${machineType(machine)}">${machineIconMarkup(machine)}</span><span class="machine-option-copy"><strong>${escapeHtml(machine.name)}</strong></span><span class="machine-option-check" aria-hidden="true">✓</span>`;
    button.addEventListener("click", () => selectMachine(key));
    els.machinePickerList.appendChild(button);
  });
}

function openMachinePicker() {
  if (!machines.length) return;
  machinePickerReturnFocus = document.getElementById("trialMachinePickerTrigger");
  renderMachinePicker();
  els.machinePicker.classList.remove("hidden");
  document.body.classList.add("machine-picker-open");
  els.root.inert = true;
  els.root.setAttribute("aria-hidden", "true");
  machinePickerReturnFocus?.setAttribute("aria-expanded", "true");
  setTimeout(() => {
    els.machinePickerList.scrollTop = 0;
    els.closeMachinePicker.focus({ preventScroll: true });
  }, 0);
}

function closeMachinePicker() {
  els.machinePicker.classList.add("hidden");
  document.body.classList.remove("machine-picker-open");
  els.root.inert = false;
  els.root.removeAttribute("aria-hidden");
  machinePickerReturnFocus?.setAttribute("aria-expanded", "false");
  machinePickerReturnFocus?.focus();
  machinePickerReturnFocus = null;
}

async function selectMachine(key) {
  if (!machines.some((machine) => machineKey(machine) === key)) return;
  const changed = selectedMachineKey !== key;
  selectedMachineKey = key;
  const machine = selectedMachine();
  closeMachinePicker();
  if (changed && isConnected()) await disconnect("machine-changed");
  renderMachines();
  renderCycles();
  setConnectedUI(false);
  setStatus(`Ready to connect to ${machine?.name || "machine"}`);
  setActivity("Ready", machine ? `${machine.name} selected` : "");
}

function cyclePresentation(machine, key, value) {
  const label = String(cycleLabel(key, value) || key).trim();
  const durationMatch = label.match(/(\d+)\s*(?:mins?|minutes?)/i);
  const duration = durationMatch ? `${durationMatch[1]} min` : "";
  const title = label.replace(/\s*[-–—·]?\s*\d+\s*(?:mins?|minutes?)\s*/i, "").replace(/\s*[-–—]\s*$/, "").trim() || label;
  const fallback = machineType(machine) === "dryer" ? "Dryer cycle" : machineType(machine) === "washer" ? "Wash cycle" : "Machine cycle";
  return { label, title, meta: duration || fallback, duration };
}

function renderCycles() {
  els.cycles.innerHTML = "";
  cycleButtons.length = 0;
  const machine = selectedMachine();
  if (!machine) return;
  for (const [key, value] of Object.entries(machineCycles(machine))) {
    const cycle = cyclePresentation(machine, key, value);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cycle-button";
    button.innerHTML = `<span class="cycle-button-copy"><strong>${escapeHtml(cycle.title)}</strong></span><span class="cycle-button-arrow" aria-hidden="true">→</span>`;
    if (machineType(machine) === "dryer" && cycle.duration) {
      const duration = document.createElement("small");
      duration.textContent = cycle.duration;
      button.querySelector(".cycle-button-copy")?.appendChild(duration);
    }
    button.setAttribute("aria-label", `Start ${cycle.label} on ${machine.name}`);
    button.disabled = true;
    button.addEventListener("click", () => startMachine(machine, key, cycle.label));
    els.cycles.appendChild(button);
    cycleButtons.push(button);
  }
}

function isConnected() {
  return Boolean(device?.gatt?.connected);
}

function deviceMatchesMachine() {
  const expected = String(selectedMachine()?.bluetoothName || "").trim().toLowerCase();
  const actual = String(connectedDeviceName || "").trim().toLowerCase();
  return Boolean(expected && actual && expected === actual);
}

function updateConnectLabel() {
  const machine = selectedMachine();
  const state = els.connectionModule?.dataset.state || "ready";
  if (state === "connecting") {
    els.connect.innerHTML = '<span class="connect-button-loader" aria-hidden="true"></span><span>Connecting…</span>';
  } else if (state === "error") {
    els.connect.innerHTML = '<span>Try again</span><span aria-hidden="true">→</span>';
  } else {
    els.connect.innerHTML = machine
      ? `<span>Connect to ${escapeHtml(machine.name)}</span><span aria-hidden="true">→</span>`
      : '<span>Connect</span><span aria-hidden="true">→</span>';
  }
}

function setConnectedUI(connected) {
  const canStart = connected && deviceMatchesMachine() && !completed;
  els.connect.classList.toggle("hidden", connected || completed);
  els.connect.disabled = completed || !selectedMachine();
  els.controls.classList.toggle("is-connected", canStart);
  els.cycleSection.classList.toggle("is-locked", !canStart);
  els.cycleHint.classList.add("hidden");
  cycleButtons.forEach((button) => { button.disabled = !canStart; });
}

function resetMessages(reason = "Connection reset") {
  rxBuf = new Uint8Array(0);
  messageQueue = [];
  waiters.forEach((waiter) => { clearTimeout(waiter.timer); waiter.reject(new Error(reason)); });
  waiters = [];
}

function concatBytes(a, b) {
  const output = new Uint8Array(a.length + b.length);
  output.set(a, 0);
  output.set(b, a.length);
  return output;
}

function extractFrames(buffer) {
  const frames = [];
  let current = buffer;
  while (true) {
    const start = current.indexOf("[".charCodeAt(0));
    if (start < 0) { rxBuf = new Uint8Array(0); return frames; }
    if (start > 0) current = current.slice(start);
    const end = current.indexOf("]".charCodeAt(0), 1);
    if (end < 0) { rxBuf = current; return frames; }
    frames.push(current.slice(0, end + 1));
    current = current.slice(end + 1);
    rxBuf = current;
  }
}

function resolveWaiters() {
  waiters.forEach((waiter, waiterIndex) => {
    const messageIndex = messageQueue.findIndex((message) => message.startsWith(waiter.prefix));
    if (messageIndex < 0) return;
    const [message] = messageQueue.splice(messageIndex, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
    waiters.splice(waiterIndex, 1);
  });
}

function onNotify(event) {
  const value = event.target.value;
  const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  rxBuf = concatBytes(rxBuf, chunk);
  extractFrames(rxBuf).forEach((frame) => messageQueue.push(dec.decode(frame)));
  resolveWaiters();
}

function waitFor(prefix, timeoutMs = 8000) {
  const index = messageQueue.findIndex((message) => message.startsWith(prefix));
  if (index >= 0) return Promise.resolve(messageQueue.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((waiter) => waiter.resolve !== resolve);
      reject(new Error(`Timeout waiting for ${prefix}`));
    }, timeoutMs);
    waiters.push({ prefix, resolve, reject, timer });
  });
}

async function send(command, expectedPrefix) {
  if (!txChar) throw new Error("Machine connection is not ready");
  const bytes = enc.encode(command);
  try { await txChar.writeValueWithoutResponse(bytes); } catch (_) { await txChar.writeValue(bytes); }
  return expectedPrefix ? waitFor(expectedPrefix) : "";
}

function bluetoothOptions(machine) {
  return { filters: [{ name: machine.bluetoothName }], optionalServices: [SERVICE_UUID, HEART_RATE_SERVICE_UUID] };
}

function isIOSDevice() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

async function connect() {
  const machine = selectedMachine();
  if (!machine) return;
  if (!window.isSecureContext) {
    reportBluetoothFailure("bluetooth_connection_failed", { stage: "secure_context", error: new Error("A secure browser context is required"), machine });
    setActivity("Open securely", "Use HTTPS or localhost", "warn"); return;
  }
  if (!navigator.bluetooth) {
    if (isIOSDevice()) {
      showIOSNote({ request: true });
      setActivity("Ready", "");
      setStatus(`ready to connect (${machine.name})`);
    } else {
      setActivity("Bluetooth unavailable", "Open in a Bluetooth browser", "warn");
      setStatus("bluetooth unavailable", "warn");
    }
    return;
  }
  els.connect.disabled = true;
  let stage = "device_request";
  unexpectedBluetoothDisconnectReported = false;
  try {
    resetMessages("Preparing new connection");
    setActivity("Connecting...", machine.name, "warn");
    setStatus(`connecting to ${machine.name}...`);
    bluetoothFailureStage = stage;
    device = await navigator.bluetooth.requestDevice(bluetoothOptions(machine));
    connectedDeviceName = String(device.name || "");
    device.addEventListener("gattserverdisconnected", onDisconnected);
    stage = "gatt_connect";
    bluetoothFailureStage = stage;
    server = await device.gatt.connect();
    stage = "service_discovery";
    bluetoothFailureStage = stage;
    service = await server.getPrimaryService(SERVICE_UUID);
    stage = "tx_characteristic";
    bluetoothFailureStage = stage;
    txChar = await service.getCharacteristic(TX_UUID);
    try {
      stage = "rx_notifications";
      bluetoothFailureStage = stage;
      rxChar = await service.getCharacteristic(RX_UUID);
      await rxChar.startNotifications();
      rxChar.addEventListener("characteristicvaluechanged", onNotify);
    } catch (_) { rxChar = null; }
    stage = "occupancy_check";
    bluetoothFailureStage = stage;
    const occupied = await checkOccupied();
    bluetoothFailureStage = "connected";
    setConnectedUI(true);
    if (occupied) {
      cycleButtons.forEach((button) => { button.disabled = true; });
      setStatus(`${machine.name} in use`, "warn");
    } else if (deviceMatchesMachine()) {
      setStatus(`${machine.name} ready`, "ok");
      setActivity("Connected", machine.name, "ok");
    } else {
      setStatus("wrong machine", "warn");
      setActivity("Reconnect", "Choose the matching machine", "warn");
    }
  } catch (error) {
    const chooserCancelled = isBluetoothChooserCancellation(stage, error);
    if (!chooserCancelled && !unexpectedBluetoothDisconnectReported) {
      reportBluetoothFailure("bluetooth_connection_failed", { stage, error, machine });
    }
    await disconnect("connect-failed");
    if (chooserCancelled) {
      setStatus(`ready to connect (${machine.name})`);
      setActivity("Ready", "");
      return;
    }
    setStatus(`Couldn’t connect to ${machine.name}`, "bad");
    setActivity("Connection failed", "Try again", "bad");
  } finally {
    if (!isConnected()) {
      bluetoothFailureStage = "idle";
      updateConnectLabel();
      els.connect.disabled = !selectedMachine();
    }
  }
}

async function checkOccupied() {
  const machine = selectedMachine();
  try {
    let characteristic;
    try { characteristic = await service.getCharacteristic(OCCUPANCY_UUID); }
    catch (_) {
      const heartService = await server.getPrimaryService(HEART_RATE_SERVICE_UUID);
      characteristic = await heartService.getCharacteristic(OCCUPANCY_UUID);
    }
    const value = await characteristic.readValue();
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const text = dec.decode(bytes).replace(/\0/g, "").trim();
    const hex = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const occupied = text === "1120" || hex === "1120";
    els.inUse.textContent = occupied ? `${machine.name} is currently in use.` : "";
    els.inUse.classList.toggle("hidden", !occupied);
    return occupied;
  } catch (_) {
    els.inUse.classList.add("hidden");
    return false;
  }
}

async function startMachine(machine, cycleKey, label) {
  if (!isConnected() || !deviceMatchesMachine() || completed) return;
  cycleButtons.forEach((button) => { button.disabled = true; });
  let stage = "occupancy_check";
  unexpectedBluetoothDisconnectReported = false;
  let context = { machine, cycleKey, cycleLabel: label };
  try {
    bluetoothFailureStage = stage;
    if (await checkOccupied()) {
      bluetoothFailureStage = "connected";
      return;
    }
    showActivationOutcome("pending", context);
    setActivity("Starting...", `${machine.name} - ${label}`, "warn");
    setStatus(`Starting ${machine.name}…`);
    stage = "handshake";
    bluetoothFailureStage = stage;
    await send(CMD.HANDSHAKE, "[ACK:HANDSHAKE]");
    stage = "version";
    bluetoothFailureStage = stage;
    await send(CMD.VERSION, "[VERSION:");
    stage = "coin_disable";
    bluetoothFailureStage = stage;
    await send(CMD.COIN_DISABLE, "[ACK:COIN]");
    stage = "authorization";
    bluetoothFailureStage = stage;
    const prepared = await api("prepare_activation", { machineId: machineKey(machine), cycleKey });
    stage = "prepared";
    context = { ...context, activation: { id: prepared.activationId, status: prepared.activationStatus, preparedAt: prepared.preparedAt } };
    stage = "activation_ack";
    bluetoothFailureStage = stage;
    await send(String(prepared.activationCommand), "[ACK:ACTIVATE]");
    stage = "execution_ack";
    bluetoothFailureStage = stage;
    await send(CMD.EXEC, "[ACK:EXEC]");
    stage = "execution-acknowledged";
    bluetoothFailureStage = "completion";
    const completion = await api("complete_activation");
    stage = "completed";
    context = { ...context, activation: completion.activation || context.activation, activatedAt: completion.activatedAt };
    saveClaim({ ...claim, used: true, activatedAt: completion.activatedAt || new Date().toISOString(), activation: completion.activation || context.activation });
    window.CircuitWashAnalytics?.track("trial_activation_completed", {
      source: "trial-flow",
      auth_state: "anonymous",
      trial_eligibility: "used"
    });
    els.allowance.textContent = "Free activation used";
    setStatus(`${machine.name} started`, "ok");
    setActivity(`${machine.name} started`, "", "ok");
    await disconnect("complete");
    setTimeout(() => showActivationOutcome("success", context), 650);
  } catch (error) {
    if (error.code === "trial_used") {
      try { applySession(await api("session")); }
      catch (_) { showActivationOutcome("uncertain", context); }
      bluetoothFailureStage = isConnected() ? "connected" : "idle";
      return;
    }
    if (!unexpectedBluetoothDisconnectReported && ["handshake", "version", "coin_disable", "activation_ack", "execution_ack"].includes(stage)) {
      reportBluetoothFailure("bluetooth_activation_failed", { stage, error, machine });
    }
    if (isConnected()) await disconnect("sequence-error");
    if (error.code === "site_trial_limit_reached") {
      els.allowance.textContent = "Free activation limit reached";
      showActivationOutcome("failure", context);
      els.outcomeTitle.textContent = "Free starts are full at this site";
      els.outcomeReassurance.textContent = "No free start was used. Try again later or continue with paid access for this site.";
      return;
    }
    const uncertain = ["activation_ack", "activation-acknowledged", "execution_ack", "execution-acknowledged", "completed"].includes(stage);
    showActivationOutcome(uncertain ? "uncertain" : "failure", context);
  }
  bluetoothFailureStage = isConnected() ? "connected" : "idle";
}

async function disconnect(reason = "manual") {
  try {
    if (rxChar) {
      try { rxChar.removeEventListener("characteristicvaluechanged", onNotify); } catch (_) {}
      try { await rxChar.stopNotifications(); } catch (_) {}
    }
    if (device) {
      try { device.removeEventListener("gattserverdisconnected", onDisconnected); } catch (_) {}
    }
    if (device?.gatt?.connected) device.gatt.disconnect();
  } finally {
    device = null; server = null; service = null; rxChar = null; txChar = null; connectedDeviceName = "";
    bluetoothFailureStage = "idle";
    resetMessages("Disconnected");
    setConnectedUI(false);
    updateConnectLabel();
    if (reason !== "complete") {
      setStatus("ready to connect");
      if (reason !== "machine-changed") setActivity("Ready", "");
    }
  }
}

function onDisconnected() {
  const failureMachine = selectedMachine();
  const failureDeviceName = connectedDeviceName;
  unexpectedBluetoothDisconnectReported = true;
  reportBluetoothFailure("bluetooth_unexpected_disconnect", {
    stage: bluetoothFailureStage === "idle" ? "connected" : bluetoothFailureStage,
    error: new Error("The Bluetooth device disconnected unexpectedly"),
    machine: failureMachine,
    bluetoothDeviceName: failureDeviceName
  });
  device = null; server = null; service = null; rxChar = null; txChar = null; connectedDeviceName = "";
  bluetoothFailureStage = "idle";
  resetMessages("Device disconnected");
  setConnectedUI(false);
  updateConnectLabel();
  if (!completed) { setStatus("ready to connect"); setActivity("Ready", ""); }
}

function openSiteModal() {
  if (completed) return;
  clearTimeout(searchTimer);
  els.modal.classList.remove("hidden");
  document.documentElement.classList.add("change-site-open");
  document.body.classList.add("change-site-open");
  trialSiteSelector.reset();
  els.siteMessage.textContent = "";
  setTimeout(() => els.search.focus(), 0);
}

function closeSiteModal() {
  clearTimeout(searchTimer);
  els.search.blur();
  els.modal.classList.add("hidden");
  document.documentElement.classList.remove("change-site-open");
  document.body.classList.remove("change-site-open");
  trialSiteSelector.reset();
  els.siteMessage.textContent = "";
}

async function searchSites() {
  return trialSiteSelector.search();
}

async function changeSite(site, button) {
  els.search.blur();
  button.disabled = true;
  els.siteMessage.className = "change-site-message";
  els.siteMessage.textContent = `Switching to ${site.name}...`;
  try {
    if (isConnected()) await disconnect("site-changed");
    const data = await api("change_site", { siteId: site.id });
    applySession(data);
    closeSiteModal();
    setActivity("Site changed", data.site?.name || site.name, "ok");
  } catch (error) {
    els.siteMessage.className = "change-site-message bad";
    els.siteMessage.textContent = error.message;
    button.disabled = false;
  }
}

function showIOSNote({ request = false } = {}) {
  if (request) iosBluefyPromptRequested = true;
  const ios = isIOSDevice();
  const machine = selectedMachine();
  const machineName = machine?.name || "this machine";
  document.querySelectorAll("[data-ios-bluefy-machine]").forEach((element) => {
    element.textContent = machineName;
  });
  document.querySelectorAll("[data-ios-bluefy]").forEach((element) => {
    element.classList.toggle("hidden", !(iosBluefyPromptRequested && ios && !navigator.bluetooth && machine));
  });
}

function dismissIOSNote() {
  iosBluefyPromptRequested = false;
  showIOSNote();
}

function buildBluefyTrialUrl() {
  const target = new URL(location.href);
  target.hash = trialToken ? `trial=${encodeURIComponent(trialToken)}` : "";
  return target.toString();
}

function copyTextFallback(text) {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.left = "-9999px";
  field.style.top = "-9999px";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, field.value.length);
  try { document.execCommand("copy"); } catch (_) {}
  field.remove();
}

function copyTrialUrl(targetUrl) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(targetUrl).catch(() => copyTextFallback(targetUrl));
    return;
  }
  copyTextFallback(targetUrl);
}

function showBluefyCopyToast() {
  const toast = document.querySelector("[data-bluefy-copy-toast]");
  if (!toast) return;
  clearTimeout(bluefyCopyToastTimer);
  toast.classList.remove("is-visible");
  toast.setAttribute("aria-hidden", "false");
  void toast.offsetWidth;
  toast.classList.add("is-visible");
  bluefyCopyToastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
    toast.setAttribute("aria-hidden", "true");
  }, 1800);
}

function rememberPendingBluefyUrl(targetUrl) {
  try { sessionStorage.setItem(BLUEFY_PENDING_URL_KEY, targetUrl); } catch (_) {}
}

function clearPendingBluefyUrl() {
  try {
    sessionStorage.removeItem(BLUEFY_PENDING_URL_KEY);
    sessionStorage.removeItem(BLUEFY_PENDING_RETRY_KEY);
  } catch (_) {}
}

function getPendingBluefyUrl() {
  try { return String(sessionStorage.getItem(BLUEFY_PENDING_URL_KEY) || ""); } catch (_) { return ""; }
}

function launchBluefyDeepLink(deepLink) {
  const opener = document.createElement("iframe");
  opener.setAttribute("aria-hidden", "true");
  opener.tabIndex = -1;
  opener.style.position = "fixed";
  opener.style.width = "1px";
  opener.style.height = "1px";
  opener.style.opacity = "0";
  opener.style.pointerEvents = "none";
  opener.style.border = "0";
  opener.style.left = "-9999px";
  opener.style.top = "-9999px";
  opener.src = deepLink;
  document.body.appendChild(opener);
  return opener;
}

function openInBluefy(targetUrl, { fallbackToStore = true, remember = true } = {}) {
  if (remember) rememberPendingBluefyUrl(targetUrl);
  let leftPage = false;
  const deepLink = `bluefy://open?url=${encodeURIComponent(targetUrl)}`;
  const onVisibilityChange = () => {
    if (document.hidden) leftPage = true;
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const opener = launchBluefyDeepLink(deepLink);
  setTimeout(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    opener.remove();
    if (leftPage || document.hidden) {
      clearPendingBluefyUrl();
      return;
    }
    if (fallbackToStore) location.href = BLUEFY_APP_STORE_URL;
  }, BLUEFY_OPEN_FALLBACK_MS);
}

function openCurrentTrialInBluefy(event) {
  event.preventDefault();
  showBluefyCopyToast();
  const targetUrl = buildBluefyTrialUrl();
  copyTrialUrl(targetUrl);
  openInBluefy(targetUrl);
}

function retryPendingBluefyOpen() {
  const targetUrl = getPendingBluefyUrl();
  if (!targetUrl || document.hidden) return;
  const now = Date.now();
  let lastRetry = 0;
  try { lastRetry = Number(sessionStorage.getItem(BLUEFY_PENDING_RETRY_KEY) || 0); } catch (_) {}
  if (now - lastRetry < BLUEFY_PENDING_RETRY_MS) return;
  try { sessionStorage.setItem(BLUEFY_PENDING_RETRY_KEY, String(now)); } catch (_) {}
  openInBluefy(targetUrl, { fallbackToStore: false, remember: false });
}

async function init() {
  showIOSNote();
  claim = readClaim();
  trialToken = String(claim?.token || "").trim();
  if (!trialToken) {
    showError("No activation found in this browser.", "Choose your site to start.");
    return;
  }
  try {
    applySession(await api("session"));
    await restoreTrialPurchaseReturn();
  } catch (error) {
    if (error.code === "trial_not_found") {
      try { localStorage.removeItem(TRIAL_CLAIM_KEY); } catch (_) {}
    }
    showError(error.code === "trial_used" ? "Activation used." : "Activation could not be loaded.", error.message);
  }
}

els.connect.addEventListener("click", connect);
els.purchaseCta.addEventListener("click", beginTrialPurchase);
els.trialPaymentSheetClose.addEventListener("click", closeTrialPurchaseSheet);
trialPurchasePaymentRoot.querySelectorAll("[data-close-trial-payment-sheet]").forEach((element) => element.addEventListener("click", closeTrialPurchaseSheet));
els.trialCardPaymentToggle.addEventListener("click", () => {
  if (!trialPurchaseWalletAvailable) return;
  setTrialPurchaseCardExpanded(!trialPurchaseCardExpanded);
});
els.trialStripePaymentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  confirmTrialPurchase();
});
els.purchasedCode.addEventListener("click", async () => {
  const code = els.purchasedCodeValue.textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
    els.purchasedCodeHint.textContent = "Copied";
  } catch (_) {
    els.purchasedCodeHint.textContent = "Press and hold to copy";
  }
});
els.outcomeRetry.addEventListener("click", () => {
  completed = false;
  currentOutcomeContext = null;
  els.outcome.classList.add("hidden");
  els.root.classList.remove("trial-outcome-active");
  els.root.classList.remove("post-activation-success");
  els.controls.classList.remove("hidden");
  els.trialPill.classList.remove("hidden");
  els.changeSite.disabled = false;
  renderMachines();
  renderCycles();
  setConnectedUI(false);
  setStatus(`ready to connect (${selectedMachine()?.name || "machine"})`);
  setActivity("Ready", "", "");
});
els.closeMachinePicker.addEventListener("click", closeMachinePicker);
els.machinePicker.addEventListener("click", (event) => { if (event.target.matches("[data-close-trial-machine-picker]")) closeMachinePicker(); });
els.changeSite.addEventListener("click", openSiteModal);
els.closeModal.addEventListener("click", closeSiteModal);
els.modal.addEventListener("click", (event) => { if (event.target === els.modal) closeSiteModal(); });
els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = els.search.value.trim();
  if (query.length < 2) {
    trialSiteSelector.hide();
  }
  searchTimer = setTimeout(searchSites, 220);
});
els.search.addEventListener("keydown", (event) => trialSiteSelector.handleKeydown(event));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!els.trialPaymentSheet.classList.contains("hidden")) closeTrialPurchaseSheet();
  else if (!els.machinePicker.classList.contains("hidden")) closeMachinePicker();
  else if (!els.modal.classList.contains("hidden")) closeSiteModal();
});
document.querySelectorAll("[data-ios-bluefy]").forEach((element) => {
  element.addEventListener("click", (event) => {
    if (event.target === element) dismissIOSNote();
  });
});
document.querySelectorAll("[data-ios-bluefy-dismiss]").forEach((button) => {
  button.addEventListener("click", dismissIOSNote);
});
window.addEventListener("pageshow", retryPendingBluefyOpen);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) retryPendingBluefyOpen();
});
document.querySelectorAll("[data-bluefy-open]").forEach((link) => {
  link.addEventListener("click", openCurrentTrialInBluefy);
});
init();
