let MACHINES = [];
let CURRENT_SITE_NAME = "";
let CURRENT_SITE_ID = "";
let selectedMachineKey = "";
let connectedDeviceName = "";
let lastStartedMachineLabel = "";
let cycleCooldownTimer = null;
let activeAccessCode = "";
let weeklyUsage = { limit: 4, used: 0, remaining: 4, resetAt: "" };
let machinesInUse = new Set();
let preserveSuccessDisconnectUI = false;
let upgradePreviewMode = false;
let upgradeBusy = false;
let upgradeStripeConfig = null;
let upgradeStripe = null;
let upgradeElements = null;
let upgradePaymentElement = null;
let upgradeExpressElement = null;
let upgradePaymentReady = false;
let upgradeCardReady = false;
let upgradeExpressReady = false;
let upgradeWalletAvailable = false;
let upgradeCardExpanded = true;
let iosBluefyPromptRequested = false;
let changeSiteSearchTimer = null;
let changeSiteHistoryActive = false;
let activationSiteSelector = null;
let bluefyCopyToastTimer = null;
let bluetoothRoomNoticeTimer = null;
let bluetoothFailureStage = "idle";
let unexpectedBluetoothDisconnectReported = false;

const ACTIVATE_SESSION_KEY = "laundryActivateAccessCode";
const PURCHASE_STORAGE_KEY = "laundryAccessPurchase";
const ACTIVATE_LOGGED_OUT_CODE_KEY = "laundryActivateLoggedOutCode";
const BLUEFY_APP_STORE_URL = "https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055";
const BLUEFY_OPEN_FALLBACK_MS = 1400;
const BLUEFY_PENDING_URL_KEY = "laundryPendingBluefyActivationUrl";
const BLUEFY_PENDING_RETRY_KEY = "laundryPendingBluefyActivationRetryAt";
const BLUEFY_PENDING_RETRY_MS = 2500;
const UPGRADE_CHECKOUT_ENDPOINT = "/.netlify/functions/stripe-checkout";
const SERVICE_UUID = "569a1101-b87f-490c-92cb-11ba5ea5167c";
const RX_UUID = "569a2000-b87f-490c-92cb-11ba5ea5167c";
const TX_UUID = "569a2001-b87f-490c-92cb-11ba5ea5167c";

// Read this characteristic before allowing a start.
// If the value reads as "1120", the selected machine is treated as in use.
// Any other value, missing characteristic, or read error lets the flow continue.
const OCCUPANCY_UUID = "00002a37-0000-1000-8000-00805f9b34fb";
const HEART_RATE_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb";

const CMD = {
  HANDSHAKE: "[HANDSHAKE:ENABLE]",
  EXEC: "[EXEC]",
};

function mountUpgradePaymentSheet() {
  const host = document.getElementById("upgradePaymentHost");
  host.innerHTML = `
    <div id="paymentMethods" class="payment-sheet hidden" role="dialog" aria-modal="true" aria-labelledby="paymentSheetTitle">
      <div class="payment-sheet-backdrop" data-close-payment-sheet></div>
      <div id="paymentSheetPanel" class="payment-sheet-panel">
        <div id="paymentSheetHeader" class="payment-sheet-header">
          <div>
            <h2 id="paymentSheetTitle">Choose payment method</h2>
            <p id="paymentSheetSubtitle">3 extra activations for this week.</p>
          </div>
          <button id="paymentSheetCloseBtn" class="payment-sheet-close" type="button" aria-label="Close payment options">Close</button>
        </div>
        <div id="paymentSheetLoader" class="payment-sheet-loader" role="status" aria-live="polite" aria-hidden="true">
          <div class="checkout-loading-spinner" aria-hidden="true"></div>
          <strong>Preparing secure checkout</strong>
          <span>Loading payment options...</span>
        </div>
        <div id="paymentSheetContent" class="payment-sheet-content">
          <div class="payment-sheet-total" aria-live="polite"><span>Total</span><strong id="paymentSheetTotal">£5.00</strong></div>
          <div class="stripe-checkout-panel">
            <section id="expressCheckout" class="express-checkout hidden" aria-labelledby="expressCheckoutHeading">
              <p id="expressCheckoutHeading" class="payment-method-label">Express checkout</p>
              <div id="expressCheckoutElement"></div>
            </section>
            <div id="paymentDivider" class="payment-divider hidden"><span>Or pay with card</span></div>
            <section id="cardFieldsWrap" class="stripe-payment-method" aria-labelledby="cardPaymentHeading">
              <div class="card-method-header">
                <div class="card-method-copy"><span class="card-method-icon" aria-hidden="true"></span><div class="card-method-title"><h3 id="cardPaymentHeading">Card payment</h3><span id="cardPoweredBy" class="card-powered-by">Secure checkout</span></div></div>
                <button id="cardPaymentToggle" class="card-expand-button" type="button" aria-controls="cardFieldsForm" aria-expanded="true" aria-label="Collapse card payment"><span class="card-expand-indicator" aria-hidden="true"></span></button>
              </div>
              <div id="cardFieldsForm" class="card-fields-form" role="region" aria-labelledby="cardPaymentHeading" aria-hidden="false">
                <form id="stripePaymentForm" class="stripe-payment-form">
                  <div id="paymentElement" class="payment-element"></div>
                  <button id="stripeSubmitBtn" class="stripe-checkout-button" type="submit">Pay securely</button>
                  <p id="upgradePaymentMessage" class="stripe-note" aria-live="polite">Secure encrypted payment.</p>
                </form>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>`;
  return host;
}

const upgradePaymentRoot = mountUpgradePaymentSheet();

const els = {
  appRoot: document.getElementById("appRoot"),
  pinOverlay: document.getElementById("pinOverlay"),
  pinTitle: document.getElementById("pinTitle"),
  pinTitleText: document.getElementById("pinTitleText"),
  pinSub: document.getElementById("pinSub"),
  loginRow: document.getElementById("loginRow"),
  pinInput: document.getElementById("pinInput"),
  unlockBtn: document.getElementById("unlockBtn"),
  pinError: document.getElementById("pinError"),
  pasteCodeBtn: document.getElementById("pasteCodeBtn"),
  freeActivationLink: document.getElementById("freeActivationLink"),
  freeActivationLabel: document.getElementById("freeActivationLabel"),
  siteTitle: document.getElementById("siteTitle"),
  changeSiteBtn: document.getElementById("changeSiteBtn"),
  changeSiteOverlay: document.getElementById("changeSiteOverlay"),
  closeChangeSiteBtn: document.getElementById("closeChangeSiteBtn"),
  changeSiteSearch: document.getElementById("changeSiteSearch"),
  changeSiteSearchSpinner: document.getElementById("changeSiteSearchSpinner"),
  changeSiteResults: document.getElementById("changeSiteResults"),
  changeSiteMessage: document.getElementById("changeSiteMessage"),
  logoutBtn: document.getElementById("logoutBtn"),
  connectBtn: document.getElementById("connectBtn"),
  connectionModule: document.getElementById("connectionModule"),
  connectionTitle: document.getElementById("connectionTitle"),
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  activityText: document.getElementById("activityText"),
  machineButtons: document.getElementById("machineButtons"),
  deviceMap: document.getElementById("deviceMap"),
  cycleSection: document.getElementById("cycleSection"),
  cycleHint: document.getElementById("cycleHint"),
  machinePickerOverlay: document.getElementById("machinePickerOverlay"),
  machinePickerList: document.getElementById("machinePickerList"),
  closeMachinePickerBtn: document.getElementById("closeMachinePickerBtn"),
  inUseNotice: document.getElementById("inUseNotice"),
  usageNotice: document.getElementById("usageNotice"),
  upgradePanel: document.getElementById("upgradePanel"),
  upgradePanelToggle: document.getElementById("upgradePanelToggle"),
  upgradePanelBody: document.getElementById("upgradePanelBody"),
  upgradeTitle: document.getElementById("upgradeTitle"),
  upgradeText: document.getElementById("upgradeText"),
  upgradeBtn: document.getElementById("upgradeBtn"),
  upgradeMessage: document.getElementById("upgradeMessage"),
  upgradePaymentSheet: upgradePaymentRoot.querySelector("#paymentMethods"),
  upgradePaymentCloseBtn: upgradePaymentRoot.querySelector("#paymentSheetCloseBtn"),
  upgradePaymentLoader: upgradePaymentRoot.querySelector("#paymentSheetLoader"),
  upgradePaymentContent: upgradePaymentRoot.querySelector("#paymentSheetContent"),
  upgradeExpressCheckout: upgradePaymentRoot.querySelector("#expressCheckout"),
  upgradeExpressCheckoutElement: upgradePaymentRoot.querySelector("#expressCheckoutElement"),
  upgradePaymentDivider: upgradePaymentRoot.querySelector("#paymentDivider"),
  upgradeCardMethod: upgradePaymentRoot.querySelector("#cardFieldsWrap"),
  upgradeCardToggle: upgradePaymentRoot.querySelector("#cardPaymentToggle"),
  upgradeCardPoweredBy: upgradePaymentRoot.querySelector("#cardPoweredBy"),
  upgradeCardFields: upgradePaymentRoot.querySelector("#cardFieldsForm"),
  upgradePaymentForm: upgradePaymentRoot.querySelector("#stripePaymentForm"),
  upgradePaymentElement: upgradePaymentRoot.querySelector("#paymentElement"),
  upgradePaymentSubmitBtn: upgradePaymentRoot.querySelector("#stripeSubmitBtn"),
  upgradePaymentMessage: upgradePaymentRoot.querySelector("#upgradePaymentMessage"),
};

activationSiteSelector = window.CircuitWashSiteSelector.create({
  input: els.changeSiteSearch,
  results: els.changeSiteResults,
  spinner: els.changeSiteSearchSpinner,
  formatAddress: window.CircuitWashSiteSelector.formatAddress,
  currentSiteId: () => CURRENT_SITE_ID,
  onSelect: (site, button, state) => {
    if (state.selected || String(site.id || "") === CURRENT_SITE_ID) closeChangeSite();
    else changeActivationSite(site, button);
  }
});

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });
const dynamicButtons = [];

let codeAttempts = 0;
let unlocking = false;
let pinDismissTimer = null;
let device = null;
let server = null;
let service = null;
let rxChar = null;
let txChar = null;
let notificationText = "";
let machinePickerReturnFocus = null;

function normaliseAccessCode(value) {
  return String(value || "").toUpperCase();
}

