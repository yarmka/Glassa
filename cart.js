/**
 * ============================================================================
 *  Glassa — Cart, Coupons, Checkout, Orders, Paid section
 * ============================================================================
 *  - Cart stored in localStorage (survives logout)
 *  - Coupon validation via getDoc(coupons/CODE)
 *  - One writeBatch for order + (optional) couponUses
 *  - "Order being processed" screen with live onSnapshot
 *  - Customer orders list (pending / paid / rejected)
 *  - Rejection popup on next app open
 *  - Paid section: unlock codes + downloads + reviews shortcut
 *  - Broken link reports
 * ============================================================================
 */

import {
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  writeBatch,
  serverTimestamp
} from "./firebase.js";
import { t, formatPrice, pickLocalized } from "./i18n.js";
import {
  el,
  icon,
  toast,
  toastSuccess,
  toastError,
  toastInfo,
  openModal,
  confirmDialog,
  skeletonGrid,
  skeletonLines,
  emptyState,
  formatDate,
  cloudinaryThumb,
  normalizeUnlockCode,
  copyToClipboard,
  debounce
} from "./ui.js";
import { getUser, getProfile, isVerified } from "./auth.js";
import { getGame, effectivePrice, hasActiveOffer } from "./catalog.js";

/* ============================================================================
   Cart storage (localStorage)
   ========================================================================== */

const CART_KEY = "glassa.cart";

/** In-memory cart of gameIds. */
let cart = [];

/** Read from localStorage into memory. Safe to call multiple times. */
export function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) { cart = []; return; }
    const parsed = JSON.parse(raw);
    cart = Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch (_) {
    cart = [];
  }
}

function persistCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (_) {}
}

/** Count of items in cart (used by nav badge). */
export function cartCount() { return cart.length; }

/** Is the given gameId in the cart? */
export function isInCart(gameId) { return cart.includes(gameId); }

/**
 * Add a game to the cart. Requires login + verified email.
 * @returns {Promise<boolean>}
 */
export async function addToCart(game) {
  const user = getUser();
  if (!user) {
    toastInfo(t("toast.loginRequired"));
    return false;
  }
  if (!isVerified()) {
    toastInfo(t("toast.verifyRequired"));
    return false;
  }
  if (!game || !game.id) return false;
  if (isInCart(game.id)) return true;
  cart.push(game.id);
  persistCart();
  return true;
}

/** Remove a game from the cart. */
export function removeFromCart(gameId) {
  cart = cart.filter((id) => id !== gameId);
  persistCart();
}

/** Clear the cart entirely. */
export function clearCart() {
  cart = [];
  persistCart();
}

/**
 * Resolve the cart's gameIds into full game docs (visible + not yet unlocked).
 * Games that no longer exist are dropped silently.
 */
export async function getCartItems() {
  const out = [];
  for (const id of cart) {
    const g = await getGame(id);
    if (g) out.push(g);
  }
  return out;
}

/** Navigate to the cart page (used by "Buy now" from a game). */
export function goToCheckout() {
  location.hash = "#/cart";
}

/* ============================================================================
   Coupon state
   ========================================================================== */

/** @type {{code:string, percent:number, mode:"once"|"open"} | null} */
let appliedCoupon = null;

export function getAppliedCoupon() { return appliedCoupon; }
export function clearAppliedCoupon() { appliedCoupon = null; }

/**
 * Validate a coupon for the current user. Returns the coupon info or null.
 * Rules: exists, active, not expired, and (for mode="once") not already used.
 */
export async function validateCoupon(rawCode) {
  const user = getUser();
  if (!user) return { ok: false, code: "notSignedIn" };

  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return { ok: false, code: "empty" };

  try {
    const snap = await getDoc(doc(db, "coupons", code));
    if (!snap.exists()) return { ok: false, code: "invalid" };
    const data = snap.data() || {};

    if (!data.active) return { ok: false, code: "invalid" };

    const percent = Number(data.percent);
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
      return { ok: false, code: "invalid" };
    }

    const expiresAt = data.expiresAt?.toDate?.();
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      return { ok: false, code: "invalid" };
    }

    if (data.mode === "once") {
      const useSnap = await getDoc(doc(db, "couponUses", `${code}_${user.uid}`));
      if (useSnap.exists()) return { ok: false, code: "used" };
    }

    return {
      ok: true,
      coupon: {
        code,
        percent,
        mode: data.mode === "open" ? "open" : "once"
      }
    };
  } catch (e) {
    console.error("validateCoupon failed:", e);
    return { ok: false, code: "error" };
  }
}

