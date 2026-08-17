const API_URL = "/.netlify/functions/store-api";
const STORE_CODE_KEY = "zaftStoreAccessCode";

const $ = (id) => document.getElementById(id);
const els = {
  accessGate: $("accessGate"), accessForm: $("accessForm"), accessLoading: $("accessLoading"), accessManual: $("accessManual"), accessCodeInput: $("accessCodeInput"), accessMessage: $("accessMessage"),
  storeApp: $("storeApp"), memberCredit: $("memberCredit"), memberEmail: $("memberEmail"), signOutBtn: $("signOutBtn"), inviteCountBadge: $("inviteCountBadge"),
  shopProductsView: $("shopProductsView"), productGrid: $("productGrid"), productDetailView: $("productDetailView"),
  backToProductsBtn: $("backToProductsBtn"), productDetailMedia: $("productDetailMedia"), productDetailTitle: $("productDetailTitle"),
  productDetailDescription: $("productDetailDescription"), productDetailPrice: $("productDetailPrice"), buyProductBtn: $("buyProductBtn"),
  checkoutForm: $("checkoutForm"), checkoutPanel: $("checkoutPanel"), checkoutEmail: $("checkoutEmail"), recipientName: $("recipientName"),
  addressLine1: $("addressLine1"), addressLine2: $("addressLine2"), addressCity: $("addressCity"), addressPostcode: $("addressPostcode"),
  addressCountry: $("addressCountry"), selectedProductSummary: $("selectedProductSummary"), productQuantity: $("productQuantity"),
  checkoutSubtotalRow: $("checkoutSubtotalRow"), checkoutSubtotal: $("checkoutSubtotal"), checkoutCreditRow: $("checkoutCreditRow"), checkoutCredit: $("checkoutCredit"), checkoutTotal: $("checkoutTotal"), checkoutBtn: $("checkoutBtn"), checkoutMessage: $("checkoutMessage"),
  shopMemberCode: $("shopMemberCode"), inviteAllowance: $("inviteAllowance"), inviteCreditBalance: $("inviteCreditBalance"), inviteForm: $("inviteForm"), createInviteBtn: $("createInviteBtn"),
  inviteMessage: $("inviteMessage"), invitationList: $("invitationList"), orderList: $("orderList"),
  paymentOverlay: $("paymentOverlay"), closePaymentBtn: $("closePaymentBtn"), paymentElement: $("paymentElement"), paymentForm: $("paymentForm"),
  payBtn: $("payBtn"), paymentMessage: $("paymentMessage"), successOverlay: $("successOverlay"), successText: $("successText"), successDoneBtn: $("successDoneBtn"),
  orderOverlay: $("orderOverlay"), closeOrderOverlayBtn: $("closeOrderOverlayBtn"), orderOverlayTitle: $("orderOverlayTitle"),
  orderOverlayBody: $("orderOverlayBody"), cancelOrderBtn: $("cancelOrderBtn"), orderOverlayMessage: $("orderOverlayMessage")
};

let accessCode = getStoredCode();
let storeData = null;
let selectedProductId = null;
let deliveryConfirmed = false;
let stripe = null;
let elements = null;
let paymentElement = null;
let activePaymentIntentId = "";
let paymentBusy = false;
let activeOrderId = "";

async function api(action, payload = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, accessCode, ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    clearStoredCode();
    accessCode = "";
    showAccessGate(data.message || "Store access has expired.");
  }
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || data.error || "Store request failed.");
    error.code = data.error || "";
    throw error;
  }
  return data;
}

async function enterStore(code, { handleReturn = true, automatic = false } = {}) {
  accessCode = sanitizeCode(code);
  if (!accessCode) {
    showAccessGate("Enter a valid store access code.");
    return;
  }
  setAccessLoading(true, { automatic });
  setMessage(els.accessMessage, "Opening store...", "");
  try {
    storeData = await api("authenticate");
    accessCode = sanitizeCode(storeData.member?.accessCode || accessCode);
    storeCode(accessCode);
    removeCodeFromUrl();
    els.accessGate.classList.add("hidden");
    els.storeApp.classList.remove("hidden");
    renderStore();
    if (handleReturn) await completeReturnedPayment();
  } catch (error) {
    setAccessLoading(false);
    if (accessCode) setMessage(els.accessMessage, error.message, "bad");
  }
}