function normalisePinInput() {
  const current = els.pinInput.value;
  const normalised = normaliseAccessCode(current);
  if (normalised === current) return;
  const selectionStart = els.pinInput.selectionStart;
  const selectionEnd = els.pinInput.selectionEnd;
  els.pinInput.value = normalised;
  if (selectionStart !== null && selectionEnd !== null) {
    try { els.pinInput.setSelectionRange(selectionStart, selectionEnd); } catch (_) {}
  }
}

function accessCodeLooksValid(value = els.pinInput.value) {
  return String(value || "").trim().length > 0;
}

function setPinError(message = "") {
  const text = String(message || "");
  els.pinError.textContent = text;
  els.pinInput.setAttribute("aria-invalid", text ? "true" : "false");
  els.pinOverlay.querySelector(".pin-card")?.classList.toggle("has-error", Boolean(text));
}

function updateUnlockButtonState() {
  els.unlockBtn.disabled = unlocking || !accessCodeLooksValid();
}

function setUnlockChecking(checking) {
  els.unlockBtn.classList.toggle("is-checking", checking);
  const label = els.unlockBtn.querySelector(".button-label");
  if (label) label.textContent = checking ? "Checking code…" : "Continue";
  if (!els.pinOverlay.classList.contains("pin-loading")) els.pinOverlay.setAttribute("aria-busy", checking ? "true" : "false");
  updateUnlockButtonState();
}

const DEFAULT_WASHER_CYCLES = {
  standardEco: "Standard Eco",
  extraWash: "Extra Wash",
  extraWashRinse: "Extra Wash + Rinse",
};

function getMachineCycles(machine) {
  const configuredCycles = machine.cycles || {};

  // If an older washer entry still only has { "full": "Full Wash Cycle" },
  // show the new 3 washer options automatically.
  if (
    machine.type === "washer" &&
    Object.keys(configuredCycles).length === 1 &&
    configuredCycles.full
  ) {
    return DEFAULT_WASHER_CYCLES;
  }

  return configuredCycles;
}