/* ============================================================================
   Cart page
   ========================================================================== */

/**
 * Render the cart page into container.
 */
export async function renderCart(container) {
  container.appendChild(skeletonLines(4));

  const items = await getCartItems();

  container.innerHTML = "";
  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("cart.title") }));
  container.appendChild(header);

  if (!items.length) {
    container.appendChild(emptyState({
      iconName: "cart",
      title: t("cart.empty"),
      action: { label: t("nav.home"), onClick: () => { location.hash = "#/"; } }
    }));
    return;
  }

  // Items list
  const list = el("div", { className: "stack", style: { marginBottom: "16px" } });
  for (const g of items) {
    list.appendChild(buildCartLine(g, () => {
      removeFromCart(g.id);
      location.hash = "#/cart";
    }));
  }
  container.appendChild(list);

  // Totals + coupon
  const subtotal = items.reduce((s, g) => s + effectivePrice(g), 0);

  const totals = el("div", { className: "glass glass--pad stack", style: { marginBottom: "16px" } });

  // Coupon row
  const couponRow = el("div", { className: "row", style: { gap: "8px" } });
  const couponInput = el("input", {
    className: "input grow code-input",
    type: "text",
    placeholder: t("cart.coupon"),
    autocapitalize: "characters",
    autocomplete: "off",
    maxLength: 32
  });
  if (appliedCoupon) {
    couponInput.value = appliedCoupon.code;
    couponInput.disabled = true;
  }
  couponRow.appendChild(couponInput);

  const couponBtn = el("button", {
    className: "btn btn--glass",
    type: "button",
    textContent: appliedCoupon ? t("cart.removeCoupon") : t("cart.applyCoupon"),
    onClick: async () => {
      if (appliedCoupon) {
        clearAppliedCoupon();
        location.hash = "#/cart";
        return;
      }
      couponBtn.disabled = true;
      const result = await validateCoupon(couponInput.value);
      couponBtn.disabled = false;
      if (!result.ok) {
        if (result.code === "used") toastError(t("cart.errors.couponUsed"));
        else if (result.code === "notSignedIn") toastInfo(t("toast.loginRequired"));
        else toastError(t("cart.errors.couponInvalid"));
        return;
      }
      appliedCoupon = result.coupon;
      toastSuccess(t("cart.couponApplied", { p: appliedCoupon.percent }));
      location.hash = "#/cart";
    }
  });
  couponRow.appendChild(couponBtn);
  totals.appendChild(couponRow);

  totals.appendChild(el("hr", { className: "divider" }));

  const discountPercent = appliedCoupon?.percent || 0;
  const discountValue = Math.round((subtotal * discountPercent) / 100 * 100) / 100;
  const total = Math.max(0, Math.round((subtotal - discountValue) * 100) / 100);

  totals.appendChild(sumRow(t("cart.subtotal"), formatPrice(subtotal)));
  if (discountPercent) {
    totals.appendChild(sumRow(`${t("cart.discount")} (${discountPercent}%)`, `- ${formatPrice(discountValue)}`));
  }
  totals.appendChild(sumRow(t("cart.total"), formatPrice(total), true));

  container.appendChild(totals);

  // Checkout form
  const user = getUser();
  const profile = getProfile();
  const form = el("div", { className: "glass glass--pad stack" });

  if (!user) {
    form.appendChild(el("p", { className: "text-muted", textContent: t("cart.requiresLogin") }));
    form.appendChild(el("button", {
      className: "btn btn--primary btn--block",
      type: "button",
      textContent: t("nav.login"),
      onClick: () => { location.hash = "#/login"; }
    }));
    container.appendChild(form);
    return;
  }

  if (!isVerified()) {
    form.appendChild(el("p", { className: "text-muted", textContent: t("cart.requiresVerify") }));
    form.appendChild(el("button", {
      className: "btn btn--primary btn--block",
      type: "button",
      textContent: t("account.verifyNow"),
      onClick: () => { location.hash = "#/verify"; }
    }));
    container.appendChild(form);
    return;
  }

  // Name (prefilled)
  const nameField = el("div", { className: "field" });
  nameField.appendChild(el("label", { className: "field__label", textContent: t("cart.customerName") }));
  const nameInput = el("input", { className: "input", maxLength: 60, value: profile?.name || "" });
  nameField.appendChild(nameInput);
  form.appendChild(nameField);

  // Phone (optional)
  const phoneField = el("div", { className: "field" });
  phoneField.appendChild(el("label", { className: "field__label", textContent: t("cart.phone") }));
  const phoneInput = el("input", { className: "input", type: "tel", inputMode: "tel", maxLength: 20, placeholder: t("cart.phoneHint") });
  phoneField.appendChild(phoneInput);
  form.appendChild(phoneField);

  // Note (optional)
  const noteField = el("div", { className: "field" });
  noteField.appendChild(el("label", { className: "field__label", textContent: t("cart.note") }));
  const noteInput = el("textarea", { className: "textarea", maxLength: 300 });
  noteField.appendChild(noteInput);
  form.appendChild(noteField);

  const buyBtn = el("button", {
    className: "btn btn--primary btn--block btn--lg",
    type: "button",
    textContent: t("cart.buy")
  });
  buyBtn.addEventListener("click", async () => {
    const customerName = nameInput.value.trim();
    if (!customerName) { toastError(t("cart.errors.nameRequired")); return; }
    buyBtn.disabled = true;
    try {
      const orderId = await placeOrder({
        items,
        subtotal,
        total,
        discountPercent,
        coupon: appliedCoupon,
        customerName,
        phone: phoneInput.value.trim().slice(0, 20),
        note: noteInput.value.trim().slice(0, 300)
      });
      clearCart();
      clearAppliedCoupon();
      location.hash = `#/processing/${orderId}`;
    } catch (e) {
      console.error("placeOrder failed:", e);
      toastError(t("cart.errors.orderFailed"));
    } finally {
      buyBtn.disabled = false;
    }
  });
  form.appendChild(buyBtn);

  container.appendChild(form);
}

