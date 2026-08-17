const PURCHASE_STORAGE_KEY = "laundryAccessPurchase";
const EMAIL_STORAGE_KEY = "laundryAccessEmail";
const ACTIVATE_SESSION_KEY = "laundryActivateAccessCode";
const ANALYTICS_VISITOR_KEY = "laundryAnalyticsVisitor";
const ANALYTICS_SESSION_KEY = "laundryAnalyticsSession";
const ANALYTICS_SITE_HITS_KEY = "laundryAnalyticsSiteHits";
const ANALYTICS_SITE_HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const checkoutParams = new URLSearchParams(location.search);
const checkoutEndpoint = "/.netlify/functions/stripe-checkout";

const els = {
  purchaseHeading: document.getElementById("purchaseHeading"),
  purchaseCard: document.getElementById("purchaseCard"),
  heroEyebrow: document.getElementById("heroEyebrow"),
  heroTitle: document.getElementById("heroTitle"),
  heroSubtext: document.getElementById("heroSubtext"),
  siteSearchWrap: document.getElementById("siteSearchWrap"),
  siteSearch: document.getElementById("siteSearch"),
  searchSpinner: document.getElementById("searchSpinner"),
  siteResults: document.getElementById("siteResults"),
  siteHelp: document.getElementById("siteHelp"),
  selectedSite: document.getElementById("selectedSite"),
  selectedSiteName: document.getElementById("selectedSiteName"),
  selectedSiteAddress: document.getElementById("selectedSiteAddress"),
  changeSiteBtn: document.getElementById("changeSiteBtn"),
  paymentSection: document.getElementById("paymentSection"),
  accessSummaryLabel: document.getElementById("accessSummaryLabel"),
  accessSummaryNote: document.getElementById("accessSummaryNote"),
  priceText: document.getElementById("priceText"),
  customerEmail: document.getElementById("customerEmail"),
  emailPrompt: document.getElementById("emailPrompt"),
  promoDetails: document.getElementById("promoDetails"),
  promoCodeInput: document.getElementById("promoCodeInput"),
  applyPromoBtn: document.getElementById("applyPromoBtn"),
  clearPromoBtn: document.getElementById("clearPromoBtn"),
  promoMessage: document.getElementById("promoMessage"),
  returnNotice: document.getElementById("returnNotice"),
  paymentHeading: document.getElementById("paymentHeading"),
  freeCheckoutBtn: document.getElementById("freeCheckoutBtn"),
  checkoutButton: document.getElementById("checkoutButton"),
  paymentMethods: document.getElementById("paymentMethods"),
  paymentSheetPanel: document.getElementById("paymentSheetPanel"),
  paymentSheetHeader: document.getElementById("paymentSheetHeader"),
  paymentSheetCloseBtn: document.getElementById("paymentSheetCloseBtn"),
  paymentSheetSubtitle: document.getElementById("paymentSheetSubtitle"),
  paymentSheetTotal: document.getElementById("paymentSheetTotal"),
  paymentSheetLoader: document.getElementById("paymentSheetLoader"),
  paymentSheetContent: document.getElementById("paymentSheetContent"),
  cardPaymentToggle: document.getElementById("cardPaymentToggle"),
  cardPoweredBy: document.getElementById("cardPoweredBy"),
  expressCheckout: document.getElementById("expressCheckout"),
  expressCheckoutElement: document.getElementById("expressCheckoutElement"),
  expressCheckoutHeading: document.getElementById("expressCheckoutHeading"),
  paymentDivider: document.getElementById("paymentDivider"),
  cardFieldsWrap: document.getElementById("cardFieldsWrap"),
  cardFieldsForm: document.getElementById("cardFieldsForm"),
  stripePaymentForm: document.getElementById("stripePaymentForm"),
  paymentElement: document.getElementById("paymentElement"),
  stripeSubmitBtn: document.getElementById("stripeSubmitBtn"),
  paymentMessage: document.getElementById("paymentMessage"),
  checkoutView: document.getElementById("checkoutView"),
  successView: document.getElementById("successView"),
  successSiteText: document.getElementById("successSiteText"),
  emailStatusText: document.getElementById("emailStatusText"),
  accessCodeLabel: document.getElementById("accessCodeLabel"),
  accessCode: document.getElementById("accessCode"),
  copyCodeBtn: document.getElementById("copyCodeBtn"),
  resendEmailBtn: document.getElementById("resendEmailBtn"),
  newPurchaseBtn: document.getElementById("newPurchaseBtn"),
  copyMessage: document.getElementById("copyMessage"),
  stepSite: document.getElementById("stepSite"),
  stepPay: document.getElementById("stepPay"),
  stepCode: document.getElementById("stepCode")
};

const searchMode = "all";
let selectedSite = null;
let searchTimer = null;
let searchRequestId = 0;
let resultSites = [];
let highlightedIndex = -1;
let checkoutConfig = null;
let paymentBusy = false;
let activePurchase = null;
let appliedPromo = null;
let stripe = null;
let elements = null;
let cardElement = null;
let cardElementMounted = false;
let cardElementReady = false;
let expressCheckoutElement = null;
let activeIntent = null;
let activeElementsKey = "";
let preparingElementsKey = "";
let paymentSheetOpen = false;
let paymentSheetRequested = false;
let paymentOptionsReady = false;
let expressCheckoutReady = false;
let walletPaymentAvailable = false;
let cardPaymentExpanded = true;
let emailWasInteracted = false;

function setPaymentMessage(text, tone = "") {
  els.paymentMessage.textContent = text;
  els.paymentMessage.className = `message ${tone}`.trim();
}