function setAccessLoading(loading, { automatic = false } = {}) {
  const showLoadingPanel = loading && automatic;
  els.accessLoading.classList.toggle("hidden", !showLoadingPanel);
  els.accessManual.classList.toggle("hidden", showLoadingPanel);
  els.accessForm.classList.toggle("loading", showLoadingPanel);
}

function renderStore() {
  const member = storeData.member || {};
  els.memberEmail.textContent = member.email || `Code ${member.accessCode || accessCode}`;
  const creditBalance = Number(member.creditBalance || 0);
  els.memberCredit.textContent = creditBalance > 0 ? `${money(creditBalance, "GBP")} credit` : "";
  els.memberCredit.classList.toggle("hidden", creditBalance <= 0);
  els.inviteCreditBalance.textContent = money(creditBalance, "GBP");
  const remainingInvites = Math.max(0, Number(member.invitesRemaining || 0));
  const inviteLimit = Number(member.inviteLimit || 5);
  els.inviteCountBadge.textContent = remainingInvites > 0 ? String(remainingInvites) : "";
  const pendingReferral = Boolean(member.pendingReferral);
  const hasUnacceptedInvite = pendingReferral || (storeData.invitations || []).some((invite) =>
    Number(invite.completedOrders || 0) < 1 && !invite.acceptedAt
  );
  const canCreateReferral = member.canCreateReferral === undefined
    ? !hasUnacceptedInvite && remainingInvites > 0
    : Boolean(member.canCreateReferral);
  els.inviteAllowance.innerHTML = `
    Give a friend access to the secret store. When they join, you'll get <strong>&pound;5 credit</strong>.<br>
    Share your private invite link or code with them.<br>
    <strong>${remainingInvites} ${remainingInvites === 1 ? "invite" : "invites"} remaining</strong>
  `;
  els.checkoutEmail.value = els.checkoutEmail.value || member.email || "";
  els.createInviteBtn.disabled = !canCreateReferral;
  els.createInviteBtn.textContent = hasUnacceptedInvite
    ? "Invite pending"
    : remainingInvites < 1 ? "Referral limit reached" : "Generate access code";
  renderShopMemberCode(member);
  renderProducts();
  renderInvitations();
  renderOrders();
}

function renderShopMemberCode(member) {
  const code = sanitizeCode(member.accessCode || accessCode);
  if (!code) {
    els.shopMemberCode.textContent = "";
    els.shopMemberCode.classList.add("hidden");
    return;
  }
  els.shopMemberCode.textContent = `Your code: ${code}`;
  els.shopMemberCode.classList.remove("hidden");
}

function renderProducts() {
  const products = storeData.products || [];
  els.productGrid.innerHTML = "";
  if (!products.length) {
    els.productGrid.innerHTML = '<div class="empty-state">No products are available right now.</div>';
    els.checkoutForm.classList.add("hidden");
    els.checkoutPanel.classList.add("hidden");
    els.productDetailView.classList.add("hidden");
    return;
  }

  products.forEach((product) => {
    const article = document.createElement("button");
    article.type = "button";
    article.className = "product-card";
    article.setAttribute("aria-label", `View ${product.name}`);
    article.addEventListener("click", () => openProduct(product.id));
    const media = document.createElement("div");
    media.className = "product-media";
    if (product.imageUrl) {
      const image = document.createElement("img");
      image.src = product.imageUrl;
      image.alt = product.name;
      image.loading = "lazy";
      image.addEventListener("error", () => { image.remove(); media.textContent = "CircuitWash Store"; });
      media.appendChild(image);
    } else {
      media.textContent = "CircuitWash Store";
    }
    const body = document.createElement("div");
    body.className = "product-body";
    const title = document.createElement("h2");
    title.textContent = product.name;
    const footer = document.createElement("div");
    footer.className = "product-footer";
    const price = document.createElement("span");
    price.className = "product-price";
    price.textContent = money(product.price, product.currency);
    const cta = document.createElement("span");
    cta.className = "product-cta";
    cta.textContent = "View product";
    footer.append(price, cta);
    body.append(title, footer);
    article.append(media, body);
    els.productGrid.appendChild(article);
  });
  if (selectedProduct()) renderProductDetail();
  else showProductsView();
}