function sumRow(label, value, emphasize = false) {
  const row = el("div", { className: "row row--between" });
  row.appendChild(el("span", { className: emphasize ? "text-bold" : "text-muted", textContent: label }));
  row.appendChild(el("span", { className: emphasize ? "text-bold" : "", textContent: value }));
  return row;
}

function buildCartLine(game, onRemove) {
  const line = el("div", { className: "line" });

  const thumb = el("div", { className: "line__thumb" });
  if (game.coverUrl) {
    const img = el("img", { src: cloudinaryThumb(game.coverUrl, 200), alt: "", loading: "lazy" });
    img.addEventListener("error", () => img.remove());
    thumb.appendChild(img);
  }
  line.appendChild(thumb);

  const body = el("div", { className: "line__body" });
  body.appendChild(el("div", { className: "line__title", textContent: pickLocalized(game.title_ar, game.title_en) || "—" }));
  body.appendChild(el("div", { className: "line__sub", textContent: formatPrice(effectivePrice(game)) }));
  line.appendChild(body);

  const removeBtn = el("button", {
    className: "btn btn--ghost btn--icon",
    type: "button",
    "aria-label": t("cart.remove"),
    onClick: onRemove
  }, icon("trash", 18));
  line.appendChild(removeBtn);

  return line;
}

/* ============================================================================
   Place order (single writeBatch)
   ========================================================================== */

async function placeOrder({ items, subtotal, total, discountPercent, coupon, customerName, phone, note }) {
  const user = getUser();
  if (!user) throw new Error("not-signed-in");

  const orderRef = doc(collection(db, "orders"));
  const orderId = orderRef.id;

  const itemData = items.map((g) => ({
    gameId: g.id,
    title: pickLocalized(g.title_ar, g.title_en) || g.id,
    price: effectivePrice(g)
  }));

  const orderPayload = {
    uid: user.uid,
    email: user.email || "",
    customerName,
    phone: phone || "",
    note: note || "",
    items: itemData,
    itemIds: items.map((g) => g.id),
    subtotal: Math.round(subtotal * 100) / 100,
    couponCode: coupon?.code || "",
    discountPercent: coupon?.percent || 0,
    total: Math.round(total * 100) / 100,
    status: "pending",
    rejectReason: "",
    rejectionSeen: false,
    createdAt: serverTimestamp(),
    paidAt: null
  };

  const batch = writeBatch(db);
  batch.set(orderRef, orderPayload);

  // Create the couponUses doc in the SAME batch for "once" coupons.
  // The Firestore rule uses existsAfter() to check it atomically.
  if (coupon && coupon.mode === "once") {
    const useRef = doc(db, "couponUses", `${coupon.code}_${user.uid}`);
    batch.set(useRef, {
      uid: user.uid,
      code: coupon.code,
      createdAt: serverTimestamp()
    });
  }

  await batch.commit();
  return orderId;
}