function setReturnNotice(text, tone = "") {
  if (!els.returnNotice) return;
  els.returnNotice.textContent = text;
  els.returnNotice.className = `message ${tone} ${text ? "" : "hidden"}`.trim();
}

function setPaymentSheetLoading(loading) {
  const isLoading = Boolean(loading);
  els.paymentMethods.classList.toggle("is-loading", isLoading);
  els.paymentMethods.setAttribute("aria-busy", String(isLoading));
  els.paymentSheetLoader?.setAttribute("aria-hidden", String(!isLoading));
  els.paymentSheetContent?.setAttribute("aria-hidden", String(isLoading));
}

function setCardPaymentExpanded(expanded) {
  cardPaymentExpanded = Boolean(expanded);
  els.cardFieldsWrap.classList.toggle("is-condensed", !cardPaymentExpanded);
  els.cardFieldsWrap.classList.toggle("is-expanded", cardPaymentExpanded);
  els.cardFieldsForm.setAttribute("aria-hidden", String(!cardPaymentExpanded));
  els.cardFieldsWrap.removeAttribute("tabindex");
  els.cardFieldsWrap.removeAttribute("role");
  els.cardFieldsWrap.removeAttribute("aria-expanded");
  els.cardFieldsWrap.removeAttribute("aria-label");
  els.cardPoweredBy?.setAttribute("aria-hidden", String(cardPaymentExpanded));
  if (els.cardPaymentToggle) {
    els.cardPaymentToggle.disabled = !walletPaymentAvailable;
    els.cardPaymentToggle.setAttribute("aria-hidden", String(!walletPaymentAvailable));
    els.cardPaymentToggle.setAttribute("aria-expanded", String(cardPaymentExpanded));
    els.cardPaymentToggle.setAttribute(
      "aria-label",
      cardPaymentExpanded ? "Collapse card payment" : "Expand card payment"
    );
  }
  if ("inert" in els.stripePaymentForm) els.stripePaymentForm.inert = !cardPaymentExpanded;
}

function markPaymentOptionsReady() {
  if (paymentOptionsReady || !expressCheckoutReady || !cardElementReady) return;
  window.setTimeout(() => {
    paymentOptionsReady = true;
    els.checkoutButton.disabled = false;
    setStripeSubmitState(false, checkoutConfig ? formatCheckoutMoney(currentCheckoutTotal()) : "");
    if (paymentSheetRequested) setPaymentSheetOpen(true);
  }, 120);
}

function setPaymentSheetOpen(open) {
  paymentSheetOpen = Boolean(open);
  if (paymentSheetOpen) {
    paymentSheetRequested = false;
    els.paymentMethods.classList.remove("hidden");
    setPaymentSheetLoading(false);
    setCardPaymentExpanded(!walletPaymentAvailable);
    els.checkoutButton.disabled = false;
    setTimeout(() => els.paymentSheetCloseBtn?.focus(), 0);
  } else {
    paymentSheetRequested = false;
    els.paymentMethods.classList.add("hidden");
    setPaymentSheetLoading(false);
    els.checkoutButton.disabled = false;
    resetCardPaymentSurface();
    setStripeSubmitState(false, checkoutConfig ? formatCheckoutMoney(currentCheckoutTotal()) : "");
  }
  document.body.classList.toggle("payment-sheet-open", paymentSheetOpen);
}

function showPaymentSheetLoading() {
  paymentSheetOpen = true;
  paymentSheetRequested = true;
  els.paymentMethods.classList.remove("hidden");
  setPaymentSheetLoading(true);
  els.checkoutButton.disabled = true;
  els.checkoutButton.textContent = "Preparing secure checkout…";
  document.body.classList.add("payment-sheet-open");
  setTimeout(() => els.paymentSheetCloseBtn?.focus(), 0);
}

function openPaymentSheet() {
  if (!selectedSite || !isValidEmail(els.customerEmail.value) || Number(currentCheckoutTotal()) <= 0) {
    emailWasInteracted = true;
    updatePaymentAvailability({ revealErrors: true });
    if (!isValidEmail(els.customerEmail.value)) els.customerEmail.focus();
    return;
  }
  if (els.paymentSheetSubtitle && selectedSite) {
    els.paymentSheetSubtitle.textContent = `Laundry access for ${selectedSite.name}.`;
  }
  if (els.paymentSheetTotal) {
    els.paymentSheetTotal.textContent = formatCheckoutMoney(currentCheckoutTotal());
  }
  setPaymentMessage("");
  if (paymentOptionsReady && elements) {
    setPaymentSheetOpen(true);
    return;
  }
  showPaymentSheetLoading();
  prepareStripeElements();
}

function closePaymentSheet() {
  setPaymentSheetOpen(false);
}

function updateSteps(stage) {
  const siteDone = stage === "pay" || stage === "code";
  const payDone = stage === "code";

  els.stepSite.className = `step ${siteDone ? "complete" : "active"}`;
  els.stepPay.className = `step ${stage === "pay" ? "active" : payDone ? "complete" : ""}`.trim();
  els.stepCode.className = `step ${stage === "code" ? "active" : ""}`.trim();
}

function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function formatSiteAddress(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u060C\uFE50\uFF0C]/g, ",")
    .split(",")
    .map((part) => part.replace(/^[\s,]+|[\s,]+$/g, "").replace(/\s+/g, " "))
    .filter(Boolean)
    .join(", ");
}