function getCycleLabel(cycleKey, cycleValue) {
  if (typeof cycleValue === "string") return cycleValue;
  if (cycleValue && typeof cycleValue === "object") return cycleValue.label || cycleKey;
  return cycleKey;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debugOnly(text, level = "log") {
  const fn = console[level] || console.log;
  fn(text);
}

function setActivity(main, sub = "", tone = "") {
  const text = sub ? `${main} — ${sub}` : main;
  if (els.activityText) els.activityText.textContent = text;
  els.log.className = `activity-strip ${tone}`.trim();
}

function setStatus(text, tone = "") {
  const machine = getSelectedMachine();
  const machineName = machine?.name || "machine";
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
  } else if (lower.includes("started")) {
    state = "started";
    title = `${machineName} started`;
  } else if (lower.includes("activation complete")) {
    state = "complete";
    title = `${machineName} started`;
  } else if (tone === "ok" || (lower.includes("connected") && !lower.includes("not connected"))) {
    state = "connected";
    title = `Connected to ${machineName}`;
  } else if (tone === "bad" || lower.includes("couldn") || lower.includes("unavailable") || lower.includes("required")) {
    const startFailed = lower.includes("couldn’t start") || lower.includes("couldn't start");
    state = startFailed ? "start-error" : "error";
    title = lower.includes("bluetooth unavailable")
      ? "Bluetooth unavailable"
      : startFailed
        ? `Couldn’t start ${machineName}`
        : `Couldn’t connect to ${machineName}`;
  } else if (tone === "warn" || lower.includes("in use") || lower.includes("limit")) {
    state = "warning";
    title = lower.includes("in use")
      ? `${machineName} is in use`
      : lower.includes("limit")
        ? "Ready to connect"
        : normalised;
  }

  els.connectionModule.dataset.state = state;
  if (state === "complete") els.connectBtn.classList.add("hidden");
  els.status.className = `status-pill ${tone}`.trim();
  els.status.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(normalised || title)}</span>`;
  els.connectionTitle.textContent = title;
  updateUsageNoticeVisibility();
  updateConnectButtonLabel();
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

function openMachinePicker() {
  if (!MACHINES.length) return;
  machinePickerReturnFocus = document.getElementById("machinePickerTrigger");
  renderMachinePicker();
  els.machinePickerOverlay.classList.remove("hidden");
  document.body.classList.add("machine-picker-open");
  els.appRoot.inert = true;
  els.appRoot.setAttribute("aria-hidden", "true");
  machinePickerReturnFocus?.setAttribute("aria-expanded", "true");
  setTimeout(() => {
    els.machinePickerList.scrollTop = 0;
    els.closeMachinePickerBtn.focus({ preventScroll: true });
  }, 0);
}

function closeMachinePicker() {
  els.machinePickerOverlay.classList.add("hidden");
  document.body.classList.remove("machine-picker-open");
  if (!els.appRoot.classList.contains("locked")) {
    els.appRoot.inert = false;
    els.appRoot.removeAttribute("aria-hidden");
  }
  machinePickerReturnFocus?.setAttribute("aria-expanded", "false");
  machinePickerReturnFocus?.focus();
  machinePickerReturnFocus = null;
}

function renderMachinePicker() {
  els.machinePickerList.innerHTML = "";
  MACHINES.forEach((machine) => {
    const key = getMachineKey(machine);
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

async function selectMachine(key) {
  if (!MACHINES.some((machine) => getMachineKey(machine) === key)) return;
  const changed = selectedMachineKey !== key;
  selectedMachineKey = key;
  const machine = getSelectedMachine();
  closeMachinePicker();
  if (changed && isConnected()) await disconnect("machine-changed");
  renderDeviceMap();
  renderMachineButtons();
  updateConnectButtonLabel();
  showIOSBluefyNotes();
  setConnectedUI(false);
  setStatus(`Ready to connect to ${machine?.name || "machine"}`);
  setActivity("Ready", machine ? `${machine.name} selected` : "", "");
  updateMachinesInUseNotice();
}

function setSiteTitle(name, siteId = "") {
  CURRENT_SITE_NAME = String(name || "").trim();
  CURRENT_SITE_ID = String(siteId || "").trim();
  els.siteTitle.textContent = CURRENT_SITE_NAME;
  els.siteTitle.title = CURRENT_SITE_NAME;
  els.changeSiteBtn?.classList.toggle("hidden", !CURRENT_SITE_NAME || !activeAccessCode);
}

function openChangeSite() {
  if (!activeAccessCode) return;
  clearTimeout(changeSiteSearchTimer);
  els.changeSiteOverlay.classList.remove("hidden");
  document.documentElement.classList.add("change-site-open");
  document.body.classList.add("change-site-open");
  activationSiteSelector.reset();
  els.changeSiteMessage.textContent = "";
  if (!changeSiteHistoryActive) {
    history.pushState({ ...(history.state || {}), circuitWashChangeSite: true }, "", location.href);
    changeSiteHistoryActive = true;
  }
  setTimeout(() => els.changeSiteSearch.focus(), 0);
}

function closeChangeSite({ fromPopState = false } = {}) {
  if (els.changeSiteOverlay.classList.contains("hidden")) return;
  clearTimeout(changeSiteSearchTimer);
  els.changeSiteSearch.blur();
  els.changeSiteOverlay.classList.add("hidden");
  document.documentElement.classList.remove("change-site-open");
  document.body.classList.remove("change-site-open");
  activationSiteSelector.reset();
  els.changeSiteMessage.textContent = "";
  const shouldGoBack = changeSiteHistoryActive && !fromPopState;
  changeSiteHistoryActive = false;
  if (shouldGoBack) history.back();
}

async function searchChangeSites() {
  return activationSiteSelector.search();
}

function renderChangeSiteResults(sites) {
  activationSiteSelector.render(sites, sites.length ? String() : 'No matching sites');
}

async function changeActivationSite(site, button) {
  if (!activeAccessCode) return;
  els.changeSiteSearch.blur();
  button.disabled = true;
  els.changeSiteMessage.className = "change-site-message";
  els.changeSiteMessage.textContent = `Switching to ${site.name}…`;
  try {
    if (isConnected()) await disconnect("site-changed");
    const response = await fetch("/.netlify/functions/login", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "change_site", code: activeAccessCode, siteId: site.id })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "Site could not be changed");

    MACHINES = Array.isArray(data.machines) ? data.machines : [];
    selectedMachineKey = MACHINES.length ? getMachineKey(MACHINES[0]) : "";
    connectedDeviceName = "";
    lastStartedMachineLabel = "";
    machinesInUse = new Set();
    weeklyUsage = {
      limit: Number(data.weeklyLimit || weeklyUsage.limit || 4),
      baseLimit: Number(data.weeklyBaseLimit || data.weeklyLimit || weeklyUsage.baseLimit || 4),
      bonus: Number(data.weeklyBonus || 0),
      used: Number(data.weeklyUsed || 0),
      remaining: Number(data.weeklyRemaining ?? data.weeklyLimit ?? weeklyUsage.remaining ?? 4),
      resetAt: String(data.weeklyResetAt || weeklyUsage.resetAt || ""),
      totalUsed: Number(data.totalUsed || 0),
      totalLimit: Number(data.totalLimit || 0),
      deleteAfterUse: Boolean(data.deleteAfterUse)
    };
    setSiteTitle(data.siteName || site.name, data.siteId || site.id);
    updateMachinesInUseNotice();
    updateWeeklyUsageNotice();
    renderDeviceMap();
    renderMachineButtons();
    updateConnectButtonLabel();
    setConnectedUI(false);
    setStatus(MACHINES.length ? `ready to connect (${MACHINES[0].name})` : "no machines loaded");
    setActivity("Site changed", data.siteName || site.name, "ok");
    closeChangeSite();
  } catch (error) {
    els.changeSiteMessage.className = "change-site-message bad";
    els.changeSiteMessage.textContent = error.message;
    button.disabled = false;
  }
}

function setPinTitle(text) {
  if (els.pinTitleText) {
    els.pinTitleText.textContent = text;
  } else {
    els.pinTitle.textContent = text;
  }
}

function tapHaptic(ms = 12) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}

function attachTouchFeedback() {
  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    button.classList.add("is-pressed");
  });

  const clearPressedButtons = () => {
    document.querySelectorAll("button.is-pressed").forEach((button) => button.classList.remove("is-pressed"));
  };

  document.addEventListener("pointerup", clearPressedButtons);
  document.addEventListener("pointercancel", clearPressedButtons);
  window.addEventListener("blur", clearPressedButtons);
}

function getMachineKey(machine) {
  return String(machine?.id || machine?.name || "");
}

function reportBluetoothFailure(eventName, { stage, error, machine, bluetoothDeviceName } = {}) {
  const tracker = window.CircuitWashAnalytics;
  if (!tracker?.track) return;
  const failure = error || new Error("Bluetooth operation failed");
  const failureStage = String(stage || bluetoothFailureStage || "unknown");
  const rawErrorCode = String(failure?.code || failure?.name || "");
  tracker.track(eventName, {
    source: "activation-control",
    site_id: CURRENT_SITE_ID,
    site_name: CURRENT_SITE_NAME,
    machine_id: getMachineKey(machine),
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

function getMachineNameFromKey(key) {
  const machine = MACHINES.find((m) => getMachineKey(m) === key);
  return machine?.name || key;
}

function updateMachinesInUseNotice(extraText = "") {
  if (!extraText) {
    els.inUseNotice.classList.add("hidden");
    els.inUseNotice.textContent = "";
    return;
  }

  els.inUseNotice.textContent = extraText;
  els.inUseNotice.classList.remove("hidden");
}

function updateUsageNoticeVisibility() {
  if (!els.usageNotice || !els.connectionModule) return;
  const state = String(els.connectionModule.dataset.state || "ready");
  const remaining = Math.max(0, Number(weeklyUsage.remaining ?? weeklyUsage.limit ?? 4));
  const isPostActivation = state === "started" || state === "complete";
  const isBlockingLimit = remaining <= 0 && state !== "starting";
  els.usageNotice.classList.toggle("is-visible", isPostActivation || isBlockingLimit);
}

function updateWeeklyUsageNotice() {
  if (!els.usageNotice) return;
  const limit = Number(weeklyUsage.limit || 4);
  const remaining = Math.max(0, Number(weeklyUsage.remaining ?? limit));
  const isFreeTrial = isFreeTrialCode();
  const reset = weeklyUsage.resetAt ? new Date(weeklyUsage.resetAt).toLocaleDateString([], { weekday: "long" }) : "Monday";
  const bonus = Number(weeklyUsage.bonus || 0);
  if (isFreeTrial) {
    els.usageNotice.textContent = remaining > 0
      ? "1 free activation remaining"
      : "Free activation used";
  } else {
    els.usageNotice.textContent = remaining > 1
      ? `${remaining} activations remaining this week${bonus > 0 ? ` · ${bonus} added` : ""}`
      : remaining === 1
        ? "1 activation remaining this week"
        : `Weekly limit reached · Resets ${reset}`;
  }
  els.usageNotice.classList.toggle("limit", remaining <= 0);
  els.usageNotice.classList.toggle("low", remaining === 1);
  updateUsageNoticeVisibility();
  updateUpgradePanel();
}

function isFreeTrialCode() {
  const totalLimit = Number(weeklyUsage.totalLimit || 0);
  return totalLimit === 1 || (Boolean(weeklyUsage.deleteAfterUse) && totalLimit <= 1);
}

function usageLimitActivityText() {
  return isFreeTrialCode()
    ? ["Free trial used", "This trial code was for one test activation."]
    : ["Weekly limit reached", `This code allows ${weeklyUsage.limit || 4} activations per week.`];
}

function resetUpgradePanel() {
  upgradeBusy = false;
  upgradePreviewMode = false;
  if (els.upgradePaymentSheet) {
    resetUpgradePaymentElements();
    setUpgradePaymentSheetOpen(false);
  }
  if (!els.upgradePanel) return;
  els.upgradePanel.classList.add("hidden");
  setUpgradePanelExpanded(false);
  els.upgradeBtn.classList.remove("hidden");
  els.upgradeBtn.disabled = false;
  els.upgradeBtn.querySelector("span")?.replaceChildren("Add for £5");
  setUpgradeMessage();
}

function setUpgradePanelExpanded(expanded) {
  const isExpanded = Boolean(expanded);
  els.upgradePanel.classList.toggle("is-collapsed", !isExpanded);
  els.upgradePanelToggle.setAttribute("aria-expanded", String(isExpanded));
  els.upgradePanelBody.setAttribute("aria-hidden", String(!isExpanded));
  if ("inert" in els.upgradePanelBody) els.upgradePanelBody.inert = !isExpanded;
}

function toggleUpgradePanel() {
  setUpgradePanelExpanded(els.upgradePanel.classList.contains("is-collapsed"));
}

function setUpgradeMessage(message = "", tone = "") {
  if (!els.upgradeMessage) return;
  els.upgradeMessage.textContent = String(message || "");
  els.upgradeMessage.classList.toggle("bad", tone === "bad");
}

function updateUpgradePanel() {
  if (!els.upgradePanel) return;
  const remaining = Math.max(0, Number(weeklyUsage.remaining || 0));
  const shouldShow = remaining <= 0 && Boolean(activeAccessCode) && !isFreeTrialCode();
  const wasHidden = els.upgradePanel.classList.contains("hidden");
  els.upgradePanel.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) return;

  if (wasHidden) setUpgradePanelExpanded(false);
  els.upgradeBtn.classList.remove("hidden");
  els.upgradeTitle.textContent = "Add 3 extra activations";
  els.upgradeText.textContent = "Get 3 more machine starts for this week.";
}

function upgradeErrorText(code, fallback = "") {
  if (code === "credits_available") return "You still have activations available on this code.";
  if (code === "unknown_code") return "This access code is no longer available.";
  if (code === "expired_code") return "This access code has expired.";
  if (code === "upgrade_not_available") return "Extra activations are not available for this access code.";
  if (code === "preview_requires_test_key") return "The preview checkout requires Stripe test-mode keys.";
  return fallback || "The extra-activation checkout could not be opened. Please try again.";
}

function setUpgradePaymentMessage(message = "", tone = "") {
  els.upgradePaymentMessage.textContent = String(message || "");
  els.upgradePaymentMessage.classList.toggle("bad", tone === "bad");
  els.upgradePaymentMessage.style.color = tone === "bad" ? "#fca5a5" : "";
}

function setUpgradePaymentLoading(loading) {
  const isLoading = Boolean(loading);
  els.upgradePaymentSheet.classList.toggle("is-loading", isLoading);
  els.upgradePaymentSheet.setAttribute("aria-busy", String(isLoading));
  els.upgradePaymentLoader.setAttribute("aria-hidden", String(!isLoading));
  els.upgradePaymentContent.setAttribute("aria-hidden", String(isLoading));
}

function setUpgradePaymentSheetOpen(open) {
  els.upgradePaymentSheet.classList.toggle("hidden", !open);
  document.body.classList.toggle("upgrade-payment-open", open);
  if (open) {
    setUpgradeCardExpanded(!upgradeWalletAvailable);
    setTimeout(() => els.upgradePaymentCloseBtn.focus(), 0);
  }
}

function setUpgradeCardExpanded(expanded) {
  upgradeCardExpanded = Boolean(expanded);
  els.upgradeCardMethod.classList.toggle("is-condensed", !upgradeCardExpanded);
  els.upgradeCardMethod.classList.toggle("is-expanded", upgradeCardExpanded);
  els.upgradeCardFields.setAttribute("aria-hidden", String(!upgradeCardExpanded));
  els.upgradeCardMethod.removeAttribute("tabindex");
  els.upgradeCardMethod.removeAttribute("role");
  els.upgradeCardMethod.removeAttribute("aria-expanded");
  els.upgradeCardMethod.removeAttribute("aria-label");
  els.upgradeCardPoweredBy.setAttribute("aria-hidden", String(upgradeCardExpanded));
  els.upgradeCardToggle.disabled = !upgradeWalletAvailable;
  els.upgradeCardToggle.setAttribute("aria-hidden", String(!upgradeWalletAvailable));
  els.upgradeCardToggle.setAttribute("aria-expanded", String(upgradeCardExpanded));
  els.upgradeCardToggle.setAttribute(
    "aria-label",
    upgradeCardExpanded ? "Collapse card payment" : "Expand card payment"
  );
  if ("inert" in els.upgradePaymentForm) els.upgradePaymentForm.inert = !upgradeCardExpanded;
}

function toggleUpgradeCardPayment() {
  if (els.upgradePaymentSheet.classList.contains("hidden") || !upgradeWalletAvailable) return;
  setUpgradeCardExpanded(!upgradeCardExpanded);
}

function closeUpgradePaymentSheet() {
  if (upgradeBusy) return;
  setUpgradePaymentSheetOpen(false);
}

function resetUpgradePaymentElements() {
  try { upgradePaymentElement?.unmount(); } catch (_) {}
  try { upgradeExpressElement?.unmount(); } catch (_) {}
  els.upgradePaymentElement.replaceChildren();
  els.upgradeExpressCheckoutElement.replaceChildren();
  els.upgradeExpressCheckout.classList.add("hidden");
  els.upgradePaymentDivider.classList.add("hidden");
  els.upgradePaymentSheet.classList.remove("has-wallet-payment");
  upgradeWalletAvailable = false;
  setUpgradeCardExpanded(true);
  upgradeElements = null;
  upgradePaymentElement = null;
  upgradeExpressElement = null;
  upgradePaymentReady = false;
  upgradeCardReady = false;
  upgradeExpressReady = false;
}

function upgradeStripeAppearance() {
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
    }
  };
}

function isUpgradeAndroidDevice() {
  return /Android/i.test(navigator.userAgent || "");
}

function isUpgradeIOSDevice() {
  const userAgent = navigator.userAgent || "";
  return /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function upgradeWalletPaymentMethods() {
  return {
    applePay: isUpgradeAndroidDevice() ? "never" : "always",
    googlePay: isUpgradeIOSDevice() ? "never" : "always",
    link: "never"
  };
}

function updateUpgradeExpressCheckoutVisibility(event = {}) {
  const methods = event.availablePaymentMethods || event.paymentMethods || {};
  const hasWallet = Boolean(methods && Object.values(methods).some(Boolean));
  upgradeWalletAvailable = hasWallet;
  els.upgradePaymentSheet.classList.toggle("has-wallet-payment", hasWallet);
  els.upgradeExpressCheckout.classList.toggle("hidden", !hasWallet);
  els.upgradePaymentDivider.classList.toggle("hidden", !hasWallet);
  setUpgradeCardExpanded(!hasWallet);
}

function markUpgradePaymentReady() {
  if (upgradePaymentReady || !upgradeCardReady || !upgradeExpressReady) return;
  const readyElements = upgradeElements;
  window.setTimeout(() => {
    if (upgradePaymentReady || upgradeElements !== readyElements || !upgradeCardReady || !upgradeExpressReady) return;
    upgradePaymentReady = true;
    els.upgradePaymentSubmitBtn.disabled = false;
    setUpgradePaymentLoading(false);
  }, 120);
}

async function prepareUpgradePaymentElements() {
  if (upgradePaymentReady && upgradeElements) {
    setUpgradePaymentLoading(false);
    return;
  }
  if (!window.Stripe) throw new Error("Secure checkout could not load. Refresh and try again.");
  if (!upgradeStripeConfig) {
    const response = await fetch(UPGRADE_CHECKOUT_ENDPOINT, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.publishableKey) throw new Error(data.message || "Secure checkout is unavailable.");
    if (upgradePreviewMode && data.environment !== "test") {
      const error = new Error("The preview checkout requires Stripe test-mode keys.");
      error.code = "preview_requires_test_key";
      throw error;
    }
    upgradeStripeConfig = data;
  }

  resetUpgradePaymentElements();
  upgradeStripe = upgradeStripe || window.Stripe(upgradeStripeConfig.publishableKey);
  upgradeElements = upgradeStripe.elements({
    mode: "payment",
    amount: 500,
    currency: "gbp",
    paymentMethodTypes: ["card"],
    appearance: upgradeStripeAppearance()
  });

  upgradeExpressElement = upgradeElements.create("expressCheckout", {
    emailRequired: true,
    layout: { maxColumns: 1, maxRows: 2, overflow: "auto" },
    paymentMethods: upgradeWalletPaymentMethods(),
    buttonHeight: 54,
    buttonTheme: { applePay: "black", googlePay: "black" }
  });
  upgradeExpressElement.on("ready", (event) => {
    updateUpgradeExpressCheckoutVisibility(event);
    upgradeExpressReady = true;
    window.requestAnimationFrame(markUpgradePaymentReady);
  });
  upgradeExpressElement.on("availablepaymentmethodschange", updateUpgradeExpressCheckoutVisibility);
  upgradeExpressElement.on("confirm", () => confirmUpgradePayment({ skipSubmit: true }));
  upgradeExpressElement.mount(els.upgradeExpressCheckoutElement);

  upgradePaymentElement = upgradeElements.create("payment", { layout: { type: "tabs", defaultCollapsed: false } });
  upgradePaymentElement.on("ready", () => {
    upgradeCardReady = true;
    markUpgradePaymentReady();
  });
  upgradePaymentElement.on("change", (event) => {
    if (event.error) setUpgradePaymentMessage(event.error.message, "bad");
    else if (els.upgradePaymentMessage.classList.contains("bad")) setUpgradePaymentMessage();
  });
  upgradePaymentElement.mount(els.upgradePaymentElement);
}

async function beginActivationUpgrade() {
  if (upgradeBusy || !activeAccessCode) return;
  if (!upgradePreviewMode) window.CircuitWashAnalytics?.track("extra_activation_checkout_started", { source: "weekly_limit" });
  setUpgradeMessage();
  setUpgradePaymentMessage();
  setUpgradePaymentSheetOpen(true);
  setUpgradePaymentLoading(true);
  try {
    await prepareUpgradePaymentElements();
  } catch (error) {
    setUpgradePaymentMessage(upgradeErrorText(String(error?.code || ""), error?.message), "bad");
    setUpgradePaymentLoading(false);
  }
}

async function createUpgradePaymentIntent() {
  const response = await fetch(UPGRADE_CHECKOUT_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(upgradePreviewMode
      ? { action: "create_activation_upgrade_preview_intent" }
      : { action: "create_activation_upgrade_intent", accessCode: activeAccessCode })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.clientSecret || !data.paymentIntentId) {
    const error = new Error(data.message || "Payment could not be prepared.");
    error.code = data.error || "";
    throw error;
  }
  return data;
}

async function completeUpgradePaymentIntent(paymentIntentId, { preview = upgradePreviewMode } = {}) {
  const response = await fetch(UPGRADE_CHECKOUT_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete_activation_upgrade_intent", paymentIntentId, preview })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    if (!preview) window.CircuitWashAnalytics?.track("extra_activation_purchase_failed", { source: "weekly_limit" }, { once: `extra-activation-failed-${paymentIntentId}` });
    const error = new Error(data.message || "Payment could not be confirmed.");
    error.code = data.error || "";
    throw error;
  }
  resetUpgradePaymentElements();
  setUpgradePaymentSheetOpen(false);
  if (preview) {
    setUpgradeMessage("Test payment confirmed. No activations were added in preview mode.");
    return;
  }
  await refreshWeeklyUsage();
  updateUpgradePanel();
  setActivity("Activations added", "3 extra starts are ready", "ok");
  window.CircuitWashAnalytics?.track("extra_activation_purchase_completed", { source: "weekly_limit" }, { once: `extra-activation-${paymentIntentId}` });
}

async function confirmUpgradePayment({ skipSubmit = false } = {}) {
  if (!upgradeStripe || !upgradeElements || upgradeBusy) return;
  upgradeBusy = true;
  els.upgradePaymentSubmitBtn.disabled = true;
  els.upgradePaymentSubmitBtn.textContent = "Processing payment…";
  setUpgradePaymentMessage("Confirming payment…");
  let paymentIntentId = "client";
  try {
    const submit = await upgradeElements.submit();
    if (submit?.error) throw submit.error;
    const intent = await createUpgradePaymentIntent();
    paymentIntentId = intent.paymentIntentId || paymentIntentId;
    const returnUrl = upgradePreviewMode
      ? `${location.origin}/activate.html?upgradePreview=1&upgradePayment=return`
      : `${location.origin}/activate.html?upgradePayment=return`;
    const result = await upgradeStripe.confirmPayment({
      elements: upgradeElements,
      clientSecret: intent.clientSecret,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required"
    });
    if (result.error) throw result.error;
    if (result.paymentIntent?.status === "succeeded") {
      await completeUpgradePaymentIntent(result.paymentIntent.id);
    } else {
      setUpgradePaymentMessage("Payment is still processing. Please wait a moment and try again.", "bad");
    }
  } catch (error) {
    if (!upgradePreviewMode) window.CircuitWashAnalytics?.track("extra_activation_purchase_failed", { source: "weekly_limit" }, { once: `extra-activation-failed-${paymentIntentId}` });
    setUpgradePaymentMessage(upgradeErrorText(String(error?.code || ""), error?.message), "bad");
  } finally {
    upgradeBusy = false;
    els.upgradePaymentSubmitBtn.disabled = !upgradePaymentReady;
    els.upgradePaymentSubmitBtn.textContent = "Pay securely — £5.00";
  }
}

async function completeActivationUpgrade(sessionId) {
  setUpgradeMessage("Confirming your payment…");
  const response = await fetch(UPGRADE_CHECKOUT_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete_activation_upgrade", sessionId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    window.CircuitWashAnalytics?.track("extra_activation_purchase_failed", { source: "weekly_limit" }, { once: `extra-activation-failed-${sessionId}` });
    const error = new Error(data.message || "Payment could not be confirmed.");
    error.code = data.error || "";
    throw error;
  }
  await refreshWeeklyUsage();
  updateUpgradePanel();
  setActivity("Activations added", "3 extra starts are ready", "ok");
  window.CircuitWashAnalytics?.track("extra_activation_purchase_completed", { source: "weekly_limit" }, { once: `extra-activation-${sessionId}` });
}

function getSelectedMachine() {
  return MACHINES.find((m) => getMachineKey(m) === selectedMachineKey) || null;
}

function isConnected() {
  return !!(device && device.gatt && device.gatt.connected);
}

function namesMatch(expected, actual) {
  const a = String(expected || "").trim().toLowerCase();
  const b = String(actual || "").trim().toLowerCase();
  return !!a && !!b && a === b;
}

function isDeviceMatchForSelection() {
  const machine = getSelectedMachine();
  return !!(machine && isConnected() && namesMatch(machine.bluetoothName, connectedDeviceName));
}

function isLikelySafari() {
  const ua = navigator.userAgent || "";
  const looksSafari = /Safari/i.test(ua);
  const otherBrowserOnApple = /Chrome|CriOS|Edg|EdgiOS|OPR|Opera|Firefox|FxiOS|Bluefy/i.test(ua);
  return looksSafari && !otherBrowserOnApple;
}

function isIOSDevice() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function showIOSBluefyNotes({ request = false } = {}) {
  if (request) iosBluefyPromptRequested = true;
  const machine = getSelectedMachine();
  const shouldShow = iosBluefyPromptRequested && isIOSDevice() && !navigator.bluetooth && Boolean(machine);
  const machineName = machine?.name || "this machine";
  document.querySelectorAll("[data-ios-bluefy-machine]").forEach((element) => {
    element.textContent = machineName;
  });
  document.querySelectorAll("[data-ios-bluefy]").forEach((element) => {
    element.classList.toggle("hidden", !shouldShow);
  });
}

function dismissIOSBluefyNotes() {
  iosBluefyPromptRequested = false;
  showIOSBluefyNotes();
}

function buildBluefyActivationUrl() {
  const target = new URL(location.href);
  target.hash = activeAccessCode ? `code=${encodeURIComponent(activeAccessCode)}` : "";
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

function copyActivationUrl(targetUrl) {
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

function hideBluetoothRoomNotice() {
  const notice = document.querySelector("[data-bluetooth-room-notice]");
  clearTimeout(bluetoothRoomNoticeTimer);
  if (!notice) return;
  notice.classList.remove("is-visible");
  notice.setAttribute("aria-hidden", "true");
}

function showBluetoothRoomNotice() {
  const notice = document.querySelector("[data-bluetooth-room-notice]");
  if (!notice) return;
  hideBluetoothRoomNotice();
  notice.setAttribute("aria-hidden", "false");
  void notice.offsetWidth;
  notice.classList.add("is-visible");
  bluetoothRoomNoticeTimer = setTimeout(hideBluetoothRoomNotice, 5200);
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

function openCurrentActivationInBluefy(event) {
  event.preventDefault();
  showBluefyCopyToast();
  const targetUrl = buildBluefyActivationUrl();
  copyActivationUrl(targetUrl);
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

function updateConnectButtonLabel() {
  const machine = getSelectedMachine();
  const state = els.connectionModule?.dataset.state || "ready";
  if (state === "connecting") {
    els.connectBtn.innerHTML = '<span class="connect-button-loader" aria-hidden="true"></span><span>Connecting…</span>';
  } else if (state === "error") {
    els.connectBtn.innerHTML = '<span>Try again</span><span aria-hidden="true">→</span>';
  } else {
    els.connectBtn.innerHTML = machine
      ? `<span>Connect to ${escapeHtml(machine.name)}</span><span aria-hidden="true">→</span>`
      : '<span>Connect</span><span aria-hidden="true">→</span>';
  }
  if (!isConnected()) els.connectBtn.disabled = !machine;
}

function setConnectedUI(connected) {
  const machine = getSelectedMachine();
  const match = connected && isDeviceMatchForSelection();
  const canRun = connected && match;

  els.connectBtn.classList.toggle("hidden", connected);

  els.connectBtn.disabled = connected || !machine;
  els.appRoot.classList.toggle("is-connected", canRun);
  els.cycleSection.classList.remove("hidden");
  els.cycleSection.classList.toggle("is-locked", !canRun);
  els.cycleHint.classList.add("hidden");

  for (const button of dynamicButtons) button.disabled = !canRun;
}

function temporarilyDisableCycleButtons(ms = 3000) {
  clearTimeout(cycleCooldownTimer);
  for (const button of dynamicButtons) button.disabled = true;
  cycleCooldownTimer = setTimeout(() => setConnectedUI(isConnected()), ms);
}

function showPinLoading(text = "Checking your saved session...") {
  els.pinOverlay.classList.add("pin-loading");
  els.pinOverlay.setAttribute("aria-busy", "true");
  setPinTitle("Loading activation");
  els.pinSub.textContent = text;
  setPinError("");
  els.pinInput.value = "";
  els.unlockBtn.disabled = true;
}

function showPinLogin({ title = "Enter access code", sub = "Enter your code to access machine controls.", focus = true, clearInput = false } = {}) {
  els.pinOverlay.classList.remove("pin-loading");
  els.pinOverlay.setAttribute("aria-busy", "false");
  setPinTitle(title);
  els.pinSub.textContent = sub;
  setPinError("");
  if (clearInput) els.pinInput.value = "";
  updateUnlockButtonState();
  if (focus) setTimeout(() => {
    els.pinInput.focus({ preventScroll: true });
    els.pinInput.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 0);
}

function lockApp({ loading = false, loadingText = "Checking your saved session...", focus = true } = {}) {
  clearTimeout(pinDismissTimer);
  els.pinOverlay.classList.remove("pin-dismissing");
  els.pinOverlay.classList.remove("hidden");
  els.appRoot.classList.add("locked");
  els.appRoot.inert = true;
  els.appRoot.setAttribute("aria-hidden", "true");
  if (loading) showPinLoading(loadingText);
  else showPinLogin({ focus });
}

function unlockApp() {
  els.pinOverlay.classList.remove("pin-loading");
  els.pinOverlay.setAttribute("aria-busy", "false");
  els.appRoot.classList.remove("locked");
  els.appRoot.inert = false;
  els.appRoot.removeAttribute("aria-hidden");
  els.pinOverlay.classList.add("pin-dismissing");
  clearTimeout(pinDismissTimer);
  pinDismissTimer = setTimeout(() => {
    els.pinOverlay.classList.add("hidden");
    els.pinOverlay.classList.remove("pin-dismissing");
  }, 190);
  setPinError("");
  els.pinInput.value = "";
  setUnlockChecking(false);
  setActivity("Ready");
}

async function tryUnlock({ code = "", silent = false } = {}) {
  if (unlocking) return false;

  const entered = normaliseAccessCode(code || els.pinInput.value).trim();
  if (!entered) {
    if (!silent) setPinError("Enter your access code to continue.");
    updateUnlockButtonState();
    return false;
  }
  if (!silent) {
    window.CircuitWashAnalytics?.track("access_code_submitted", {
      source: "access-code-form",
      auth_state: "anonymous"
    });
  }
  unlocking = true;
  setPinError("");
  setUnlockChecking(true);
  els.pinInput.value = entered;
  if (silent) {
    showPinLoading("Restoring your session...");
    els.pinInput.value = entered;
  }

  try {
    const res = await fetch("/.netlify/functions/login", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: entered })
    });

    if (res.status === 200) {
      const data = await res.json();

      resetUpgradePanel();
      activeAccessCode = entered;
      try { localStorage.setItem(ACTIVATE_SESSION_KEY, entered); } catch (_) {}
      try { sessionStorage.removeItem(ACTIVATE_LOGGED_OUT_CODE_KEY); } catch (_) {}
      MACHINES = Array.isArray(data?.machines) ? data.machines : [];
      setSiteTitle(data?.siteName, data?.siteId);
      weeklyUsage = {
        limit: Number(data?.weeklyLimit || 4),
        baseLimit: Number(data?.weeklyBaseLimit || data?.weeklyLimit || 4),
        bonus: Number(data?.weeklyBonus || 0),
        used: Number(data?.weeklyUsed || 0),
        remaining: Number(data?.weeklyRemaining ?? data?.weeklyLimit ?? 4),
        resetAt: String(data?.weeklyResetAt || ""),
        totalUsed: Number(data?.totalUsed || 0),
        totalLimit: Number(data?.totalLimit || 0),
        deleteAfterUse: Boolean(data?.deleteAfterUse)
      };
      selectedMachineKey = MACHINES.length ? getMachineKey(MACHINES[0]) : "";
      connectedDeviceName = "";
      machinesInUse = new Set();
      updateMachinesInUseNotice();
      updateWeeklyUsageNotice();

      els.pinSub.textContent = "Enter your code to access machine controls.";
      renderDeviceMap();
      renderMachineButtons();
      updateConnectButtonLabel();
      setConnectedUI(false);
      setStatus(MACHINES.length ? `ready to connect (${MACHINES[0].name})` : "no machines loaded");
      setActivity("Ready");
      unlockApp();
      return true;
    }

    activeAccessCode = "";
    resetUpgradePanel();

    if (res.status === 401 || res.status === 404 || res.status === 410) {
      try { localStorage.removeItem(ACTIVATE_SESSION_KEY); } catch (_) {}
      showPinLogin({ focus: false, clearInput: silent });
      if (!silent) {
        if (res.status === 401) {
          codeAttempts += 1;
          setPinError("That code wasn’t recognised. Check it and try again.");
        } else if (res.status === 410) {
          setPinError("This code has expired. Try another code or get a new one.");
        } else {
          setPinError("That code wasn’t recognised. Check it and try again.");
        }
        els.pinInput.focus({ preventScroll: true });
      } else if (res.status === 410) {
        setPinError("Your saved code has expired. Enter another code to continue.");
      }
      return false;
    }

    if (silent) showPinLogin({ focus: false, clearInput: true });
    else els.pinSub.textContent = "Enter your code to access machine controls.";
    setPinError(silent
      ? "Your saved session could not be restored. Enter your code again."
      : "We couldn’t check that code right now. Try again.");
    return false;
  } catch (e) {
    activeAccessCode = "";
    resetUpgradePanel();
    if (silent) showPinLogin({ focus: false, clearInput: true });
    else els.pinSub.textContent = "Enter your code to access machine controls.";
    setPinError(silent
      ? "Could not restore your session. Check your connection or enter your code."
      : "Check your connection and try again.");
    if (!silent) els.pinInput.focus({ preventScroll: true });
    return false;
  } finally {
    unlocking = false;
    setUnlockChecking(false);
    updateUnlockButtonState();
  }
}

async function pasteAccessCode() {
  try {
    const clipboardText = await navigator.clipboard.readText();
    const pasted = normaliseAccessCode(clipboardText).trim();
    if (pasted) els.pinInput.value = pasted;
    setPinError("");
    updateUnlockButtonState();
    els.pinInput.focus({ preventScroll: true });
  } catch (_) {
    els.pinInput.focus({ preventScroll: true });
  }
}

async function setupFreeActivationLink() {
  if (!els.freeActivationLink) return;
  els.freeActivationLink.classList.add("hidden");
  els.freeActivationLink.href = "/trial.html";
  if (els.freeActivationLabel) els.freeActivationLabel.textContent = "New to CircuitWash? Try your first wash free";
  try {
    const response = await fetch("/.netlify/functions/free-trial", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.enabled) return;

    const claim = JSON.parse(localStorage.getItem("zaftFreeTrialClaim") || "null");
    if (claim?.used || claim?.activatedAt) return;
    if (claim?.token) {
      const sessionResponse = await fetch("/.netlify/functions/free-trial", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "session", trialToken: claim.token })
      });
      const session = await sessionResponse.json().catch(() => ({}));
      if (sessionResponse.ok && !session?.used) {
        els.freeActivationLink.href = `/trial-activate.html#trial=${encodeURIComponent(claim.token)}`;
        if (els.freeActivationLabel) els.freeActivationLabel.textContent = "New to CircuitWash? Continue your free wash";
        els.freeActivationLink.classList.remove("hidden");
        return;
      }
      if (session?.used) {
        localStorage.setItem("zaftFreeTrialClaim", JSON.stringify({ ...claim, used: true, activatedAt: session.activatedAt || new Date().toISOString() }));
        return;
      }
      if (sessionResponse.status === 400 || sessionResponse.status === 404 || session?.error === "trial_not_found") {
        localStorage.removeItem("zaftFreeTrialClaim");
      } else {
        return;
      }
    }
    els.freeActivationLink.classList.remove("hidden");
  } catch (_) {}
}