/* ============================================================================
   Processing screen
   ========================================================================== */

/**
 * Render the "Order is being processed" screen with a live order status.
 */
export function renderProcessing(container, orderId) {
  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("cart.processing") }));
  container.appendChild(header);

  const card = el("div", { className: "glass glass--pad-lg stack" });

  const shortId = String(orderId || "").slice(0, 8).toUpperCase();
  const idRow = el("div", { className: "row row--between" });
  idRow.appendChild(el("span", { className: "text-muted", textContent: t("cart.orderNumber") }));
  idRow.appendChild(el("span", { className: "text-bold", textContent: shortId }));
  card.appendChild(idRow);

  const statusRow = el("div", { className: "row", style: { gap: "8px", marginTop: "8px" } });
  const statusPill = el("span", { className: "pill pill--warning", textContent: t("orders.status.pending") });
  statusRow.appendChild(statusPill);
  card.appendChild(statusRow);

  card.appendChild(el("p", { className: "text-subtle text-sm", style: { marginTop: "12px" }, textContent: t("cart.processingHint") }));

  container.appendChild(card);

  // Live listener on the order.
  const unsub = onSnapshot(doc(db, "orders", orderId), (snap) => {
    if (!snap.exists()) return;
    const o = snap.data() || {};
    if (o.status === "paid") {
      statusPill.textContent = t("orders.status.paid");
      statusPill.className = "pill pill--success";
      // Send the customer to the Paid section.
      setTimeout(() => { location.hash = "#/paid"; }, 800);
    } else if (o.status === "rejected") {
      statusPill.textContent = t("orders.status.rejected");
      statusPill.className = "pill pill--danger";
    } else {
      statusPill.textContent = t("orders.status.pending");
      statusPill.className = "pill pill--warning";
    }
  }, (err) => {
    console.error("order snapshot error:", err);
  });

  // Cleanup when the node is replaced.
  const mo = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      try { unsub(); } catch (_) {}
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  return () => { try { unsub(); } catch (_) {} mo.disconnect(); };
}

/* ============================================================================
   Orders page (customer)
   ========================================================================== */

export function renderOrders(container) {
  const user = getUser();
  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("orders.title") }));
  container.appendChild(header);

  if (!user) {
    container.appendChild(emptyState({
      iconName: "user",
      title: t("cart.requiresLogin"),
      action: { label: t("nav.login"), onClick: () => { location.hash = "#/login"; } }
    }));
    return () => {};
  }

  const list = el("div", { className: "stack" });
  container.appendChild(list);

  const q = query(collection(db, "orders"), where("uid", "==", user.uid));
  const unsub = onSnapshot(q, (snap) => {
    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    orders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    list.innerHTML = "";
    if (!orders.length) {
      list.appendChild(emptyState({
        iconName: "cart",
        title: t("orders.empty")
      }));
      return;
    }
    for (const o of orders) list.appendChild(buildOrderCard(o));
  }, (err) => {
    console.error("orders snapshot error:", err);
    list.innerHTML = "";
    list.appendChild(emptyState({
      iconName: "info",
      title: t("error.network")
    }));
  });

  return () => { try { unsub(); } catch (_) {} };
}