function isValidEmail(value) {
  const email = normaliseEmail(value);
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getCustomerEmail() {
  return normaliseEmail(els.customerEmail.value);
}

function formatCheckoutMoney(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: checkoutConfig?.currency || "GBP"
  }).format(Number(value) || 0);
}

function currentCheckoutTotal() {
  return String(appliedPromo?.total || checkoutConfig?.price || "0.00");
}

function currentPromoCode() {
  return String(appliedPromo?.promo?.code || "");
}

function currentSelectionIsFreeTrial() {
  return Boolean(appliedPromo?.promo?.allowFree) && Number(appliedPromo?.promo?.accessMaxTotalUses || 0) === 1;
}

function purchaseIsFreeTrial(purchase) {
  return String(purchase?.accessTerm || "") === "free_trial" || Boolean(purchase?.deleteAfterUse);
}

function setPromoMessage(text, tone = "") {
  els.promoMessage.textContent = text;
  els.promoMessage.className = `promo-status ${tone}`.trim();
}

function sanitizePromoCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

function updatePriceDisplay() {
  if (!checkoutConfig) return;
  updateAccessSummaryCopy();
  const totalText = formatCheckoutMoney(currentCheckoutTotal());
  els.priceText.textContent = totalText;
  if (els.paymentSheetTotal) els.paymentSheetTotal.textContent = totalText;
  resetStripeElements();
  if (appliedPromo?.promo?.code) {
    els.promoDetails.open = true;
    setPromoMessage(
      `${appliedPromo.promo.code} applied: -${formatCheckoutMoney(appliedPromo.discountAmount)}`,
      "ok"
    );
    els.clearPromoBtn.classList.remove("hidden");
  } else {
    setPromoMessage("");
    els.clearPromoBtn.classList.add("hidden");
  }
  updatePaymentAvailability();
}

function updateAccessSummaryCopy() {
  if (!els.accessSummaryLabel || !els.accessSummaryNote) return;
  if (currentSelectionIsFreeTrial()) {
    if (els.heroSubtext) {
      els.heroSubtext.textContent = selectedSite
        ? "Confirm your email to receive your temporary free-trial code."
        : "Choose your site and claim a temporary free trial to test the product.";
    }
    els.accessSummaryLabel.textContent = "Temporary free trial";
    els.accessSummaryNote.textContent = "1 machine activation to test the product";
    els.accessSummaryNote.classList.remove("hidden");
  } else {
    const product = checkoutConfig?.accessProduct || {};
    const productName = String(product.name || "Laundry access");
    const weeklyLimit = Number(product.weeklyLimit || 0);
    if (els.heroSubtext) {
      els.heroSubtext.textContent = selectedSite
        ? "Check your site and email, then pay securely."
        : "Find your laundry room to get started.";
    }
    els.accessSummaryLabel.textContent = productName;
    els.accessSummaryNote.textContent = weeklyLimit ? `Up to ${weeklyLimit} activations per week` : "";
    els.accessSummaryNote.classList.toggle("hidden", !weeklyLimit);
  }
}

async function applyPromoCode() {
  if (!checkoutConfig || paymentBusy) return;
  const code = sanitizePromoCode(els.promoCodeInput.value);
  els.promoCodeInput.value = code;
  if (!code) {
    appliedPromo = null;
    updatePriceDisplay();
    return;
  }

  els.applyPromoBtn.disabled = true;
  setPromoMessage("Checking promo code...");
  try {
    const result = await requestJson(checkoutEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply_promo", promoCode: code, siteId: selectedSite?.id || "" })
    });
    appliedPromo = result;
    els.promoCodeInput.value = currentPromoCode();
    updatePriceDisplay();
  } catch (error) {
    appliedPromo = null;
    els.promoDetails.open = true;
    setPromoMessage(error.message || "That promo code could not be applied.", "bad");
    els.priceText.textContent = formatCheckoutMoney(currentCheckoutTotal());
    els.clearPromoBtn.classList.add("hidden");
  } finally {
    els.applyPromoBtn.disabled = false;
  }
}

function clearPromoCode() {
  appliedPromo = null;
  els.promoCodeInput.value = "";
  els.promoDetails.open = false;
  updatePriceDisplay();
}

async function applyInitialPromoCode() {
  const code = sanitizePromoCode(checkoutParams.get("promo") || "");
  if (!code) return;
  els.promoCodeInput.value = code;
  els.promoDetails.open = true;
  await applyPromoCode();
}

function updatePaymentAvailability({ revealErrors = false } = {}) {
  const valid = Boolean(selectedSite) && isValidEmail(els.customerEmail.value);
  const freeCheckout = valid && Number(currentCheckoutTotal()) <= 0 && Boolean(appliedPromo?.promo?.allowFree);
  const total = checkoutConfig ? formatCheckoutMoney(currentCheckoutTotal()) : "";
  const hasEmail = Boolean(String(els.customerEmail.value || "").trim());
  const showEmailError = !valid && (revealErrors || emailWasInteracted);

  els.customerEmail.classList.toggle("invalid", showEmailError);
  els.customerEmail.setAttribute("aria-invalid", String(showEmailError));
  els.emailPrompt.textContent = showEmailError
    ? (hasEmail ? "Enter a valid email address to continue." : "Enter your email address to continue.")
    : "";
  els.emailPrompt.className = `message email-error ${showEmailError ? "bad" : ""}`.trim();
  els.promoDetails.classList.remove("hidden");
  els.paymentHeading.classList.remove("hidden");
  els.paymentHeading.textContent = freeCheckout ? "Claim code" : "Payment";
  els.freeCheckoutBtn.classList.toggle("hidden", !freeCheckout);
  els.checkoutButton.classList.toggle("hidden", freeCheckout);
  els.checkoutButton.disabled = !valid || paymentBusy;
  els.cardFieldsWrap.classList.toggle("hidden", freeCheckout);
  setStripeSubmitState(paymentBusy, total);

  if (!valid || freeCheckout) {
    closePaymentSheet();
    resetCardPaymentSurface();
    if (!valid) resetStripeElements();
    els.checkoutButton.disabled = !valid || paymentBusy;
    return;
  }

  try { localStorage.setItem(EMAIL_STORAGE_KEY, getCustomerEmail()); } catch (_) {}
}