async function logoutApp() {
  try { localStorage.removeItem(ACTIVATE_SESSION_KEY); } catch (_) {}
  try {
    if (activeAccessCode) sessionStorage.setItem(ACTIVATE_LOGGED_OUT_CODE_KEY, activeAccessCode);
  } catch (_) {}
  activeAccessCode = "";
  resetUpgradePanel();
  iosBluefyPromptRequested = false;
  MACHINES = [];
  setSiteTitle("");
  weeklyUsage = { limit: 4, used: 0, remaining: 4, resetAt: "" };
  selectedMachineKey = "";
  connectedDeviceName = "";
  machinesInUse = new Set();
  updateMachinesInUseNotice();

  try { await disconnect("logout"); } catch (_) {}

  setPinTitle("Enter access code");
  els.pinSub.textContent = "Enter your code to access machine controls.";
  els.pinInput.value = "";
  setPinError("");
  updateUnlockButtonState();
  renderDeviceMap();
  renderMachineButtons();
  updateConnectButtonLabel();
  setConnectedUI(false);
  setStatus("not connected");
  setActivity("Enter access code", "", "warn");
  lockApp();
}

function showFeedbackPreview() {
  activeAccessCode = "feedback-preview";
  setSiteTitle("CircuitWash Demo");
  MACHINES = [
    {
      id: "washer1",
      name: "Washer 1",
      bluetoothName: "DEMO-WASHER-1",
      type: "washer",
      cycles: {
        standardEco: "Standard Eco",
        extraWash: "Extra Wash",
        extraWashRinse: "Extra Wash + Rinse"
      }
    },
    {
      id: "dryer2",
      name: "Dryer 2",
      bluetoothName: "DEMO-DRYER-2",
      type: "dryer",
      cycles: {
        full: "Full cycle - 60 mins",
        min15: "Last blast - 15 mins"
      }
    }
  ];
  weeklyUsage = { limit: 4, used: 2, remaining: 2, resetAt: "" };
  selectedMachineKey = "washer1";
  connectedDeviceName = "";
  machinesInUse = new Set();

  renderDeviceMap();
  renderMachineButtons();
  updateConnectButtonLabel();
  setConnectedUI(false);
  setStatus("not connected");
  setActivity("Ready", "", "");
  updateMachinesInUseNotice();
  updateWeeklyUsageNotice();
  unlockApp();

  const previewFormUrl = "#feedback-preview";
  setTimeout(() => window.LaundryFeedbackPrompt?.show(previewFormUrl, { preview: true }), 2000);
}