function openProduct(productId) {
  selectedProductId = productId;
  deliveryConfirmed = false;
  setMessage(els.checkoutMessage, "", "");
  renderProductDetail();
  els.shopProductsView.classList.add("hidden");
  els.productDetailView.classList.remove("hidden");
  els.checkoutForm.classList.add("hidden");
  els.checkoutPanel.classList.add("hidden");
  scrollShopTop();
}

function showProductsView() {
  selectedProductId = null;
  deliveryConfirmed = false;
  setMessage(els.checkoutMessage, "", "");
  els.shopProductsView.classList.remove("hidden");
  els.productDetailView.classList.add("hidden");
  els.checkoutForm.classList.add("hidden");
  els.checkoutPanel.classList.add("hidden");
  scrollShopTop();
}

function scrollShopTop() {
  $("storeTabShop").scrollIntoView({ behavior: "smooth", block: "start" });
}

function markDeliveryChanged() {
  if (!deliveryConfirmed) return;
  deliveryConfirmed = false;
  els.checkoutPanel.classList.add("hidden");
  setMessage(els.checkoutMessage, "Address changed. Continue again to refresh checkout.", "");
}

function beginDelivery() {
  const product = selectedProduct();
  if (!product) return;
  deliveryConfirmed = false;
  setMessage(els.checkoutMessage, "", "");
  els.checkoutForm.classList.remove("hidden");
  els.checkoutPanel.classList.add("hidden");
  renderSelectedProduct();
  els.checkoutForm.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => {
    const firstEmpty = [els.checkoutEmail, els.recipientName, els.addressLine1, els.addressCity, els.addressPostcode, els.addressCountry]
      .find((input) => !String(input.value || "").trim());
    (firstEmpty || els.checkoutEmail).focus();
  }, 220);
}