function setStripeSubmitState(loading = false, total = "") {
  els.stripeSubmitBtn.disabled = loading || !elements || !cardElementMounted || !cardElementReady;
  els.stripeSubmitBtn.textContent = loading
    ? "Processing payment..."
    : total
      ? `Activate access - ${total}`
      : "Activate access";
  if (els.checkoutButton) {
    els.checkoutButton.textContent = loading
      ? "Preparing secure checkout…"
      : "Continue to secure checkout →";
  }
}

function resetCardPaymentSurface() {
  setCardPaymentExpanded(!walletPaymentAvailable);
}

function updateExpressCheckoutVisibility(event = {}, { reveal = false } = {}) {
  const methods = event.availablePaymentMethods || event.paymentMethods || {};
  const hasWallet = Boolean(methods && Object.values(methods).some(Boolean));
  walletPaymentAvailable = hasWallet;
  els.paymentMethods.classList.toggle("has-wallet-payment", hasWallet);
  els.expressCheckout.classList.toggle("hidden", !hasWallet);
  els.paymentDivider.classList.toggle("hidden", !hasWallet);
  if (reveal || !paymentOptionsReady) setCardPaymentExpanded(!hasWallet);
  if (reveal) {
    expressCheckoutReady = true;
    requestAnimationFrame(markPaymentOptionsReady);
  }
  if (checkoutParams.get("walletDebug") === "1" && els.expressCheckoutHeading) {
    els.expressCheckout.classList.remove("hidden");
    els.expressCheckoutHeading.textContent = hasWallet
      ? `Express checkout: ${Object.entries(methods).filter(([, available]) => available).map(([name]) => name).join(", ")}`
      : "Express checkout: no eligible wallet returned for this browser/domain";
  }
}

function moneyToCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.round(number * 100));
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent || "");
}

function isIOSDevice() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function walletPaymentMethods() {
  return {
    applePay: isAndroidDevice() ? "never" : "always",
    googlePay: isIOSDevice() ? "never" : "always",
    link: "never"
  };
}

function stripeElementsKey() {
  return [
    selectedSite?.id || "",
    getCustomerEmail(),
    currentPromoCode(),
    currentCheckoutTotal()
  ].join("|");
}

function resetStripeElements({ closeSheet = true } = {}) {
  try { expressCheckoutElement?.unmount(); } catch (_) {}
  try { cardElement?.unmount(); } catch (_) {}
  els.expressCheckoutElement.replaceChildren();
  els.paymentElement.replaceChildren();
  els.expressCheckout.classList.add("hidden");
  els.paymentDivider.classList.add("hidden");
  paymentOptionsReady = false;
  expressCheckoutReady = false;
  walletPaymentAvailable = false;
  els.paymentMethods.classList.remove("has-wallet-payment");
  if (closeSheet) setPaymentSheetOpen(false);
  resetCardPaymentSurface();
  expressCheckoutElement = null;
  cardElement = null;
  cardElementMounted = false;
  cardElementReady = false;
  elements = null;
  activeIntent = null;
  activeElementsKey = "";
  preparingElementsKey = "";
  setStripeSubmitState(false, checkoutConfig ? formatCheckoutMoney(currentCheckoutTotal()) : "");
}

async function prepareStripeElements() {
  const key = stripeElementsKey();
  if (!selectedSite || !checkoutConfig || !key || key === activeElementsKey || key === preparingElementsKey) return;
  if (!window.Stripe) {
    setPaymentSheetOpen(false);
    setPaymentMessage("Secure checkout could not load. Please refresh and try again.", "bad");
    return;
  }

  preparingElementsKey = key;
  resetStripeElements({ closeSheet: false });
  preparingElementsKey = key;
  setPaymentMessage("");
  setStripeSubmitState(true, formatCheckoutMoney(currentCheckoutTotal()));

  try {
    if (!stripe) stripe = window.Stripe(checkoutConfig.publishableKey);
    activeElementsKey = key;

    elements = stripe.elements({
      mode: "payment",
      amount: moneyToCents(currentCheckoutTotal()),
      currency: checkoutConfig.currency.toLowerCase(),
      paymentMethodTypes: ["card"],
      appearance: stripeAppearance()
    });

    expressCheckoutElement = elements.create("expressCheckout", {
      emailRequired: true,
      layout: { maxColumns: 1, maxRows: 2, overflow: "auto" },
      paymentMethods: walletPaymentMethods(),
      buttonHeight: 54,
      buttonTheme: {
        applePay: "black",
        googlePay: "black"
      }
    });
    expressCheckoutElement.on("ready", (event) => updateExpressCheckoutVisibility(event, { reveal: true }));
    expressCheckoutElement.on("availablepaymentmethodschange", updateExpressCheckoutVisibility);
    expressCheckoutElement.on("confirm", () => confirmStripePayment({ skipSubmit: true }));
    expressCheckoutElement.mount("#expressCheckoutElement");

    cardElement = elements.create("payment", {
      fields: {
        billingDetails: {
          email: "never"
        }
      },
      layout: {
        type: "tabs",
        defaultCollapsed: false
      }
    });
    cardElement.on("ready", () => {
      cardElementReady = true;
      setPaymentMessage("");
      setStripeSubmitState(false, formatCheckoutMoney(currentCheckoutTotal()));
      markPaymentOptionsReady();
    });
    cardElement.on("change", (event) => {
      if (event.error) setPaymentMessage(event.error.message, "bad");
      else if (els.paymentMessage.classList.contains("bad")) setPaymentMessage("");
    });

    mountCardElements();
  } catch (error) {
    resetStripeElements();
    setPaymentMessage(error.message || "The payment form could not load. Please try again.", "bad");
  } finally {
    if (preparingElementsKey === key) preparingElementsKey = "";
  }
}