function showUpgradePreview() {
  resetUpgradePanel();
  upgradePreviewMode = true;
  activeAccessCode = "upgrade-preview";
  setSiteTitle("CircuitWash Demo");
  MACHINES = [
    {
      id: "washer1",
      name: "Washer 1",
      bluetoothName: "DEMO-WASHER-1",
      type: "washer",
      cycles: {
        standardEco: "Standard Eco",
        extraWash: "Extra Wash",
        extraWashRinse: "Extra Wash + Rinse"
      }
    },
    {
      id: "dryer2",
      name: "Dryer 2",
      bluetoothName: "DEMO-DRYER-2",
      type: "dryer",
      cycles: {
        full: "Full cycle - 60 mins",
        min15: "Last blast - 15 mins"
      }
    }
  ];
  weeklyUsage = { limit: 4, baseLimit: 4, bonus: 0, used: 4, remaining: 0, resetAt: "" };
  selectedMachineKey = "washer1";
  connectedDeviceName = "";
  machinesInUse = new Set();

  renderDeviceMap();
  renderMachineButtons();
  updateConnectButtonLabel();
  setConnectedUI(false);
  setStatus("weekly limit reached", "warn");
  setActivity("Weekly limit reached", "Add activations preview", "warn");
  updateMachinesInUseNotice();
  updateWeeklyUsageNotice();
  const checkoutState = new URLSearchParams(location.search).get("checkout");
  if (checkoutState === "success") setUpgradeMessage("Test payment completed. No activations were added in preview mode.");
  if (checkoutState === "cancelled") setUpgradeMessage("Test checkout cancelled. No payment was taken.");
  const returnedPaymentIntent = new URLSearchParams(location.search).get("payment_intent");
  if (new URLSearchParams(location.search).get("upgradePayment") === "return" && returnedPaymentIntent) {
    setUpgradeMessage("Confirming test payment…");
    completeUpgradePaymentIntent(returnedPaymentIntent, { preview: true })
      .catch((error) => setUpgradeMessage(upgradeErrorText(String(error?.code || ""), error?.message), "bad"))
      .finally(() => {
        try { history.replaceState({}, "", `${location.pathname}?upgradePreview=1`); } catch (_) {}
      });
  }
  unlockApp();
}