function buildOrderCard(o) {
  const card = el("div", { className: "glass glass--pad stack" });

  // Header: short id + status
  const head = el("div", { className: "row row--between" });
  head.appendChild(el("span", { className: "text-bold", textContent: `#${o.id.slice(0, 8).toUpperCase()}` }));

  let pillClass = "pill--warning";
  let pillLabel = t("orders.status.pending");
  if (o.status === "paid") { pillClass = "pill--success"; pillLabel = t("orders.status.paid"); }
  if (o.status === "rejected") { pillClass = "pill--danger"; pillLabel = t("orders.status.rejected"); }
  head.appendChild(el("span", { className: `pill ${pillClass}`, textContent: pillLabel }));
  card.appendChild(head);

  // Date
  card.appendChild(el("div", { className: "text-xs text-muted", textContent: formatDate(o.createdAt) }));

  // Items
  const itemsList = el("div", { className: "stack stack--sm", style: { marginTop: "8px" } });
  for (const it of (o.items || [])) {
    const r = el("div", { className: "row row--between" });
    r.appendChild(el("span", { className: "text-sm", textContent: it.title }));
    r.appendChild(el("span", { className: "text-sm text-muted", textContent: formatPrice(it.price) }));
    itemsList.appendChild(r);
  }
  card.appendChild(itemsList);

  // Totals
  const totals = el("div", { className: "stack stack--sm", style: { marginTop: "8px" } });
  totals.appendChild(sumRow(t("cart.subtotal"), formatPrice(o.subtotal)));
  if (o.discountPercent) {
    const dv = Math.round((o.subtotal * o.discountPercent) / 100 * 100) / 100;
    totals.appendChild(sumRow(`${t("cart.discount")} (${o.discountPercent}%)`, `- ${formatPrice(dv)}`));
  }
  totals.appendChild(sumRow(t("cart.total"), formatPrice(o.total), true));
  card.appendChild(totals);

  // Rejection reason
  if (o.status === "rejected" && o.rejectReason) {
    const box = el("div", { className: "glass glass--pad", style: { marginTop: "8px", borderColor: "rgba(242,107,107,0.4)" } });
    box.appendChild(el("div", { className: "text-xs text-danger text-bold", textContent: t("orders.reason") }));
    box.appendChild(el("div", { className: "text-sm", style: { marginTop: "4px", whiteSpace: "pre-line" }, textContent: o.rejectReason }));
    card.appendChild(box);
  }

  // Paid → shortcut
  if (o.status === "paid") {
    card.appendChild(el("button", {
      className: "btn btn--primary btn--block",
      type: "button",
      textContent: t("orders.goToPaid"),
      style: { marginTop: "8px" },
      onClick: () => { location.hash = "#/paid"; }
    }));
  }

  return card;
}

/* ============================================================================
   Rejection popup (on app boot)
   ========================================================================== */

/**
 * If any of the current user's orders are rejected and unseen,
 * show a modal for the newest one and mark it seen.
 */
export async function checkRejectedOrders() {
  const user = getUser();
  if (!user) return;

  try {
    const q = query(collection(db, "orders"), where("uid", "==", user.uid));
    const snap = await getDocs(q);
    const rejected = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => o.status === "rejected" && !o.rejectionSeen)
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    if (!rejected.length) return;

    const order = rejected[0];
    const shortId = order.id.slice(0, 8).toUpperCase();

    const body = el("div", { className: "stack" });
    body.appendChild(el("p", { textContent: t("orders.rejectedPopup.body", { n: shortId }) }));
    if (order.rejectReason) {
      body.appendChild(el("div", {
        className: "glass glass--pad",
        style: { marginTop: "8px", whiteSpace: "pre-line", color: "var(--text-1)" },
        textContent: order.rejectReason
      }));
    }

    openModal({
      title: t("orders.rejectedPopup.title"),
      body,
      onClose: async () => {
        try {
          await updateDoc(doc(db, "orders", order.id), { rejectionSeen: true });
        } catch (e) {
          console.error("mark rejectionSeen failed:", e);
        }
      }
    });
  } catch (e) {
    console.error("checkRejectedOrders failed:", e);
  }
}

/* ============================================================================
   Paid section
   ========================================================================== */