function mountCardElements() {
  if (!cardElement || cardElementMounted) return;
  cardElement.mount("#paymentElement");
  cardElementMounted = true;
  setStripeSubmitState(false, checkoutConfig ? formatCheckoutMoney(currentCheckoutTotal()) : "");
}

function toggleCardPayment() {
  if (!paymentSheetOpen || !walletPaymentAvailable) return;
  setCardPaymentExpanded(!cardPaymentExpanded);
}

function stripeAppearance() {
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
      ".Input": {
        border: "1px solid #435267",
        boxShadow: "none"
      },
      ".Input:focus": {
        border: "1px solid #22d3ee",
        boxShadow: "0 0 0 2px rgba(34, 211, 238, 0.18)"
      },
      ".Tab": {
        border: "1px solid #435267",
        boxShadow: "none"
      },
      ".Tab--selected": {
        border: "1px solid #22d3ee",
        boxShadow: "0 0 0 1px rgba(34, 211, 238, 0.25)"
      }
    }
  };
}

async function handleStripeFormSubmit(event) {
  event.preventDefault();
  await confirmStripePayment();
}

async function confirmStripePayment({ skipSubmit = false } = {}) {
  if (!stripe || !elements || paymentBusy) return;

  paymentBusy = true;
  setPaymentMessage("Confirming payment...");
  setStripeSubmitState(true, formatCheckoutMoney(currentCheckoutTotal()));

  try {
    if (skipSubmit) {
      const submit = await elements.submit();
      if (submit?.error) throw submit.error;
      const intent = await createStripeIntent();
      activeIntent = intent;
      const result = await stripe.confirmPayment({
        elements,
        clientSecret: intent.clientSecret,
        confirmParams: {
          return_url: `${location.origin}/pay.html?checkout=return`
        },
        redirect: "if_required"
      });
      if (result.error) throw result.error;
      if (result.paymentIntent?.status === "succeeded") {
        await completeStripePayment(result.paymentIntent.id);
      } else {
        setPaymentMessage("Payment is still processing. Please wait a moment and try again.", "bad");
      }
      return;
    }

    if (!cardElement) throw new Error("Card payment is not ready yet.");
    const submit = await elements.submit();
    if (submit?.error) throw submit.error;
    const intent = await createStripeIntent();
    activeIntent = intent;

    const result = await stripe.confirmPayment({
      elements,
      clientSecret: intent.clientSecret,
      confirmParams: {
        payment_method_data: {
          billing_details: {
            email: getCustomerEmail()
          }
        },
        return_url: `${location.origin}/pay.html?checkout=return`
      },
      redirect: "if_required"
    });

    if (result.error) throw result.error;
    if (result.paymentIntent?.status === "succeeded") {
      await completeStripePayment(result.paymentIntent.id);
    } else {
      setPaymentMessage("Payment is still processing. Please wait a moment and try again.", "bad");
    }
  } catch (error) {
    setPaymentMessage(error.message || "Your payment could not be completed. Please try again.", "bad");
  } finally {
    paymentBusy = false;
    setStripeSubmitState(false, formatCheckoutMoney(currentCheckoutTotal()));
  }
}

async function createStripeIntent() {
  if (!selectedSite) throw new Error("Select a site first.");
  if (!isValidEmail(getCustomerEmail())) throw new Error("Enter a valid email address.");
  return requestJson(checkoutEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "create_payment_intent",
      siteId: selectedSite.id,
      customerEmail: getCustomerEmail(),
      promoCode: currentPromoCode(),
      ...analyticsOrderPayload()
    })
  });
}

async function completeStripePayment(paymentIntentId) {
  setPaymentMessage("Creating your access code...");
  const result = await requestJson(checkoutEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete_payment_intent", paymentIntentId })
  });
  window.history.replaceState({}, "", "/pay.html");
  showSuccess(result);
}

function selectSite(site, { track = true } = {}) {
  const searchQuery = String(els.siteSearch.value || "").trim();
  selectedSite = {
    id: String(site.id || ""),
    name: String(site.name || "Site"),
    address: formatSiteAddress(site.address)
  };

  els.selectedSiteName.textContent = selectedSite.name;
  els.selectedSiteAddress.textContent = selectedSite.address;
  els.selectedSiteAddress.classList.toggle("hidden", !selectedSite.address);
  els.selectedSite.classList.remove("hidden");
  els.siteSearch.value = selectedSite.name;
  els.siteSearch.disabled = true;
  els.purchaseCard.classList.remove("site-stage");
  els.siteSearchWrap.classList.add("hidden");
  els.siteHelp.classList.add("hidden");
  els.siteHelp.open = false;
  els.purchaseHeading.textContent = "Review your purchase";
  if (els.heroEyebrow) els.heroEyebrow.textContent = "Buy access";
  if (els.heroTitle) els.heroTitle.textContent = "Review and pay";
  els.paymentSection.classList.remove("hidden");
  hideResults();
  setPaymentMessage("");
  updateSteps("pay");
  updateAccessSummaryCopy();
  updatePaymentAvailability();
  if (track) trackSiteSelection(selectedSite, searchQuery);
  if (els.promoCodeInput.value && !appliedPromo) setTimeout(applyPromoCode, 0);

  if (!isValidEmail(els.customerEmail.value)) {
    setTimeout(() => els.customerEmail.focus(), 0);
  }
}