function readActivationCodeFromHash() {
  const params = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  const code = String(params.get("code") || "").trim();
  if (!code || code.length > 128) return "";
  try { history.replaceState({}, "", `${location.pathname}${location.search}`); } catch (_) {}
  return code;
}

function getSavedActivationCode() {
  let savedCode = "";
  const hashCode = readActivationCodeFromHash();
  if (hashCode) {
    try { localStorage.setItem(ACTIVATE_SESSION_KEY, hashCode); } catch (_) {}
    return hashCode;
  }

  try { savedCode = String(localStorage.getItem(ACTIVATE_SESSION_KEY) || "").trim(); } catch (_) {}
  if (savedCode) return savedCode;

  try {
    const raw = localStorage.getItem(PURCHASE_STORAGE_KEY);
    const purchase = raw ? JSON.parse(raw) : null;
    savedCode = String(purchase?.code || "").trim();
    const loggedOutCode = String(sessionStorage.getItem(ACTIVATE_LOGGED_OUT_CODE_KEY) || "").trim();
    if (savedCode && savedCode !== loggedOutCode) {
      localStorage.setItem(ACTIVATE_SESSION_KEY, savedCode);
  return savedCode;
}

async function restoreActivationUpgrade(code, state, sessionId = "") {
  if (!code) {
    showPinLogin({ focus: true, clearInput: false });
    setPinError("Enter the access code that was upgraded to continue.");
    return;
  }

  const unlocked = await tryUnlock({ code, silent: true });
  if (!unlocked) return;
  try {
    if (state === "success") {
      if (!/^cs_(?:test_|live_)?[A-Za-z0-9_]+$/.test(sessionId)) throw new Error("The payment confirmation link is incomplete.");
      await completeActivationUpgrade(sessionId);
    } else {
      setUpgradeMessage("Checkout cancelled. No payment was taken.");
      updateUpgradePanel();
    }
  } catch (error) {
    setUpgradeMessage(upgradeErrorText(String(error?.code || ""), error?.message), "bad");
    updateUpgradePanel();
  } finally {
    try { history.replaceState({}, "", location.pathname); } catch (_) {}
  }
}

async function restoreUpgradePaymentReturn(code, paymentIntentId) {
  if (!code) {
    showPinLogin({ focus: true, clearInput: false });
    setPinError("Enter the access code that was upgraded to continue.");
    return;
  }
  const unlocked = await tryUnlock({ code, silent: true });
  if (!unlocked) return;
  try {
    setUpgradeMessage("Confirming your payment…");
    await completeUpgradePaymentIntent(paymentIntentId, { preview: false });
  } catch (error) {
    setUpgradeMessage(upgradeErrorText(String(error?.code || ""), error?.message), "bad");
    updateUpgradePanel();
  } finally {
    try { history.replaceState({}, "", location.pathname); } catch (_) {}
  }
}
  } catch (_) {}

  return "";
}

function resetRx() {
  notificationText = "";
}

function onNotify(event) {
  try {
    const value = event.target.value;
    const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    notificationText += dec.decode(chunk);
  } catch (e) { debugOnly(`Notify parse error: ${String(e)}`, "warn"); }
}

async function writeAscii(text) {
  if (!txChar) throw new Error("TX characteristic not ready");
  const bytes = enc.encode(text);
  try { await txChar.writeValueWithoutResponse(bytes); }
  catch { await txChar.writeValue(bytes); }
}

async function sendAndWatchForError(text, waitMs) {
  notificationText = "";
  await writeAscii(text);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const response = notificationText;
  notificationText = "";
  if (!response.toUpperCase().includes("ERROR")) return;

  const error = new Error(`Machine reported ${response.trim() || "ERROR"}`);
  error.code = "machine_error";
  error.response = response;
  throw error;
}

async function enableRxNotifications() {
  if (rxChar) return;
  if (!service) throw new Error("Bluetooth service not ready");

  const characteristic = await service.getCharacteristic(RX_UUID);
  characteristic.addEventListener("characteristicvaluechanged", onNotify);
  try {
    await characteristic.startNotifications();
    rxChar = characteristic;
  } catch (error) {
    try { characteristic.removeEventListener("characteristicvaluechanged", onNotify); } catch {}
    throw error;
  }
}

function updateWeeklyUsageFromData(data) {
  weeklyUsage = {
    limit: Number(data.limit || weeklyUsage.limit || 4),
    baseLimit: Number(data.baseLimit || weeklyUsage.baseLimit || data.limit || weeklyUsage.limit || 4),
    bonus: Number(data.bonus || 0),
    used: Number(data.used || 0),
    remaining: Number(data.remaining || 0),
    resetAt: String(data.resetAt || weeklyUsage.resetAt || ""),
    totalUsed: Number(data.totalUsed || weeklyUsage.totalUsed || 0),
    totalLimit: Number(data.totalLimit || weeklyUsage.totalLimit || 0),
    deleteAfterUse: Boolean(data.deleteAfterUse ?? weeklyUsage.deleteAfterUse)
  };
  updateWeeklyUsageNotice();
}

async function refreshWeeklyUsage() {
  if (!activeAccessCode) return weeklyUsage;
  try {
    const res = await fetch("/.netlify/functions/login", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "usage_status", code: activeAccessCode })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok !== false) updateWeeklyUsageFromData(data);
  } catch (_) {}
  return weeklyUsage;
}

async function requestActivationCommand(machine, cycleKey) {
  if (!activeAccessCode) throw new Error("No active access code");
  if (!machine) throw new Error("No machine selected");

  const res = await fetch("/.netlify/functions/login", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "prepare_activation",
      code: activeAccessCode,
      machineId: getMachineKey(machine),
      cycleKey
    })
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 429 || data.error === "weekly_limit_reached") {
    weeklyUsage = {
      limit: Number(data.limit || weeklyUsage.limit || 4),
      baseLimit: Number(data.baseLimit || weeklyUsage.baseLimit || data.limit || weeklyUsage.limit || 4),
      bonus: Number(data.bonus || 0),
      used: Number(data.used || weeklyUsage.used || 0),
      remaining: 0,
      resetAt: String(data.resetAt || weeklyUsage.resetAt || ""),
      totalUsed: Number(data.totalUsed || weeklyUsage.totalUsed || 0),
      totalLimit: Number(data.totalLimit || weeklyUsage.totalLimit || 0),
      deleteAfterUse: Boolean(data.deleteAfterUse ?? weeklyUsage.deleteAfterUse)
    };
    updateWeeklyUsageNotice();
    const error = new Error("Weekly activation limit reached");
    error.code = "weekly_limit_reached";
    throw error;
  }

  if (!res.ok || data.ok === false || !data.activationCommand) {
    throw new Error(data.error || `Activation request failed (${res.status})`);
  }

  updateWeeklyUsageFromData(data);
  return String(data.activationCommand);
}