function confirmDelivery(event) {
  event.preventDefault();
  if (!selectedProduct() || !els.checkoutForm.reportValidity()) return;
  deliveryConfirmed = true;
  renderSelectedProduct();
  els.checkoutPanel.classList.remove("hidden");
  setMessage(els.checkoutMessage, "Delivery details added. Continue to secure checkout when ready.", "ok");
  els.checkoutPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectedProduct() {
  return (storeData?.products || []).find((product) => product.id === selectedProductId) || null;
}

function renderProductDetail() {
  const product = selectedProduct();
  if (!product) return;
  els.productDetailMedia.innerHTML = "";
  if (product.imageUrl) {
    const image = document.createElement("img");
    image.src = product.imageUrl;
    image.alt = product.name;
    image.addEventListener("error", () => { image.remove(); els.productDetailMedia.textContent = "CircuitWash Store"; });
    els.productDetailMedia.appendChild(image);
  } else {
    els.productDetailMedia.textContent = "CircuitWash Store";
  }
  els.productDetailTitle.textContent = product.name;
  els.productDetailDescription.textContent = product.description || "Private CircuitWash merchandise release.";
  els.productDetailPrice.textContent = money(product.price, product.currency);
  updateTotal();
}

function renderSelectedProduct() {
  const product = selectedProduct();
  if (!product) return;
  els.selectedProductSummary.innerHTML = "";
  const media = document.createElement("div");
  media.className = "summary-image";
  if (product.imageUrl) {
    const image = document.createElement("img");
    image.src = product.imageUrl;
    image.alt = "";
    image.addEventListener("error", () => { image.remove(); media.textContent = "CircuitWash"; });
    media.appendChild(image);
  } else {
    media.textContent = "CircuitWash";
  }
  const copy = document.createElement("div");
  copy.className = "summary-copy";
  const name = document.createElement("strong");
  name.textContent = product.name;
  const unit = document.createElement("span");
  unit.textContent = `${money(product.price, product.currency)} each`;
  copy.append(name, unit);
  els.selectedProductSummary.append(media, copy);
  updateTotal();
}

function updateTotal() {
  const product = selectedProduct();
  if (!product) return;
  const quantity = Number(els.productQuantity.value) || 1;
  const subtotal = Number(product.price) * quantity;
  const credit = estimatedCreditForSubtotal(subtotal, product.currency);
  const total = Math.max(0, subtotal - credit);
  els.checkoutSubtotal.textContent = money(subtotal, product.currency);
  els.checkoutCredit.textContent = `-${money(credit, product.currency)}`;
  els.checkoutSubtotalRow.classList.toggle("hidden", credit <= 0);
  els.checkoutCreditRow.classList.toggle("hidden", credit <= 0);
  els.checkoutTotal.textContent = money(total, product.currency);
}

function estimatedCreditForSubtotal(subtotal, currency) {
  if (String(currency || "GBP").toUpperCase() !== "GBP") return 0;
  const available = Math.max(0, Number(storeData?.member?.creditBalance || 0));
  let applied = Math.min(subtotal, available);
  const payable = subtotal - applied;
  if (payable > 0 && payable < 0.3) applied = Math.max(0, subtotal - 0.3);
  return Math.round(applied * 100) / 100;
}

async function beginCheckout(event) {
  event.preventDefault();
  if (paymentBusy) return;
  if (!deliveryConfirmed) {
    els.checkoutForm.classList.remove("hidden");
    setMessage(els.checkoutMessage, "Add the delivery address before checkout.", "bad");
    els.checkoutForm.reportValidity();
    return;
  }
  if (!els.checkoutForm.reportValidity()) {
    deliveryConfirmed = false;
    els.checkoutPanel.classList.add("hidden");
    return;
  }
  const product = selectedProduct();
  if (!product) return;
  setCheckoutBusy(true);
  setMessage(els.checkoutMessage, "Preparing secure checkout...", "");
  try {
    const result = await api("create_payment_intent", {
      productId: product.id,
      quantity: Number(els.productQuantity.value) || 1,
      customerEmail: els.checkoutEmail.value,
      address: {
        recipientName: els.recipientName.value,
        line1: els.addressLine1.value,
        line2: els.addressLine2.value,
        city: els.addressCity.value,
        postcode: els.addressPostcode.value,
        country: els.addressCountry.value
      }
    });
    if (result.paidWithCredit && result.order) await showCompletedOrder(result.order);
    else await openPayment(result);
    setMessage(els.checkoutMessage, "", "");
  } catch (error) {
    setMessage(els.checkoutMessage, error.message, "bad");
  } finally {
    setCheckoutBusy(false);
  }
}

async function openPayment(result) {
  if (!window.Stripe) throw new Error("Secure checkout could not load. Refresh and try again.");
  activePaymentIntentId = result.paymentIntentId;
  stripe = stripe || window.Stripe(storeData.publishableKey);
  if (paymentElement) paymentElement.destroy();
  elements = stripe.elements({
    clientSecret: result.clientSecret,
    appearance: stripeAppearance()
  });
  paymentElement = elements.create("payment", { layout: "tabs" });
  els.paymentElement.innerHTML = "";
  paymentElement.mount(els.paymentElement);
  els.payBtn.textContent = `Pay ${money(result.amount, result.currency)}`;
  els.paymentOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closePayment(force = false) {
  if (paymentBusy && !force) return;
  const abandonedPaymentIntentId = !force ? activePaymentIntentId : "";
  activePaymentIntentId = "";
  els.paymentOverlay.classList.add("hidden");
  document.body.style.overflow = "";
  setMessage(els.paymentMessage, "", "");
  if (abandonedPaymentIntentId) {
    api("abandon_payment_intent", { paymentIntentId: abandonedPaymentIntentId })
      .then(async () => {
        storeData = await api("authenticate");
        renderStore();
        setMessage(els.checkoutMessage, "Checkout closed. Reserved credits were returned.", "");
      })
      .catch(async (error) => {
        if (error.code === "payment_already_completed") {
          await finishOrder(abandonedPaymentIntentId).catch(() => {});
          return;
        }
        setMessage(els.checkoutMessage, "Checkout closed. Any reserved credit will be restored automatically.", "");
      });
  }
}

async function submitPayment(event) {
  event.preventDefault();
  if (!stripe || !elements || paymentBusy) return;
  paymentBusy = true;
  els.payBtn.disabled = true;
  els.closePaymentBtn.disabled = true;
  setMessage(els.paymentMessage, "Processing payment...", "");
  try {
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${location.origin}/store.html?payment=return` },
      redirect: "if_required"
    });
    if (result.error) throw new Error(result.error.message || "Payment could not be completed.");
    const paymentIntentId = result.paymentIntent?.id || activePaymentIntentId;
    await finishOrder(paymentIntentId);
  } catch (error) {
    setMessage(els.paymentMessage, error.message, "bad");
  } finally {
    paymentBusy = false;
    els.payBtn.disabled = false;
    els.closePaymentBtn.disabled = false;
  }
}

async function completeReturnedPayment() {
  const params = new URLSearchParams(location.search);
  const paymentIntentId = params.get("payment_intent") || "";
  if (!paymentIntentId) return;
  setMessage(els.checkoutMessage, "Confirming payment...", "");
  try {
    await finishOrder(paymentIntentId);
  } catch (error) {
    setMessage(els.checkoutMessage, error.message, "bad");
  } finally {
    removePaymentFromUrl();
  }
}

async function finishOrder(paymentIntentId) {
  const result = await api("complete_payment_intent", { paymentIntentId });
  await showCompletedOrder(result.order);
}

async function showCompletedOrder(order) {
  closePayment(true);
  storeData = await api("authenticate");
  renderStore();
  const orderLabel = order.orderNumber ? `${order.orderNumber}: ` : "";
  const creditNote = Number(order.creditApplied || 0) > 0
    ? ` ${money(order.creditApplied, order.currency)} credit was applied.`
    : "";
  els.successText.textContent = `${orderLabel}${order.quantity} x ${order.productName} will be delivered to the address provided.${creditNote}`;
  els.successOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

async function createInvite(event) {
  event.preventDefault();
  if (els.createInviteBtn.disabled) return;
  els.createInviteBtn.disabled = true;
  setMessage(els.inviteMessage, "Generating access code...", "");
  try {
    await api("create_invite");
    storeData = await api("authenticate");
    renderStore();
    setMessage(els.inviteMessage, "Access code created.", "ok");
  } catch (error) {
    setMessage(els.inviteMessage, error.message, "bad");
    if (error.code === "pending_referral") {
      try {
        storeData = await api("authenticate");
        renderStore();
      } catch (_) {}
    }
  } finally {
    const member = storeData?.member || {};
    const hasUnacceptedInvite = Boolean(member.pendingReferral) || (storeData?.invitations || []).some((invite) =>
      Number(invite.completedOrders || 0) < 1 && !invite.acceptedAt
    );
    const remainingInvites = Math.max(0, Number(member.invitesRemaining || 0));
    els.createInviteBtn.disabled = hasUnacceptedInvite || remainingInvites < 1;
    els.createInviteBtn.textContent = hasUnacceptedInvite
      ? "Invite pending"
      : remainingInvites < 1 ? "Referral limit reached" : "Generate access code";
  }
}

function renderInvitations() {
  const invitations = storeData.invitations || [];
  els.invitationList.innerHTML = "";
  if (!invitations.length) {
    els.invitationList.innerHTML = '<div class="invitation-row"><span class="row-muted">No access codes generated yet.</span></div>';
    return;
  }
  invitations.forEach((invite) => {
    const row = document.createElement("div");
    row.className = `invitation-row ${invite.completedOrders > 0 ? "credited" : ""}`;
    const code = document.createElement(invite.completedOrders > 0 ? "strong" : "code");
    code.textContent = invite.completedOrders > 0 ? `+${money(invite.creditAmount || 5, "GBP")} credits` : invite.code;
    const state = document.createElement("span");
    state.className = "row-muted";
    state.textContent = invite.completedOrders > 0 ? "Referral order completed" : invite.acceptedAt ? "Invite accepted" : "Invite pending";
    const date = document.createElement("span");
    date.className = "row-muted";
    date.textContent = formatDate(invite.createdAt);
    if (invite.completedOrders > 0) {
      const status = document.createElement("span");
      status.className = "status completed";
      status.textContent = "Credited";
      row.append(code, state, date, status);
    } else {
      const copyCode = document.createElement("button");
      copyCode.type = "button";
      copyCode.className = "button small";
      copyCode.textContent = "Copy code";
      copyCode.addEventListener("click", async () => {
        await copyWithFeedback(copyCode, invite.code);
      });
      const copyLink = document.createElement("button");
      copyLink.type = "button";
      copyLink.className = "button small";
      copyLink.textContent = "Copy link";
      copyLink.addEventListener("click", async () => {
        await copyWithFeedback(copyLink, inviteLink(invite.code));
      });
      const actions = document.createElement("div");
      actions.className = "invite-actions";
      actions.append(copyCode, copyLink);
      row.append(code, state, date, actions);
    }
    els.invitationList.appendChild(row);
  });
}

async function copyWithFeedback(button, value) {
  const label = button.dataset.defaultLabel || button.textContent;
  button.dataset.defaultLabel = label;
  const copied = await copyText(value);
  button.textContent = copied ? "Copied" : "Copy manually";
  window.setTimeout(() => { button.textContent = label; }, 1800);
}

async function copyText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    if (document.execCommand("copy")) return true;
  } catch (_) {
  } finally {
    textarea.remove();
  }
  window.prompt("Copy this:", text);
  return false;
}

function inviteLink(code) {
  const cleanCode = sanitizeCode(code);
  const url = new URL("store.html", location.href);
  url.searchParams.set("invite", cleanCode);
  return url.href;
}

function renderOrders() {
  const orders = (storeData.orders || []).filter((order) =>
    order.status === "COMPLETED"
  );
  els.orderList.innerHTML = "";
  if (!orders.length) {
    els.orderList.innerHTML = '<div class="order-row"><span class="row-muted">No merch orders yet.</span></div>';
    return;
  }
  orders.forEach((order) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "order-row";
    row.setAttribute("aria-haspopup", "dialog");
    const main = document.createElement("div");
    main.className = "order-main";
    const title = document.createElement("strong");
    title.textContent = order.orderNumber || "Merch order";
    const product = document.createElement("span");
    product.className = "row-muted";
    product.textContent = `${order.quantity} x ${order.productName}`;
    const date = document.createElement("span");
    date.className = "row-muted";
    date.textContent = `Placed ${formatDate(order.completedAt || order.createdAt)}`;
    main.append(title, product, date);
    const price = document.createElement("span");
    price.className = "order-price";
    price.textContent = money(order.subtotal || order.amount, order.currency);
    const status = document.createElement("span");
    const label = order.fulfilmentStatus || "PENDING";
    status.className = `status ${String(label).toLowerCase()}`;
    status.textContent = orderStatusLabel(order);
    const detail = document.createElement("div");
    detail.className = "order-detail";
    detail.innerHTML = `
      <span>${escapeHtml(orderStatusText(order))}</span>
      <span>Free delivery is included.</span>
    `;
    row.append(main, price, status, detail);
    row.addEventListener("click", () => openOrderOverlay(order.orderId));
    els.orderList.appendChild(row);
  });
}

function orderStatusText(order) {
  const status = String(order?.fulfilmentStatus || "").toUpperCase();
  if (status === "CANCELLED" && Number(order?.creditApplied || 0) > 0) return "Order cancelled. Credits returned; card refund pending.";
  if (status === "CANCELLED") return "Order cancelled. Refund pending.";
  if (status === "SHIPPED") return "Your order has shipped.";
  if (status === "PROCESSING") return "Your order is being prepared for shipping.";
  return "Your order is awaiting shipping.";
}

function orderStatusLabel(order) {
  const status = String(order?.fulfilmentStatus || "").toUpperCase();
  if (status === "CANCELLED") return "Refund pending";
  return titleCase(status || "PENDING");
}

async function openOrderOverlay(orderId) {
  let order = (storeData.orders || []).find((item) => item.orderId === orderId);
  if (!order) return;
  activeOrderId = orderId;
  els.orderOverlayTitle.textContent = order.orderNumber || "Merch order";
  setMessage(els.orderOverlayMessage, "", "");
  els.orderOverlayBody.innerHTML = '<div class="order-detail-item full"><span>Loading</span><strong>Getting order details...</strong></div>';
  els.cancelOrderBtn.classList.add("hidden");
  els.cancelOrderBtn.disabled = true;
  els.orderOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  try {
    const result = await api("get_order", { orderId });
    order = result.order || order;
    storeData.orders = (storeData.orders || []).map((item) => item.orderId === orderId ? { ...item, ...order } : item);
  } catch (error) {
    setMessage(els.orderOverlayMessage, error.message, "bad");
  }
  renderOrderOverlay(order);
}

function renderOrderOverlay(order) {
  els.orderOverlayTitle.textContent = order.orderNumber || "Merch order";
  const address = orderAddress(order);
  const addressText = [address.line1, address.line2, address.city, address.postcode, address.country].filter(Boolean).join(", ");
  const recipientName = order.recipientName || order.recipient_name || "";
  const customerEmail = order.customerEmail || order.customer_email || "";
  const creditApplied = Number(order.creditApplied || 0);
  const paymentRows = creditApplied > 0 ? `
      <div class="order-detail-item"><span>Subtotal</span><strong>${escapeHtml(money(order.subtotal || order.amount, order.currency))}</strong></div>
      <div class="order-detail-item"><span>Credits applied</span><strong>-${escapeHtml(money(creditApplied, order.currency))}</strong></div>
      <div class="order-detail-item"><span>Paid</span><strong>${escapeHtml(money(order.amount, order.currency))}</strong></div>
  ` : `
      <div class="order-detail-item"><span>Total</span><strong>${escapeHtml(money(order.amount, order.currency))}</strong></div>
  `;
  els.orderOverlayBody.innerHTML = `
    <div class="order-detail-grid">
      <div class="order-detail-item"><span>Status</span><strong>${escapeHtml(orderStatusText(order))}</strong></div>
      <div class="order-detail-item"><span>Date</span><strong>${escapeHtml(formatDate(order.completedAt || order.createdAt))}</strong></div>
      <div class="order-detail-item"><span>Product</span><strong>${escapeHtml(order.quantity)} x ${escapeHtml(order.productName)}</strong></div>
      ${paymentRows}
      <div class="order-detail-item"><span>Recipient</span><strong>${escapeHtml(recipientName || "Not provided")}</strong></div>
      <div class="order-detail-item"><span>Email</span><strong>${escapeHtml(customerEmail || "Not provided")}</strong></div>
      <div class="order-detail-item full"><span>Address</span><strong>${escapeHtml(addressText || "Not provided")}</strong></div>
    </div>
  `;
  const canCancel = String(order.fulfilmentStatus || "").toUpperCase() === "PENDING";
  els.cancelOrderBtn.classList.toggle("hidden", !canCancel);
  els.cancelOrderBtn.disabled = !canCancel;
}

function orderAddress(order) {
  const nested = order?.address || {};
  return {
    line1: nested.line1 || order?.addressLine1 || order?.address_line1 || "",
    line2: nested.line2 || order?.addressLine2 || order?.address_line2 || "",
    city: nested.city || order?.city || "",
    postcode: nested.postcode || order?.postcode || "",
    country: nested.country || order?.country || ""
  };
}

function closeOrderOverlay() {
  activeOrderId = "";
  els.orderOverlay.classList.add("hidden");
  setMessage(els.orderOverlayMessage, "", "");
  document.body.style.overflow = "";
}

async function cancelActiveOrder() {
  if (!activeOrderId || els.cancelOrderBtn.disabled) return;
  els.cancelOrderBtn.disabled = true;
  setMessage(els.orderOverlayMessage, "Cancelling order...", "");
  try {
    const result = await api("cancel_order", { orderId: activeOrderId });
    storeData = await api("authenticate");
    renderStore();
    openOrderOverlay(activeOrderId);
    setMessage(
      els.orderOverlayMessage,
      Number(result.order?.creditApplied || 0) > 0
        ? "Order cancelled. Applied credits were returned; card refund pending."
        : "Order cancelled. Refund pending.",
      "ok"
    );
  } catch (error) {
    setMessage(els.orderOverlayMessage, error.message, "bad");
  } finally {
    const order = (storeData?.orders || []).find((item) => item.orderId === activeOrderId);
    els.cancelOrderBtn.disabled = String(order?.fulfilmentStatus || "").toUpperCase() !== "PENDING";
  }
}

function openStoreTab(tab) {
  document.querySelectorAll("[data-store-tab]").forEach((button) => button.classList.toggle("active", button.dataset.storeTab === tab));
  ["shop", "invites", "orders"].forEach((name) => $(`storeTab${titleCase(name)}`).classList.toggle("hidden", name !== tab));
}

function showAccessGate(message = "") {
  els.storeApp.classList.add("hidden");
  els.accessGate.classList.remove("hidden");
  setAccessLoading(false);
  els.accessCodeInput.value = "";
  setMessage(els.accessMessage, message, message ? "bad" : "");
  setTimeout(() => els.accessCodeInput.focus(), 0);
}

function signOut() {
  accessCode = "";
  storeData = null;
  clearStoredCode();
  showAccessGate();
}

function setCheckoutBusy(busy) {
  els.checkoutBtn.disabled = busy;
  els.checkoutBtn.textContent = busy ? "Preparing..." : "Checkout";
}

function stripeAppearance() {
  return {
    theme: "night",
    variables: {
      colorPrimary: "#a78bfa",
      colorBackground: "#100b1d",
      colorText: "#edf3f8",
      colorDanger: "#f38b8b",
      borderRadius: "10px",
      fontFamily: "Inter, system-ui, sans-serif",
      spacingUnit: "4px"
    },
    rules: {
      ".Input": { border: "1px solid rgba(167,139,250,.22)", boxShadow: "none" },
      ".Input:focus": { border: "1px solid #a78bfa", boxShadow: "0 0 0 3px rgba(167,139,250,.16)" },
      ".Label": { fontWeight: "700" }
    }
  };
}

function sanitizeCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

function getStoredCode() {
  try { return localStorage.getItem(STORE_CODE_KEY) || ""; } catch (_) { return ""; }
}

function storeCode(code) {
  try { localStorage.setItem(STORE_CODE_KEY, code); } catch (_) {}
}

function clearStoredCode() {
  try { localStorage.removeItem(STORE_CODE_KEY); } catch (_) {}
}

function removeCodeFromUrl() {
  const url = new URL(location.href);
  if (!url.searchParams.has("code") && !url.searchParams.has("invite")) return;
  url.searchParams.delete("code");
  url.searchParams.delete("invite");
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function removePaymentFromUrl() {
  const url = new URL(location.href);
  ["payment", "payment_intent", "payment_intent_client_secret", "redirect_status"].forEach((key) => url.searchParams.delete(key));
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function setMessage(element, text, tone) {
  element.textContent = text;
  element.className = `message ${tone || ""}`.trim();
}

function money(value, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

function titleCase(value) {
  const text = String(value || "").toLowerCase().replace(/[_-]/g, " ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.accessForm.addEventListener("submit", (event) => { event.preventDefault(); enterStore(els.accessCodeInput.value); });
els.accessCodeInput.addEventListener("input", () => { els.accessCodeInput.value = sanitizeCode(els.accessCodeInput.value); });
els.signOutBtn.addEventListener("click", signOut);
document.querySelectorAll("[data-store-tab]").forEach((button) => button.addEventListener("click", () => openStoreTab(button.dataset.storeTab)));
els.productQuantity.addEventListener("change", updateTotal);
els.backToProductsBtn.addEventListener("click", showProductsView);
els.buyProductBtn.addEventListener("click", beginDelivery);
els.checkoutForm.addEventListener("submit", confirmDelivery);
els.checkoutBtn.addEventListener("click", beginCheckout);
document.querySelectorAll("#checkoutForm input").forEach((input) => input.addEventListener("input", markDeliveryChanged));
els.closePaymentBtn.addEventListener("click", () => closePayment());
els.paymentOverlay.addEventListener("click", (event) => { if (event.target === els.paymentOverlay) closePayment(); });
els.paymentForm.addEventListener("submit", submitPayment);
els.closeOrderOverlayBtn.addEventListener("click", closeOrderOverlay);
els.orderOverlay.addEventListener("click", (event) => { if (event.target === els.orderOverlay) closeOrderOverlay(); });
els.cancelOrderBtn.addEventListener("click", cancelActiveOrder);
els.inviteForm.addEventListener("submit", createInvite);
els.successDoneBtn.addEventListener("click", () => {
  els.successOverlay.classList.add("hidden");
  document.body.style.overflow = "";
  openStoreTab("orders");
});
window.addEventListener("pagehide", () => {
  if (!activePaymentIntentId || paymentBusy || !navigator.sendBeacon) return;
  const payload = new Blob([
    JSON.stringify({ action: "abandon_payment_intent", accessCode, paymentIntentId: activePaymentIntentId })
  ], { type: "application/json" });
  navigator.sendBeacon(API_URL, payload);
});

const accessParams = new URLSearchParams(location.search);
const urlCode = accessParams.get("invite") || accessParams.get("code");
if (urlCode) accessCode = sanitizeCode(urlCode);
if (accessCode) enterStore(accessCode, { automatic: true });
else showAccessGate();