export function renderPaid(container) {
  const user = getUser();
  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("paid.title") }));
  header.appendChild(el("div", { className: "page-header__subtitle", textContent: t("paid.subtitle") }));
  container.appendChild(header);

  if (!user) {
    container.appendChild(emptyState({
      iconName: "user",
      title: t("cart.requiresLogin"),
      action: { label: t("nav.login"), onClick: () => { location.hash = "#/login"; } }
    }));
    return () => {};
  }

  // Section 1: Paid orders waiting for a code
  const waitingSlot = el("div");
  container.appendChild(waitingSlot);

  // Section 2: Unlocked games
  const purchasedSlot = el("div");
  container.appendChild(purchasedSlot);

  // Live list of my unlocks
  const unsubUnlocks = renderUnlockedGames(purchasedSlot);

  // Live list of my paid orders (to show code-entry cards)
  const q = query(collection(db, "orders"), where("uid", "==", user.uid));
  const unsubOrders = onSnapshot(q, (snap) => {
    const orders = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => o.status === "paid")
      .sort((a, b) => (b.paidAt?.seconds || 0) - (a.paidAt?.seconds || 0));
    waitingSlot.innerHTML = "";
    if (orders.length) {
      waitingSlot.appendChild(el("h2", { style: { fontSize: "var(--fs-lg)", fontWeight: "700", marginBottom: "12px" }, textContent: t("paid.openOrders") }));
      for (const o of orders) waitingSlot.appendChild(buildUnlockCard(o));
    }
  }, (err) => {
    console.error("paid orders snapshot error:", err);
  });

  return () => {
    try { unsubUnlocks(); } catch (_) {}
    try { unsubOrders(); } catch (_) {}
  };
}

function buildUnlockCard(order) {
  const card = el("div", { className: "glass glass--pad stack", style: { marginBottom: "12px" } });

  const head = el("div", { className: "row row--between" });
  head.appendChild(el("span", { className: "text-bold", textContent: `#${order.id.slice(0, 8).toUpperCase()}` }));
  head.appendChild(el("span", { className: "pill pill--success", textContent: t("orders.status.paid") }));
  card.appendChild(head);

  // Game titles
  const items = (order.items || []).map((it) => it.title).join(" • ");
  card.appendChild(el("div", { className: "text-sm text-muted", textContent: items }));

  card.appendChild(el("div", { className: "text-xs text-muted", textContent: formatDate(order.paidAt) }));

  card.appendChild(el("hr", { className: "divider" }));

  card.appendChild(el("div", { className: "text-sm text-bold", textContent: t("paid.enterCode") }));

  // Code input
  const input = el("input", {
    className: "input code-input",
    type: "text",
    inputMode: "text",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: t("paid.codePlaceholder"),
    maxLength: 19,
    autocapitalize: "characters"
  });
  card.appendChild(input);

  const statusLine = el("div", { className: "text-xs", style: { minHeight: "1em" } });
  card.appendChild(statusLine);

  // Lockout state (per-order, in localStorage)
  const lockKey = `glassa.unlockAttempts.${order.id}`;
  const lockState = readLockState(lockKey);

  const submit = el("button", {
    className: "btn btn--primary btn--block",
    type: "button",
    textContent: t("paid.unlock")
  });
  card.appendChild(submit);

  if (lockState.lockedUntil > Date.now()) {
    lockSubmit();
  }

  input.addEventListener("input", () => {
    input.value = normalizeUnlockCode(input.value);
  });

  submit.addEventListener("click", async () => {
    const code = normalizeUnlockCode(input.value);
    if (code.length !== 19) {
      statusLine.textContent = t("paid.incorrect");
      statusLine.className = "text-xs text-danger";
      return;
    }
    submit.disabled = true;
    statusLine.textContent = t("paid.unlocking");
    statusLine.className = "text-xs text-muted";

    const result = await attemptUnlock(order, code);

    if (!result.ok) {
      // Wrong code — count attempts.
      const state = readLockState(lockKey);
      state.attempts = (state.attempts || 0) + 1;
      if (state.attempts >= 5) {
        state.lockedUntil = Date.now() + 5 * 60 * 1000;
        state.attempts = 0;
      }
      writeLockState(lockKey, state);

      if (state.lockedUntil > Date.now()) {
        statusLine.textContent = t("paid.locked", { n: 5 });
        lockSubmit();
      } else {
        statusLine.textContent = t("paid.incorrect");
        statusLine.className = "text-xs text-danger";
        submit.disabled = false;
      }
      return;
    }

    // Success — unlock state clean.
    clearLockState(lockKey);
    statusLine.textContent = t("paid.unlocked");
    statusLine.className = "text-xs text-success";

    // Single-game order → redirect after countdown.
    const gameIds = order.itemIds || [];
    if (gameIds.length === 1) {
      showDownloadRedirect(card, gameIds[0]);
    } else {
      showMultiDownload(card, gameIds);
    }
  });

  function lockSubmit() {
    submit.disabled = true;
    let remaining = Math.ceil((readLockState(lockKey).lockedUntil - Date.now()) / 60000);
    const tick = () => {
      remaining = Math.max(0, Math.ceil((readLockState(lockKey).lockedUntil - Date.now()) / 60000));
      if (remaining <= 0) {
        clearLockState(lockKey);
        submit.disabled = false;
        statusLine.textContent = "";
        statusLine.className = "text-xs";
        return;
      }
      statusLine.textContent = t("paid.locked", { n: remaining });
      statusLine.className = "text-xs text-danger";
      setTimeout(tick, 15000);
    };
    tick();
  }

  return card;
}