function trackSiteSelection(site, searchQuery) {
  if (!site?.id || hasTrackedSiteSelection(site.id)) return;

  const ids = getAnalyticsIds();
  const payload = {
    siteId: site.id,
    searchMode,
    searchQuery,
    pagePath: `${location.pathname}${location.search || ""}`,
    referrer: document.referrer || "",
    visitorId: ids.visitorId,
    sessionId: ids.sessionId,
    language: navigator.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    webdriver: Boolean(navigator.webdriver)
  };
  const body = JSON.stringify(payload);
  rememberTrackedSiteSelection(site.id);

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/.netlify/functions/track-site-hit", blob)) return;
    }
  } catch (_) {}

  try {
    fetch("/.netlify/functions/track-site-hit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch(() => {});
  } catch (_) {}
}

function getAnalyticsIds() {
  return {
    visitorId: getStoredAnalyticsId(localStorage, ANALYTICS_VISITOR_KEY),
    sessionId: getStoredAnalyticsId(sessionStorage, ANALYTICS_SESSION_KEY)
  };
}

function hasTrackedSiteSelection(siteId) {
  try {
    const tracked = readTrackedSiteSelections();
    const trackedAt = Number(tracked[String(siteId || "")] || 0);
    return trackedAt > 0 && Date.now() - trackedAt < ANALYTICS_SITE_HIT_TTL_MS;
  } catch (_) {
    return false;
  }
}

function rememberTrackedSiteSelection(siteId) {
  try {
    const tracked = readTrackedSiteSelections();
    const now = Date.now();
    tracked[String(siteId || "")] = now;
    const freshEntries = Object.entries(tracked)
      .filter(([, trackedAt]) => now - Number(trackedAt || 0) < ANALYTICS_SITE_HIT_TTL_MS)
      .slice(-500);
    localStorage.setItem(ANALYTICS_SITE_HITS_KEY, JSON.stringify(Object.fromEntries(freshEntries)));
  } catch (_) {}
}

function readTrackedSiteSelections() {
  const parsed = JSON.parse(localStorage.getItem(ANALYTICS_SITE_HITS_KEY) || "{}");
  if (Array.isArray(parsed)) {
    const now = Date.now();
    return Object.fromEntries(parsed.map((siteId) => [String(siteId), now]));
  }
  return parsed && typeof parsed === "object" ? parsed : {};
}

function analyticsOrderPayload() {
  const ids = getAnalyticsIds();
  return {
    analyticsVisitorId: ids.visitorId,
    analyticsSessionId: ids.sessionId
  };
}

function getStoredAnalyticsId(storage, key) {
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

function clearSelectedSite() {
  selectedSite = null;
  appliedPromo = null;
  resetStripeElements();
  els.selectedSite.classList.add("hidden");
  els.purchaseHeading.textContent = "Choose your site";
  if (els.heroEyebrow) els.heroEyebrow.textContent = "Buy access";
  if (els.heroTitle) els.heroTitle.textContent = "Choose your site";
  if (els.heroSubtext) els.heroSubtext.textContent = "Find your laundry room to get started.";
  els.siteSearch.disabled = false;
  els.purchaseCard.classList.add("site-stage");
  els.siteSearchWrap.classList.remove("hidden");
  els.siteHelp.classList.remove("hidden");
  els.paymentSection.classList.add("hidden");
  els.freeCheckoutBtn.classList.add("hidden");
  els.paymentMethods.classList.add("hidden");
  els.checkoutButton.classList.add("hidden");
  setPaymentMessage("");
  updateSteps("site");
}

function hideResults() {
  els.siteResults.classList.add("hidden");
  els.siteSearch.setAttribute("aria-expanded", "false");
  highlightedIndex = -1;
}

function renderResults(sites, statusText = "") {
  resultSites = Array.isArray(sites) ? sites : [];
  highlightedIndex = -1;
  els.siteResults.innerHTML = "";

  if (statusText) {
    const status = document.createElement("div");
    status.className = "result-status";
    status.textContent = statusText;
    els.siteResults.appendChild(status);
  } else {
    resultSites.forEach((site, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "result-button";
      button.setAttribute("role", "option");
      button.dataset.index = String(index);

      const name = document.createElement("span");
      name.className = "result-name";
      name.textContent = site.name;
      button.appendChild(name);

      const formattedAddress = formatSiteAddress(site.address);
      if (formattedAddress) {
        const address = document.createElement("span");
        address.className = "result-address";
        address.textContent = formattedAddress;
        button.appendChild(address);
      }

      const chevron = document.createElement("span");
      chevron.className = "result-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "›";
      button.appendChild(chevron);

      button.addEventListener("click", () => selectSite(site));
      els.siteResults.appendChild(button);
    });
  }

  els.siteResults.classList.remove("hidden");
  els.siteSearch.setAttribute("aria-expanded", "true");
}

function updateHighlight() {
  const buttons = [...els.siteResults.querySelectorAll(".result-button")];
  buttons.forEach((button, index) => {
    const highlighted = index === highlightedIndex;
    button.classList.toggle("highlighted", highlighted);
    button.setAttribute("aria-selected", String(highlighted));
    if (highlighted) button.scrollIntoView({ block: "nearest" });
  });
}

async function searchSites() {
  const query = String(els.siteSearch.value || "").trim();
  const requestId = ++searchRequestId;

  if (query.length < 2) {
    hideResults();
    return;
  }

  els.searchSpinner.classList.remove("hidden");

  try {
    const data = await requestJson("/.netlify/functions/public-sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, mode: "all" })
    });

    if (requestId !== searchRequestId) return;
    const sites = Array.isArray(data.sites) ? data.sites : [];
    renderResults(sites, sites.length ? "" : "No matching sites");
  } catch (_) {
    if (requestId === searchRequestId) renderResults([], "Could not search sites");
  } finally {
    if (requestId === searchRequestId) els.searchSpinner.classList.add("hidden");
  }
}