async function completeTrialActivationIfNeeded(machine, cycleKey) {
  if (!activeAccessCode || !isFreeTrialCode()) return;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch("/.netlify/functions/login", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete_activation",
          code: activeAccessCode,
          machineId: getMachineKey(machine),
          cycleKey
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `Activation completion failed (${res.status})`);
      updateWeeklyUsageFromData(data);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  console.error("Could not complete free trial activation", lastError);
}

async function runSequence(machine, cycleKey) {
  let stage = "rx_notifications";
  unexpectedBluetoothDisconnectReported = false;
  try {
    bluetoothFailureStage = stage;
    resetRx();
    await enableRxNotifications();
    setActivity("Authorising start", "Preparing secure command", "warn");
    stage = "authorization";
    bluetoothFailureStage = stage;
    let activateCmd = await requestActivationCommand(machine, cycleKey);
    stage = "handshake";
    bluetoothFailureStage = stage;
    await sendAndWatchForError(CMD.HANDSHAKE, 1000);
    stage = "activation";
    bluetoothFailureStage = stage;
    await sendAndWatchForError(activateCmd, 1000);
    activateCmd = "";
    stage = "execution";
    bluetoothFailureStage = stage;
    await sendAndWatchForError(CMD.EXEC, 2000);
    stage = "completion";
    bluetoothFailureStage = stage;
    await completeTrialActivationIfNeeded(machine, cycleKey);

    preserveSuccessDisconnectUI = true;
    clearTimeout(cycleCooldownTimer);
    for (const button of dynamicButtons) button.disabled = true;
    setStatus(`${machine?.name || "machine"} started`, "ok");
    setActivity(lastStartedMachineLabel || "Started", "", "ok");

    await new Promise((resolve) => setTimeout(resolve, 2700));

    setActivity(lastStartedMachineLabel || "Started ✅", "", "ok");
    await new Promise((resolve) => setTimeout(resolve, 900));
    await disconnect("sequence-complete");
    setTimeout(() => window.LaundryFeedbackPrompt?.maybeShow(), 2200);
  } catch (e) {
    preserveSuccessDisconnectUI = false;
    const limitReached = e?.code === "weekly_limit_reached";
    if (!limitReached && !unexpectedBluetoothDisconnectReported && ["rx_notifications", "handshake", "activation", "execution"].includes(stage)) {
      reportBluetoothFailure("bluetooth_activation_failed", { stage, error: e, machine });
    }
    if (limitReached) {
      const [main, sub] = usageLimitActivityText();
      setActivity(main, sub, "warn");
    } else {
      setActivity("Could not start", "Reconnect and try again.", "warn");
    }
    if (isConnected()) await disconnect("sequence-error");
    setStatus(limitReached ? "Weekly limit reached" : `Couldn’t start ${machine?.name || "machine"}`, limitReached ? "warn" : "bad");
  }
  bluetoothFailureStage = isConnected() ? "connected" : "idle";
}

function getBluetoothRequestOptions(machine) {
  const bluetoothName = String(machine?.bluetoothName || "").trim();
  if (!bluetoothName) throw new Error("Selected machine has no bluetoothName configured");

  return {
    filters: [{ name: bluetoothName }],
    optionalServices: [
      SERVICE_UUID,
      HEART_RATE_SERVICE_UUID
    ]
  };
}

function dataViewToHex(view) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}

function dataViewToText(view) {
  try {
    return dec.decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
      .replace(/\0/g, "")
      .trim();
  } catch {
    return "";
  }
}

async function getOccupancyCharacteristic() {
  if (!server) throw new Error("Bluetooth server not ready");

  // First try the app's custom service, in case this characteristic lives there.
  try {
    return await service.getCharacteristic(OCCUPANCY_UUID);
  } catch {}

  // 00002a37 is also the standard Heart Rate Measurement characteristic UUID,
  // so try the standard heart-rate service as a fallback.
  try {
    const heartRateService = await server.getPrimaryService(HEART_RATE_SERVICE_UUID);
    return await heartRateService.getCharacteristic(OCCUPANCY_UUID);
  } catch {}

  throw new Error("Occupancy characteristic not found");
}

async function checkSelectedMachineInUse({ silent = false } = {}) {
  const machine = getSelectedMachine();
  if (!machine) return { blocked: false, reason: "No machine selected" };

  try {
    const occupancyChar = await getOccupancyCharacteristic();
    const value = await occupancyChar.readValue();

    const textValue = dataViewToText(value);
    const hexValue = dataViewToHex(value);

    const isInUse = textValue === "1120" || hexValue === "1120";
    const key = getMachineKey(machine);

    if (isInUse) {
      machinesInUse.add(key);
      updateMachinesInUseNotice();
      setActivity("Machine in use", `${machine.name} is currently in use.`, "warn");
      setStatus(`${machine.name} in use`, "warn");
      return { blocked: true, reason: "Machine in use", raw: textValue || hexValue };
    }

    machinesInUse.delete(key);
    updateMachinesInUseNotice();

    if (!silent) {
      setActivity("Machine available", `${machine.name} can continue.`, "ok");
    }

    return { blocked: false, reason: "Available", raw: textValue || hexValue };
  } catch (e) {
    updateMachinesInUseNotice(`Could not check ${machine.name}; continuing.`);

    if (!silent) {
      setActivity("Could not check usage", "Continuing anyway.", "warn");
    }

    return { blocked: false, reason: "Read error, continuing" };
  }
}

async function connect() {
  const selected = getSelectedMachine();
  hideBluetoothRoomNotice();

  if (!selected) { setActivity("Select a machine first", "", "warn"); setStatus("select a machine first"); return; }
  if (!selected.bluetoothName) { setActivity("Machine not ready", "", "warn"); setStatus("machine unavailable"); return; }

  if (!window.isSecureContext) {
    reportBluetoothFailure("bluetooth_connection_failed", { stage: "secure_context", error: new Error("A secure browser context is required"), machine: selected });
    setActivity("Open securely", "Use HTTPS or localhost.", "warn"); setStatus("secure context required"); return;
  }

  if (!navigator.bluetooth) {
    if (isIOSDevice()) {
      showIOSBluefyNotes({ request: true });
      setActivity("Ready", "", "");
      setStatus(`ready to connect (${selected.name})`);
    } else {
      setActivity("Bluetooth unavailable", "", "warn");
      setStatus("bluetooth unavailable", "warn");
    }
    return;
  }

  if (!MACHINES.length) { setActivity("Enter access code first", "", "warn"); setStatus("unlock first"); return; }
  if (Number(weeklyUsage.remaining) <= 0) {
    await refreshWeeklyUsage();
  }
  if (Number(weeklyUsage.remaining) <= 0) {
    const [main, sub] = usageLimitActivityText();
    setActivity(main, sub, "warn");
    setStatus("weekly limit reached", "warn");
    return;
  }

  els.connectBtn.disabled = true;
  let stage = "device_request";
  unexpectedBluetoothDisconnectReported = false;

  try {
    resetRx("Preparing new connection");
    setActivity(`Connecting to ${selected.name}…`, "", "warn");
    setStatus(`Connecting to ${selected.name}…`);

    bluetoothFailureStage = stage;
    device = await navigator.bluetooth.requestDevice(getBluetoothRequestOptions(selected));
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

    stage = "occupancy_check";
    bluetoothFailureStage = stage;
    const occupancy = await checkSelectedMachineInUse({ silent: true });

    bluetoothFailureStage = "connected";
    setConnectedUI(true);

    if (occupancy.blocked) {
      for (const button of dynamicButtons) button.disabled = true;
      setStatus(`${selected.name} in use`, "warn");
      setActivity("Machine in use", selected.name, "warn");
    } else if (isDeviceMatchForSelection()) {
      setStatus(`connected to ${selected.name}`, "ok");
      setActivity("Connected", selected.name, "ok");
    } else {
      setStatus("connected");
      setActivity("Connected", "Select matching machine", "warn");
    }
  } catch (e) {
    const chooserCancelled = isBluetoothChooserCancellation(stage, e);
    if (!chooserCancelled && !unexpectedBluetoothDisconnectReported) {
      reportBluetoothFailure("bluetooth_connection_failed", { stage, error: e, machine: selected });
    }
    await disconnect("connect-failed");
    if (chooserCancelled) {
      setStatus(`ready to connect (${selected.name})`);
      setActivity("Ready", "", "");
      showBluetoothRoomNotice();
      return;
    }
    setStatus(`Couldn’t connect to ${selected.name}`, "bad");
    setActivity("Connection failed", "Try again", "bad");
  } finally {
    if (!isConnected()) {
      bluetoothFailureStage = "idle";
      updateConnectButtonLabel();
      els.connectBtn.disabled = !getSelectedMachine();
    }
  }
}

async function disconnect(reason = "manual") {
  const currentDevice = device;
  const currentRxChar = rxChar;

  try {
    if (currentRxChar) {
      try { currentRxChar.removeEventListener("characteristicvaluechanged", onNotify); } catch {}
      try { await currentRxChar.stopNotifications(); } catch {}
    }
    if (currentDevice) {
      try { currentDevice.removeEventListener("gattserverdisconnected", onDisconnected); } catch {}
    }
    if (currentDevice?.gatt?.connected) currentDevice.gatt.disconnect();
  } finally {
    const preserveSuccess = reason === "sequence-complete" || preserveSuccessDisconnectUI;
    device = null; server = null; service = null; rxChar = null; txChar = null; connectedDeviceName = "";
    bluetoothFailureStage = "idle";
    resetRx("Disconnected");
    setConnectedUI(false);
    updateConnectButtonLabel();

    if (preserveSuccess) {
      preserveSuccessDisconnectUI = false;
      setStatus("activation complete");
      return;
    }

    setStatus("not connected");
    if (reason === "machine-changed") setActivity("Ready", "Machine changed", "");
    else setActivity("Ready", "", "");
  }
}