/* ---- Unlock logic ------------------------------------------------------- */

/**
 * Attempt to unlock all games in the order with the given code.
 * Writes unlocks docs in one writeBatch. On failure the batch fails with
 * permission-denied (this is our "wrong code" signal).
 */
async function attemptUnlock(order, code) {
  const user = getUser();
  if (!user) return { ok: false };

  const gameIds = order.itemIds || [];
  if (!gameIds.length) return { ok: false };

  // Only try to create unlocks that don't exist yet.
  const toCreate = [];
  for (const gid of gameIds) {
    try {
      const s = await getDoc(doc(db, "unlocks", `${user.uid}_${gid}`));
      if (!s.exists()) toCreate.push(gid);
    } catch (_) {
      // Permission error on a specific doc: treat as not-yet-created.
      toCreate.push(gid);
    }
  }

  if (!toCreate.length) return { ok: true };

  try {
    const batch = writeBatch(db);
    for (const gid of toCreate) {
      const ref = doc(db, "unlocks", `${user.uid}_${gid}`);
      batch.set(ref, {
        uid: user.uid,
        gameId: gid,
        orderId: order.id,
        code,
        createdAt: serverTimestamp()
      });
    }
    await batch.commit();
    return { ok: true };
  } catch (e) {
    // permission-denied → wrong code.
    return { ok: false };
  }
}

function showDownloadRedirect(card, gameId) {
  const info = el("div", { className: "stack", style: { marginTop: "12px" } });
  const line = el("div", { className: "text-sm text-success" });
  info.appendChild(line);

  let remaining = 3;
  const cancelBtn = el("button", {
    className: "btn btn--ghost btn--block",
    type: "button",
    textContent: t("paid.cancel"),
    onClick: () => { clearInterval(timer); line.textContent = ""; cancelBtn.remove(); }
  });

  const timer = setInterval(async () => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      await openDownload(gameId);
      info.appendChild(el("button", {
        className: "btn btn--primary btn--block",
        type: "button",
        textContent: t("paid.downloadNow"),
        onClick: () => openDownload(gameId)
      }));
    } else {
      line.textContent = t("paid.redirecting", { n: remaining });
    }
  }, 1000);

  line.textContent = t("paid.redirecting", { n: remaining });
  info.appendChild(cancelBtn);
  card.appendChild(info);
}

function showMultiDownload(card, gameIds) {
  const wrap = el("div", { className: "stack", style: { marginTop: "12px" } });
  for (const gid of gameIds) {
    const btn = el("button", {
      className: "btn btn--primary btn--block",
      type: "button",
      onClick: async () => {
        btn.disabled = true;
        try { await openDownload(gid); }
        finally { btn.disabled = false; }
      }
    });
    btn.appendChild(icon("download", 18));
    btn.appendChild(el("span", { textContent: `#${gid.slice(0, 6)}` }));
    // Try to load the title async.
    getGame(gid).then((g) => {
      if (g) btn.querySelector("span").textContent = pickLocalized(g.title_ar, g.title_en) || gid;
    });
    wrap.appendChild(btn);
  }
  card.appendChild(wrap);
}