async function loadCheckoutConfig() {
  checkoutConfig = await requestJson(checkoutEndpoint);
  updatePriceDisplay();
}

async function preselectCheckoutSite() {
  const siteId = String(checkoutParams.get("site") || "").trim();
  if (!siteId || selectedSite) return;
  const result = await requestJson(checkoutEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "site_product", siteId })
  });
  if (result.accessProduct) checkoutConfig.accessProduct = result.accessProduct;
  selectSite(result.site, { track: false });
  updatePriceDisplay();
}

async function initializeCheckout() {
  const returnedPaymentIntent = checkoutParams.get("payment_intent") || "";
  const redirectStatus = checkoutParams.get("redirect_status") || "";
  if (returnedPaymentIntent && redirectStatus !== "failed") {
    paymentBusy = true;
    els.checkoutView.classList.remove("hidden");
    els.paymentSection.classList.remove("hidden");
    els.purchaseHeading.textContent = "Confirming payment";
    setPaymentMessage("Confirming your payment...");
    updateSteps("pay");
    try {
      await completeStripePayment(returnedPaymentIntent);
    } catch (error) {
      setPaymentMessage(error.message || "Payment was received but the code could not be displayed. Please contact support.", "bad");
    } finally {
      paymentBusy = false;
    }
    return;
  }

  try {
    await loadCheckoutConfig();
    await applyInitialPromoCode();
    await preselectCheckoutSite();
  } catch (error) {
    setPaymentMessage(error.message || "Payment is not available right now.", "bad");
  }
}

async function startFreeCheckout() {
  const customerEmail = getCustomerEmail();
  if (!selectedSite || paymentBusy || Number(currentCheckoutTotal()) > 0 || !appliedPromo?.promo?.allowFree) return;
  if (!isValidEmail(customerEmail)) {
    updatePaymentAvailability();
    els.customerEmail.focus();
    return;
  }

  paymentBusy = true;
  els.freeCheckoutBtn.disabled = true;
  setPaymentMessage("Creating your free access code...");
  try {
    const result = await requestJson(checkoutEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "claim_free_code",
        siteId: selectedSite.id,
        customerEmail,
        promoCode: currentPromoCode(),
        ...analyticsOrderPayload()
      })
    });
    showSuccess(result);
  } catch (error) {
    setPaymentMessage(error.message || "That free code could not be created. Please try again.", "bad");
  } finally {
    paymentBusy = false;
    els.freeCheckoutBtn.disabled = false;
  }
}