function onDisconnected() {
  const preserveSuccess = preserveSuccessDisconnectUI;
  const failureMachine = getSelectedMachine();
  const failureDeviceName = connectedDeviceName;
  if (!preserveSuccess) {
    unexpectedBluetoothDisconnectReported = true;
    reportBluetoothFailure("bluetooth_unexpected_disconnect", {
      stage: bluetoothFailureStage === "idle" ? "connected" : bluetoothFailureStage,
      error: new Error("The Bluetooth device disconnected unexpectedly"),
      machine: failureMachine,
      bluetoothDeviceName: failureDeviceName
    });
  }
  device = null; server = null; service = null; rxChar = null; txChar = null; connectedDeviceName = "";
  bluetoothFailureStage = "idle";
  resetRx("Device disconnected");
  setConnectedUI(false);
  updateConnectButtonLabel();
  if (preserveSuccess) {
    preserveSuccessDisconnectUI = false;
    return;
  }
  setStatus("not connected");
  setActivity("Ready", "", "");
}

function renderDeviceMap() {
  if (!MACHINES.length) {
    els.deviceMap.innerHTML = '<div class="machine-empty">No machines loaded yet.</div>';
    showIOSBluefyNotes();
    return;
  }

  const exists = MACHINES.some((m) => getMachineKey(m) === selectedMachineKey);
  if (!exists) selectedMachineKey = getMachineKey(MACHINES[0]);
  const machine = getSelectedMachine();
  const machineId = String(machine?.bluetoothName || getMachineKey(machine) || "").trim();
  els.deviceMap.innerHTML = `
    <button id="machinePickerTrigger" class="machine-selector" type="button" aria-haspopup="dialog" aria-expanded="false">
      <span class="machine-type-icon" data-machine-type="${machineType(machine)}">${machineIconMarkup(machine)}</span>
      <span class="machine-selector-copy">
        <strong>${escapeHtml(machine?.name || "Choose a machine")}</strong>
        ${machineId ? `<code>${escapeHtml(machineId)}</code>` : ""}
      </span>
      <span class="machine-selector-change"><span>Change</span><i aria-hidden="true"></i></span>
    </button>
  `;
  document.getElementById("machinePickerTrigger")?.addEventListener("click", openMachinePicker);
  renderMachinePicker();
  showIOSBluefyNotes();
}

function getCyclePresentation(machine, cycleKey, cycleValue) {
  const label = String(getCycleLabel(cycleKey, cycleValue) || cycleKey).trim();
  const durationMatch = label.match(/(\d+)\s*(?:mins?|minutes?)/i);
  const duration = durationMatch ? `${durationMatch[1]} min` : "";
  const title = label
    .replace(/\s*[-–—·]?\s*\d+\s*(?:mins?|minutes?)\s*/i, "")
    .replace(/\s*[-–—]\s*$/, "")
    .trim() || label;
  const fallback = machineType(machine) === "dryer" ? "Dryer cycle" : machineType(machine) === "washer" ? "Wash cycle" : "Machine cycle";
  return { label, title, meta: duration || fallback, duration };
}

function renderMachineButtons() {
  els.machineButtons.innerHTML = "";
  dynamicButtons.length = 0;

  const machine = getSelectedMachine();
  if (!machine) return;

  for (const [cycleKey, cycleValue] of Object.entries(getMachineCycles(machine))) {
    const cycle = getCyclePresentation(machine, cycleKey, cycleValue);

    const button = document.createElement("button");
    button.innerHTML = `<span class="cycle-button-copy"><strong>${escapeHtml(cycle.title)}</strong></span><span class="cycle-button-arrow" aria-hidden="true">→</span>`;
    button.className = "cycle-button";
    if (machineType(machine) === "dryer" && cycle.duration) {
      const duration = document.createElement("small");
      duration.textContent = cycle.duration;
      button.querySelector(".cycle-button-copy")?.appendChild(duration);
    }
    button.setAttribute("aria-label", `Start ${cycle.label} on ${machine.name}`);
    button.disabled = true;

    button.addEventListener("click", async () => {
      tapHaptic();
      try {
        if (Number(weeklyUsage.remaining) <= 0) await refreshWeeklyUsage();
        if (Number(weeklyUsage.remaining) <= 0) { const [main, sub] = usageLimitActivityText(); setActivity(main, sub, "warn"); return; }
        if (!isConnected()) { setActivity("Connect first", "", "warn"); return; }
        if (!isDeviceMatchForSelection()) { setActivity("Reconnect", "Wrong machine selected", "warn"); return; }

        const occupancy = await checkSelectedMachineInUse();

        if (occupancy.blocked) {
          for (const button of dynamicButtons) button.disabled = true;
          return;
        }

        lastStartedMachineLabel = `${machine.name} started — ${cycle.label}`;
        setActivity("Starting…", `${machine.name} — ${cycle.label}`, "warn");
        setStatus(`Starting ${machine.name}…`);
        temporarilyDisableCycleButtons(3000);
        await runSequence(machine, cycleKey);
      } catch {
        setActivity("Could not start", "Try again", "warn");
        setStatus(`Couldn’t start ${machine.name}`, "bad");
      }
    });

    els.machineButtons.appendChild(button);
    dynamicButtons.push(button);
  }
}

els.connectBtn.addEventListener("click", () => { tapHaptic(); connect(); });
els.logoutBtn.addEventListener("click", () => { tapHaptic(); logoutApp(); });
els.unlockBtn.addEventListener("click", () => { tapHaptic(); tryUnlock(); });
els.pasteCodeBtn?.addEventListener("click", pasteAccessCode);
els.upgradeBtn.addEventListener("click", () => { tapHaptic(); beginActivationUpgrade(); });
els.upgradePanelToggle.addEventListener("click", () => { tapHaptic(); toggleUpgradePanel(); });
els.upgradePaymentCloseBtn.addEventListener("click", closeUpgradePaymentSheet);
els.upgradeCardToggle.addEventListener("click", toggleUpgradeCardPayment);
upgradePaymentRoot.querySelectorAll("[data-close-payment-sheet]").forEach((element) => element.addEventListener("click", closeUpgradePaymentSheet));
els.upgradePaymentForm.addEventListener("submit", (event) => { event.preventDefault(); confirmUpgradePayment(); });
els.pinInput.addEventListener("input", (event) => {
  if (!event.isComposing) normalisePinInput();
  setPinError("");
  updateUnlockButtonState();
});
els.pinInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (accessCodeLooksValid()) tryUnlock();
  else setPinError("Enter your access code to continue.");
});
els.changeSiteBtn.addEventListener("click", () => { tapHaptic(); openChangeSite(); });
els.closeChangeSiteBtn.addEventListener("click", closeChangeSite);
els.closeMachinePickerBtn.addEventListener("click", closeMachinePicker);
els.machinePickerOverlay.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-machine-picker]")) closeMachinePicker();
});
els.changeSiteSearch.addEventListener("input", () => {
  clearTimeout(changeSiteSearchTimer);
  const query = els.changeSiteSearch.value.trim();
  if (query.length < 2) {
    activationSiteSelector.hide();
  }
  changeSiteSearchTimer = setTimeout(searchChangeSites, 220);
});
els.changeSiteSearch.addEventListener("keydown", (event) => activationSiteSelector.handleKeydown(event));
window.addEventListener("popstate", () => {
  if (!els.changeSiteOverlay.classList.contains("hidden")) closeChangeSite({ fromPopState: true });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.machinePickerOverlay.classList.contains("hidden")) {
    closeMachinePicker();
    return;
  }
  if (event.key === "Escape" && !els.changeSiteOverlay.classList.contains("hidden")) closeChangeSite();
});
window.addEventListener("pageshow", retryPendingBluefyOpen);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) retryPendingBluefyOpen();
});
document.querySelectorAll("[data-ios-bluefy]").forEach((element) => {
  element.addEventListener("click", (event) => {
    if (event.target === element) dismissIOSBluefyNotes();
  });
});
document.querySelectorAll("[data-ios-bluefy-dismiss]").forEach((button) => {
  button.addEventListener("click", dismissIOSBluefyNotes);
});
document.querySelectorAll("[data-bluefy-open]").forEach((link) => {
  link.addEventListener("click", openCurrentActivationInBluefy);
});
els.freeActivationLink?.addEventListener("click", () => {
  window.CircuitWashAnalytics?.track("trial_cta_clicked", {
    source: "access-code-escape",
    auth_state: "anonymous"
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.upgradePaymentSheet.classList.contains("hidden")) closeUpgradePaymentSheet();
});

window.showFeedbackPreview = showFeedbackPreview;
window.showUpgradePreview = showUpgradePreview;

(function init() {
  window.LaundryFeedbackPrompt?.init({ getAccessCode: () => activeAccessCode });
  setupFreeActivationLink();
  showIOSBluefyNotes();
  renderDeviceMap();
  renderMachineButtons();
  updateConnectButtonLabel();
  setConnectedUI(false);
  setStatus("not connected");
  setActivity("Enter access code", "", "warn");
  attachTouchFeedback();
  updateMachinesInUseNotice();
  updateWeeklyUsageNotice();

  if (!navigator.bluetooth) {
    setActivity("Bluetooth unavailable", "", "warn");
    setStatus("bluetooth unavailable", "warn");
  }

  const query = new URLSearchParams(location.search);
  const feedbackPreview = query.get("feedbackPreview") === "1";
  const upgradePreview = query.get("upgradePreview") === "1";
  const upgradeReturnState = String(query.get("upgrade") || "");
  const upgradeSessionId = String(query.get("session_id") || "");
  const upgradePaymentReturn = query.get("upgradePayment") === "return";
  const returnedUpgradeIntent = String(query.get("payment_intent") || "");
  if (upgradePreview) {
    lockApp({ loading: true, loadingText: "Opening preview..." });
    setTimeout(showUpgradePreview, 150);
    return;
  }
  if (feedbackPreview) {
    lockApp({ loading: true, loadingText: "Opening preview..." });
    setTimeout(showFeedbackPreview, 150);
    return;
  }

  const savedCode = getSavedActivationCode();
  lockApp({ loading: Boolean(savedCode), focus: !savedCode });
  if (upgradeReturnState === "success" || upgradeReturnState === "cancelled") {
    setTimeout(() => restoreActivationUpgrade(savedCode, upgradeReturnState, upgradeSessionId), 0);
    return;
  }
  if (upgradePaymentReturn && returnedUpgradeIntent) {
    setTimeout(() => restoreUpgradePaymentReturn(savedCode, returnedUpgradeIntent), 0);
    return;
  }
  if (savedCode) {
    setTimeout(() => tryUnlock({ code: savedCode, silent: true }), 0);
  }
})();