/** Read links/{gameId} and open in a new tab. */
export async function openDownload(gameId) {
  try {
    const snap = await getDoc(doc(db, "links", gameId));
    if (!snap.exists()) {
      toastError(t("paid.linkMissing"));
      return;
    }
    const url = snap.data()?.downloadUrl;
    if (!url) {
      toastError(t("paid.linkMissing"));
      return;
    }
    window.open(url, "_blank", "noopener");
  } catch (e) {
    console.error("openDownload failed:", e);
    toastError(t("paid.linkMissing"));
  }
}

/* ---- Unlocked games list ----------------------------------------------- */

function renderUnlockedGames(container) {
  const user = getUser();
  if (!user) return () => {};

  const q = query(collection(db, "unlocks"), where("uid", "==", user.uid));

  const unsub = onSnapshot(q, (snap) => {
    const unlocks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    container.innerHTML = "";

    if (!unlocks.length) return;

    container.appendChild(el("h2", {
      style: { fontSize: "var(--fs-lg)", fontWeight: "700", margin: "24px 0 12px" },
      textContent: t("paid.purchasedGames")
    }));

    const grid = el("div", { className: "stack" });
    for (const u of unlocks) grid.appendChild(buildPurchasedCard(u));
    container.appendChild(grid);
  }, (err) => {
    console.error("unlocks snapshot error:", err);
  });

  return unsub;
}

function buildPurchasedCard(unlock) {
  const card = el("div", { className: "line", style: { padding: "12px" } });

  // Cover
  const thumb = el("div", { className: "line__thumb" });
  card.appendChild(thumb);

  // Body
  const body = el("div", { className: "line__body" });
  const titleEl = el("div", { className: "line__title", textContent: unlock.gameId });
  body.appendChild(titleEl);
  body.appendChild(el("div", { className: "line__sub", textContent: formatDate(unlock.createdAt) }));
  card.appendChild(body);

  // Actions (populated after loading the game)
  const actions = el("div", { className: "row", style: { gap: "4px" } });

  const dlBtn = el("button", {
    className: "btn btn--primary btn--sm",
    type: "button",
    onClick: async () => {
      dlBtn.disabled = true;
      try { await openDownload(unlock.gameId); }
      finally { dlBtn.disabled = false; }
    }
  });
  dlBtn.appendChild(icon("download", 16));
  actions.appendChild(dlBtn);

  const reportBtn = el("button", {
    className: "btn btn--ghost btn--sm",
    type: "button",
    textContent: t("paid.reportBroken"),
    onClick: async () => {
      const ok = await confirmDialog({
        title: t("paid.reportBroken"),
        message: "",
        confirmLabel: t("common.confirm")
      });
      if (!ok) return;
      try {
        await setDoc(doc(db, "linkReports", `${unlock.gameId}_${unlock.uid}`), {
          gameId: unlock.gameId,
          uid: unlock.uid,
          gameTitle: titleEl.textContent,
          createdAt: serverTimestamp()
        });
        reportBtn.disabled = true;
        reportBtn.textContent = t("paid.reported");
        toastSuccess(t("paid.reported"));
      } catch (e) {
        console.error("report failed:", e);
        toastError(t("error.unknown"));
      }
    }
  });
  actions.appendChild(reportBtn);

  // Load cover + title async
  getGame(unlock.gameId).then((g) => {
    if (!g) return;
    const cover = cloudinaryThumb(g.coverUrl, 200);
    if (cover) {
      const img = el("img", { src: cover, alt: "", loading: "lazy" });
      img.addEventListener("error", () => img.remove());
      thumb.appendChild(img);
    }
    titleEl.textContent = pickLocalized(g.title_ar, g.title_en) || unlock.gameId;
    dlBtn.appendChild(el("span", { textContent: pickLocalized(g.title_ar, g.title_en).slice(0, 12) || t("paid.download") }));
  });

  card.appendChild(actions);
  return card;
}

/* ============================================================================
   Lockout state (localStorage)
   ========================================================================== */

function readLockState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { attempts: 0, lockedUntil: 0 };
    const p = JSON.parse(raw);
    return {
      attempts: Number(p.attempts) || 0,
      lockedUntil: Number(p.lockedUntil) || 0
    };
  } catch (_) {
    return { attempts: 0, lockedUntil: 0 };
  }
}
function writeLockState(key, state) {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) {}
}
function clearLockState(key) {
  try { localStorage.removeItem(key); } catch (_) {}
}