function savePurchase(result) {
  const purchase = {
    code: String(result.code || ""),
    orderId: String(result.orderId || ""),
    email: String(result.email || getCustomerEmail() || ""),
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
  activePurchase = purchase;
  try { localStorage.setItem(PURCHASE_STORAGE_KEY, JSON.stringify(purchase)); } catch (_) {}
  if (purchase.code) {
    try { localStorage.setItem(ACTIVATE_SESSION_KEY, purchase.code); } catch (_) {}
  }
  return purchase;
}

function showSuccess(result, { restored = false } = {}) {
  const purchase = restored ? result : savePurchase(result);
  activePurchase = purchase;
  const site = purchase.site || selectedSite || {};
  const email = String(purchase.email || "");
  const siteAddress = formatSiteAddress(site.address);

  closePaymentSheet();
  setPaymentMessage("");
  els.purchaseCard.classList.remove("site-stage");
  els.checkoutView.classList.add("hidden");
  els.successView.classList.remove("hidden");
  if (els.heroEyebrow) els.heroEyebrow.textContent = "Access ready";
  if (els.heroTitle) els.heroTitle.textContent = "Your code is ready";
  if (els.heroSubtext) els.heroSubtext.textContent = "Copy your code or continue straight to the machine controls.";
  els.accessCode.textContent = purchase.code || "";
  const freeTrial = purchaseIsFreeTrial(purchase);
  if (els.accessCodeLabel) {
    els.accessCodeLabel.textContent = freeTrial ? "Your free trial code" : "Your 1-year access code";
  }
  els.successSiteText.textContent = freeTrial
    ? (siteAddress
      ? `Temporary free trial for 1 test activation at ${site.name}, ${siteAddress}.`
      : `Temporary free trial for 1 test activation at ${site.name || "your selected site"}.`)
    : (siteAddress
      ? `Valid for 1 year at ${site.name}, ${siteAddress}.`
      : `Valid for 1 year at ${site.name || "your selected site"}.`);

  if (purchase.emailSent) {
    els.emailStatusText.textContent = `Code emailed to ${email} and saved on this device.`;
    els.emailStatusText.className = "email-status ok";
    els.resendEmailBtn.classList.add("hidden");
  } else {
    els.emailStatusText.textContent = email
      ? `Code saved. Email delivery to ${email} was not confirmed.`
      : "Code saved on this device.";
    els.emailStatusText.className = "email-status bad";
    els.resendEmailBtn.classList.toggle("hidden", !purchase.orderId || !email);
  }

  updateSteps("code");
}

function restoreSavedPurchase() {
  try {
    const raw = localStorage.getItem(PURCHASE_STORAGE_KEY);
    if (!raw) return false;
    const purchase = JSON.parse(raw);
    if (!purchase?.code || !purchase?.site) return false;
    try { localStorage.setItem(ACTIVATE_SESSION_KEY, String(purchase.code)); } catch (_) {}
    showSuccess(purchase, { restored: true });
    return true;
  } catch (_) {
    return false;
  }
}

async function resendAccessEmail() {
  if (!activePurchase?.orderId || !activePurchase?.email) return;
  els.resendEmailBtn.disabled = true;
  els.copyMessage.textContent = "Sending email...";
  els.copyMessage.className = "message";

  try {
    const result = await requestJson(checkoutEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "resend_email",
        orderId: activePurchase.orderId,
        customerEmail: activePurchase.email
      })
    });
    activePurchase.emailSent = Boolean(result.emailSent);
    activePurchase.emailStatus = String(result.emailStatus || "");
    try { localStorage.setItem(PURCHASE_STORAGE_KEY, JSON.stringify(activePurchase)); } catch (_) {}
    showSuccess(activePurchase, { restored: true });
    els.copyMessage.textContent = result.emailSent ? "Email sent" : "Email could not be sent yet";
    els.copyMessage.className = `message ${result.emailSent ? "ok" : "bad"}`;
  } catch (error) {
    els.copyMessage.textContent = error.message || "Email could not be sent";
    els.copyMessage.className = "message bad";
  } finally {
    els.resendEmailBtn.disabled = false;
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || "Something went wrong. Please try again.");
    error.code = data.error || "request_failed";
    error.status = response.status;
    throw error;
  }
  return data;
}

els.siteSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchSites, 220);
});

els.siteSearch.addEventListener("keydown", (event) => {
  if (els.siteResults.classList.contains("hidden")) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlightedIndex = Math.min(highlightedIndex + 1, resultSites.length - 1);
    updateHighlight();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    highlightedIndex = Math.max(highlightedIndex - 1, 0);
    updateHighlight();
  } else if (event.key === "Enter" && highlightedIndex >= 0) {
    event.preventDefault();
    selectSite(resultSites[highlightedIndex]);
  } else if (event.key === "Escape") {
    hideResults();
  }
});

els.customerEmail.addEventListener("input", () => {
  closePaymentSheet();
  resetStripeElements();
  updatePaymentAvailability();
});
els.customerEmail.addEventListener("blur", () => {
  emailWasInteracted = true;
  updatePaymentAvailability({ revealErrors: true });
});
els.checkoutButton.addEventListener("click", openPaymentSheet);
els.paymentSheetCloseBtn.addEventListener("click", closePaymentSheet);
els.paymentMethods.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-payment-sheet]")) closePaymentSheet();
});
els.cardPaymentToggle.addEventListener("click", toggleCardPayment);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && paymentSheetOpen) closePaymentSheet();
});
els.stripePaymentForm.addEventListener("submit", handleStripeFormSubmit);
els.freeCheckoutBtn.addEventListener("click", startFreeCheckout);

els.promoCodeInput.addEventListener("input", () => {
  const sanitized = sanitizePromoCode(els.promoCodeInput.value);
  if (els.promoCodeInput.value !== sanitized) els.promoCodeInput.value = sanitized;
  if (appliedPromo && sanitized !== currentPromoCode()) {
    appliedPromo = null;
    updatePriceDisplay();
  }
});
els.promoCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyPromoCode();
  }
});
els.applyPromoBtn.addEventListener("click", applyPromoCode);
els.clearPromoBtn.addEventListener("click", clearPromoCode);

els.changeSiteBtn.addEventListener("click", () => {
  if (paymentBusy) return;
  clearSelectedSite();
  els.siteSearch.value = "";
  els.siteSearch.focus();
});

els.copyCodeBtn.addEventListener("click", async () => {
  const code = els.accessCode.textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
    els.copyMessage.textContent = "Code copied";
    els.copyMessage.className = "message ok";
  } catch (_) {
    els.copyMessage.textContent = "Press and hold the code to copy it";
    els.copyMessage.className = "message";
  }
});

els.resendEmailBtn.addEventListener("click", resendAccessEmail);
els.newPurchaseBtn.addEventListener("click", () => {
  try { localStorage.removeItem(PURCHASE_STORAGE_KEY); } catch (_) {}
  try { localStorage.removeItem(ACTIVATE_SESSION_KEY); } catch (_) {}
  window.location.href = "/pay.html";
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-wrap")) hideResults();
});

try {
  const savedEmail = localStorage.getItem(EMAIL_STORAGE_KEY);
  if (savedEmail) els.customerEmail.value = savedEmail;
} catch (_) {}

if (!checkoutParams.get("payment_intent") && restoreSavedPurchase()) {
  // Saved code restored.
} else {
  initializeCheckout();
}
