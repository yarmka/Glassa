/**
 * ============================================================================
 *  Glassa — Owner panel
 * ============================================================================
 *  Tabs:
 *   1) Orders       — live via onSnapshot, sub-tabs (in-progress/rejected/paid)
 *   2) Games        — CRUD + Cloudinary upload + offer block
 *   3) Coupons      — CRUD
 *   4) Popups       — CRUD
 *   5) Announcement — settings/announcement
 *   6) Requests     — game requests + broken-link reports
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
  orderBy,
  getDocs,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  Timestamp
} from "./firebase.js";
import { CONFIG } from "./config.js";
import { t, formatPrice, pickLocalized } from "./i18n.js";
import {
  el,
  icon,
  toastSuccess,
  toastError,
  openModal,
  confirmDialog,
  emptyState,
  formatDate,
  cloudinaryThumb,
  copyToClipboard,
  generateUnlockCode
} from "./ui.js";
import { isOwner, sendEmailViaEmailJS } from "./auth.js";
import { resetCatalogCache } from "./catalog.js";

/* ============================================================================
   Entry
   ========================================================================== */

let cleanupFns = [];

export async function renderAdmin(container) {
  if (!isOwner()) {
    container.innerHTML = "";
    container.appendChild(emptyState({
      iconName: "lock",
      title: t("error.permission")
    }));
    return () => {};
  }

  container.innerHTML = "";
  cleanupFns = [];

  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("admin.title") }));
  container.appendChild(header);

  const tabs = [
    { id: "orders",       label: t("admin.tabs.orders") },
    { id: "games",        label: t("admin.tabs.games") },
    { id: "coupons",      label: t("admin.tabs.coupons") },
    { id: "popups",       label: t("admin.tabs.popups") },
    { id: "announcement", label: t("admin.tabs.announcement") },
    { id: "requests",     label: t("admin.tabs.requests") }
  ];

  let activeTab = "orders";
  const seg = el("div", { className: "segmented" });
  const panel = el("div");
  container.appendChild(seg);
  container.appendChild(panel);

  function paintTabs() {
    seg.innerHTML = "";
    for (const tb of tabs) {
      const btn = el("button", {
        type: "button",
        className: `segmented__btn${activeTab === tb.id ? " is-active" : ""}`,
        textContent: tb.label,
        onClick: () => {
          if (activeTab === tb.id) return;
          runCleanups();
          activeTab = tb.id;
          paintTabs();
          renderPanel();
        }
      });
      seg.appendChild(btn);
    }
  }

  function runCleanups() {
    for (const fn of cleanupFns) {
      try { fn(); } catch (_) {}
    }
    cleanupFns = [];
  }

  async function renderPanel() {
    panel.innerHTML = "";
    switch (activeTab) {
      case "orders": {
        const fn = await mountOrdersTab(panel);
        cleanupFns.push(fn);
        break;
      }
      case "games": {
        const fn = await mountGamesTab(panel);
        cleanupFns.push(fn);
        break;
      }
      case "coupons": {
        const fn = mountCouponsTab(panel);
        cleanupFns.push(fn);
        break;
      }
      case "popups": {
        const fn = mountPopupsTab(panel);
        cleanupFns.push(fn);
        break;
      }
      case "announcement": {
        const fn = await mountAnnouncementTab(panel);
        cleanupFns.push(fn);
        break;
      }
      case "requests": {
        const fn = await mountRequestsTab(panel);
        cleanupFns.push(fn);
        break;
      }
    }
  }

  paintTabs();
  await renderPanel();

  return () => runCleanups();
}

/* ============================================================================
   1) ORDERS TAB
   ========================================================================== */

async function mountOrdersTab(container) {
  let ordersSub = null;

  let sub = "in-progress";
  const subSeg = el("div", { className: "segmented", style: { marginBottom: "12px" } });
  const subSlot = el("div");
  container.appendChild(subSeg);
  container.appendChild(subSlot);

  let ordersCache = [];
  const secretsCache = new Map();
  const unlocksCache = new Set();

  function paintSubTabs() {
    subSeg.innerHTML = "";
    const counts = {
      "in-progress": ordersCache.filter((o) => o.status === "pending").length,
      rejected:      ordersCache.filter((o) => o.status === "rejected").length,
      paid:          ordersCache.filter((o) => o.status === "paid").length
    };
    const items = [
      { id: "in-progress", label: t("admin.orders.inProgress") },
      { id: "rejected",    label: t("admin.orders.rejected") },
      { id: "paid",        label: t("admin.orders.paid") }
    ];
    for (const it of items) {
      const btn = el("button", {
        type: "button",
        className: `segmented__btn${sub === it.id ? " is-active" : ""}`,
        onClick: () => { sub = it.id; paintSubTabs(); paintList(); }
      });
      btn.appendChild(document.createTextNode(it.label));
      if (counts[it.id]) btn.appendChild(el("span", { className: "segmented__count", textContent: String(counts[it.id]) }));
      subSeg.appendChild(btn);
    }
  }

  function paintList() {
    subSlot.innerHTML = "";
    const list = ordersCache.filter((o) => {
      if (sub === "in-progress") return o.status === "pending";
      if (sub === "rejected")    return o.status === "rejected";
      if (sub === "paid")        return o.status === "paid";
      return false;
    });

    if (!list.length) {
      subSlot.appendChild(emptyState({
        iconName: "info",
        title: t("admin.orders.none")
      }));
      return;
    }

    list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    const wrap = el("div", { className: "stack" });
    for (const o of list) wrap.appendChild(buildAdminOrderCard(o, secretsCache, unlocksCache, reloadSecrets));
    subSlot.appendChild(wrap);
  }

  async function reloadSecrets() {
    try {
      const secSnap = await getDocs(collection(db, "orderSecrets"));
      secretsCache.clear();
      secSnap.forEach((d) => secretsCache.set(d.id, d.data()?.code || ""));

      const unlSnap = await getDocs(collection(db, "unlocks"));
      unlocksCache.clear();
      unlSnap.forEach((d) => {
        const u = d.data() || {};
        if (u.uid && u.gameId) unlocksCache.add(`${u.uid}_${u.gameId}`);
      });

      paintSubTabs();
      paintList();
    } catch (e) {
      console.error("loadSecretsAndUnlocks failed:", e);
    }
  }

  ordersSub = onSnapshot(
    query(collection(db, "orders"), orderBy("createdAt", "desc")),
    (snap) => {
      ordersCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      paintSubTabs();
      paintList();

      const pending = ordersCache.filter((o) => o.status === "pending").length;
      document.title = pending ? `(${pending}) Glassa Admin` : "Glassa";
    },
    (err) => {
      console.error("orders snapshot failed:", err);
      toastError(t("error.network"));
    }
  );

  await reloadSecrets();

  return () => {
    try { if (ordersSub) ordersSub(); } catch (_) {}
  };
}

function buildAdminOrderCard(order, secretsCache, unlocksCache, onReload) {
  const card = el("div", { className: "glass glass--pad stack" });

  const head = el("div", { className: "row row--between" });
  head.appendChild(el("span", { className: "text-bold", textContent: `#${order.id.slice(0, 8).toUpperCase()}` }));
  const pillClass = order.status === "paid" ? "pill--success"
                  : order.status === "rejected" ? "pill--danger"
                  : "pill--warning";
  const pillLabel = order.status === "paid" ? t("orders.status.paid")
                  : order.status === "rejected" ? t("orders.status.rejected")
                  : t("orders.status.pending");
  head.appendChild(el("span", { className: `pill ${pillClass}`, textContent: pillLabel }));
  card.appendChild(head);

  const cust = el("div", { className: "stack stack--sm" });
  cust.appendChild(el("div", { className: "text-sm", textContent: `${t("admin.orders.customer")}: ${order.customerName || "—"}` }));
  if (order.phone) {
    const row = el("div", { className: "row", style: { gap: "8px" } });
    row.appendChild(el("a", {
      className: "pill",
      href: `tel:${encodeURIComponent(order.phone)}`,
      textContent: `📞 ${order.phone}`
    }));
    row.appendChild(el("a", {
      className: "pill",
      href: `https://wa.me/${order.phone.replace(/[^\d]/g, "")}`,
      target: "_blank",
      rel: "noopener",
      textContent: `💬 ${t("admin.orders.whatsapp")}`
    }));
    cust.appendChild(row);
  }
  if (order.note) {
    cust.appendChild(el("div", { className: "text-xs text-muted", textContent: `${t("admin.orders.note")}: ${order.note}` }));
  }
  cust.appendChild(el("div", { className: "text-xs text-muted", textContent: formatDate(order.createdAt) }));
  card.appendChild(cust);

  const itemsList = el("div", { className: "stack stack--sm" });
  for (const it of (order.items || [])) {
    const r = el("div", { className: "row row--between" });
    r.appendChild(el("span", { className: "text-sm", textContent: it.title }));
    r.appendChild(el("span", { className: "text-sm text-muted", textContent: formatPrice(it.price) }));
    itemsList.appendChild(r);
  }
  card.appendChild(itemsList);

  card.appendChild(adminRow(t("cart.subtotal"), formatPrice(order.subtotal)));
  if (order.discountPercent) {
    const dv = Math.round((order.subtotal * order.discountPercent) / 100 * 100) / 100;
    card.appendChild(adminRow(`${t("cart.discount")} (${order.discountPercent}%)`, `- ${formatPrice(dv)}`));
  }
  card.appendChild(adminRow(t("cart.total"), formatPrice(order.total), true));

  if (order.status === "pending") {
    checkTotalMismatch(order).then((mismatch) => {
      if (mismatch) {
        const warn = el("div", {
          className: "pill pill--warning",
          style: { marginTop: "4px" },
          textContent: t("admin.orders.totalMismatch")
        });
        card.insertBefore(warn, card.firstChild);
      }
    });
  }

  if (order.status === "rejected" && order.rejectReason) {
    card.appendChild(el("div", {
      className: "text-xs text-danger",
      style: { whiteSpace: "pre-line" },
      textContent: `${t("orders.reason")}: ${order.rejectReason}`
    }));
  }

  if (order.status === "paid") {
    const code = secretsCache.get(order.id) || "";
    card.appendChild(el("hr", { className: "divider" }));

    const codeRow = el("div", { className: "row row--between" });
    codeRow.appendChild(el("span", { className: "text-xs text-muted", textContent: t("admin.orders.code") }));
    codeRow.appendChild(el("span", { className: "text-bold code-input", style: { letterSpacing: "0.1em" }, textContent: code || "—" }));
    card.appendChild(codeRow);

    const gameIds = order.itemIds || [];
    const unlockedCount = gameIds.filter((gid) => unlocksCache.has(`${order.uid}_${gid}`)).length;
    const status = unlockedCount === gameIds.length && gameIds.length
      ? t("admin.orders.unlocked")
      : t("admin.orders.notUnlocked");
    card.appendChild(el("div", { className: "text-xs", textContent: `${unlockedCount}/${gameIds.length} • ${status}` }));

    const actionsRow = el("div", { className: "row", style: { gap: "8px", marginTop: "8px", flexWrap: "wrap" } });

    if (code) {
      actionsRow.appendChild(el("button", {
        className: "btn btn--glass btn--sm",
        type: "button",
        textContent: t("admin.orders.copyCode"),
        onClick: async () => {
          const ok = await copyToClipboard(code);
          if (ok) toastSuccess(t("common.copied"));
        }
      }));
    }

    actionsRow.appendChild(el("button", {
      className: "btn btn--glass btn--sm",
      type: "button",
      textContent: t("admin.orders.resend"),
      onClick: () => resendPaymentEmail(order, code)
    }));

    card.appendChild(actionsRow);
  }

  if (order.status === "pending") {
    const actions = el("div", { className: "row", style: { gap: "8px", marginTop: "8px", flexWrap: "wrap" } });

    actions.appendChild(el("button", {
      className: "btn btn--primary",
      type: "button",
      textContent: t("admin.orders.markPaid"),
      onClick: async () => {
        const ok = await confirmDialog({
          title: t("admin.orders.markPaid"),
          message: t("admin.orders.confirmPaid"),
          confirmLabel: t("common.confirm")
        });
        if (!ok) return;
        await markOrderPaid(order, onReload);
      }
    }));

    actions.appendChild(el("button", {
      className: "btn btn--danger",
      type: "button",
      textContent: t("admin.orders.reject"),
      onClick: () => promptRejectOrder(order, onReload)
    }));

    card.appendChild(actions);
  }

  return card;
}

function adminRow(label, value, bold) {
  const r = el("div", { className: "row row--between" });
  r.appendChild(el("span", { className: bold ? "text-bold" : "text-muted", textContent: label }));
  r.appendChild(el("span", { className: bold ? "text-bold" : "", textContent: value }));
  return r;
}

async function checkTotalMismatch(order) {
  try {
    let subtotal = 0;
    for (const it of (order.items || [])) {
      const snap = await getDoc(doc(db, "games", it.gameId));
      if (!snap.exists()) continue;
      const g = snap.data() || {};
      const eff = currentEffectivePrice(g);
      subtotal += eff;
    }
    const dp = Number(order.discountPercent) || 0;
    const total = Math.max(0, Math.round((subtotal - (subtotal * dp) / 100) * 100) / 100);
    return Math.abs(total - Number(order.total)) > 0.05;
  } catch (_) {
    return false;
  }
}

function currentEffectivePrice(g) {
  const offer = Number(g.offerPrice);
  if (Number.isFinite(offer) && offer >= 0) {
    const endsAt = g.offerEndsAt?.toDate?.();
    if (!endsAt || endsAt.getTime() > Date.now()) return offer;
  }
  return Number(g.price) || 0;
}

async function markOrderPaid(order, onReload) {
  const code = generateUnlockCode();

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "orderSecrets", order.id), {
      code,
      createdAt: serverTimestamp()
    });
    batch.update(doc(db, "orders", order.id), {
      status: "paid",
      paidAt: serverTimestamp()
    });
    await batch.commit();
  } catch (e) {
    console.error("markOrderPaid failed:", e);
    toastError(t("error.unknown"));
    return;
  }

  const ok = await sendPaymentEmail(order, code);
  if (ok) {
    toastSuccess(t("admin.orders.paidSuccess"));
  } else {
    toastError(t("admin.orders.emailFailed"));
    openModal({
      title: t("admin.orders.code"),
      body: code,
      actions: [
        { label: t("common.ok") },
        {
          label: t("admin.orders.copyCode"),
          variant: "primary",
          closeAfter: true,
          onClick: async () => { await copyToClipboard(code); toastSuccess(t("common.copied")); }
        }
      ]
    });
  }

  if (typeof onReload === "function") await onReload();
}

async function promptRejectOrder(order, onReload) {
  const body = el("div");
  const field = el("div", { className: "field" });
  field.appendChild(el("label", { className: "field__label", textContent: t("admin.orders.reason") }));
  const ta = el("textarea", { className: "textarea", maxLength: 300 });
  field.appendChild(ta);
  body.appendChild(field);

  openModal({
    title: t("admin.orders.reject"),
    body,
    actions: [
      { label: t("common.cancel"), variant: "ghost" },
      {
        label: t("common.confirm"),
        variant: "danger",
        onClick: async () => {
          const reason = ta.value.trim();
          if (!reason) { toastError(t("admin.orders.reasonRequired")); return false; }
          await rejectOrder(order, reason, onReload);
        }
      }
    ]
  });
}

async function rejectOrder(order, reason, onReload) {
  try {
    await updateDoc(doc(db, "orders", order.id), {
      status: "rejected",
      rejectReason: reason,
      rejectionSeen: false
    });
    if (order.couponCode) {
      try {
        const couponSnap = await getDoc(doc(db, "coupons", order.couponCode));
        if (couponSnap.exists() && couponSnap.data()?.mode === "once") {
          await deleteDoc(doc(db, "couponUses", `${order.couponCode}_${order.uid}`));
        }
      } catch (e) {
        console.error("coupon free failed:", e);
      }
    }
    toastSuccess(t("admin.orders.rejectedSuccess"));
    if (typeof onReload === "function") await onReload();
  } catch (e) {
    console.error("rejectOrder failed:", e);
    toastError(t("error.unknown"));
  }
}

async function sendPaymentEmail(order, code) {
  const siteUrl = CONFIG.siteUrl;
  const games = (order.items || []).map((it) => it.title).join("\n");

  const params = {
    to_email: order.email,
    email: order.email,
    customer_name: order.customerName || "",
    customerName: order.customerName || "",
    order_id: order.id.slice(0, 8).toUpperCase(),
    orderId: order.id.slice(0, 8).toUpperCase(),
    games,
    total: Number(order.total).toFixed(2),
    code,
    passcode: code,
    site_url: siteUrl
  };

  const res = await sendEmailViaEmailJS(CONFIG.emailjs.paymentTemplateId, params);
  return res.ok;
}

async function resendPaymentEmail(order, code) {
  const ok = await sendPaymentEmail(order, code);
  if (ok) toastSuccess(t("admin.orders.emailSent"));
  else toastError(t("admin.orders.emailFailed"));
}

/* ============================================================================
   2) GAMES TAB
   ========================================================================== */

async function mountGamesTab(container) {
  const state = { search: "" };
  const listSlot = el("div");

  const bar = el("div", { className: "row row--between", style: { gap: "8px", marginBottom: "12px" } });
  const search = el("input", {
    className: "input grow",
    placeholder: t("admin.games.searchPlaceholder"),
    onInput: (e) => { state.search = e.target.value.toLowerCase(); paint(); }
  });
  const addBtn = el("button", {
    className: "btn btn--primary",
    type: "button",
    onClick: () => openGameForm(null, () => paint())
  });
  addBtn.appendChild(icon("plus", 18));
  addBtn.appendChild(el("span", { textContent: t("admin.games.add") }));
  bar.appendChild(search);
  bar.appendChild(addBtn);
  container.appendChild(bar);
  container.appendChild(listSlot);

  let games = [];

  async function reload() {
    try {
      const snap = await getDocs(collection(db, "games"));
      games = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      games.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    } catch (e) {
      console.error("games load failed:", e);
      games = [];
    }
    paint();
  }

  function paint() {
    listSlot.innerHTML = "";
    if (!games.length) {
      listSlot.appendChild(emptyState({
        iconName: "gamepad",
        title: t("admin.games.none")
      }));
      return;
    }
    const needle = state.search.trim();
    const filtered = needle
      ? games.filter((g) =>
          (g.title_ar || "").toLowerCase().includes(needle) ||
          (g.title_en || "").toLowerCase().includes(needle) ||
          g.id.toLowerCase().includes(needle)
        )
      : games;

    const wrap = el("div", { className: "stack" });
    for (const g of filtered) wrap.appendChild(buildAdminGameRow(g, reload));
    listSlot.appendChild(wrap);
  }

  await reload();
  return () => {};
}

function buildAdminGameRow(game, onChanged) {
  const row = el("div", { className: "line", style: { padding: "12px" } });

  const thumb = el("div", { className: "line__thumb" });
  if (game.coverUrl) {
    constappendChild(itemsList);

  // Totals
  card.appendChild(row2(t("cart.subtotal"), formatPrice(order.subtotal)));
  if (order.discountPercent) {
    const dv = Math.round((order.subtotal * order.discountPercent) / 100 * 100) / 100;
    card.appendChild(row2(`${t("cart.discount")} (${order.discountPercent}%)`, `- ${formatPrice(dv)}`));
  }
  card.appendChild(row2(t("cart.total"), formatPrice(order.total), true));

  // Total mismatch check
  if (order.status === "pending") {
    checkTotalMismatch(order).then((mismatch) => {
      if (mismatch) card.insertBefore(
        el("div", { className: "pill pill--warning", style: { marginTop: "4px" }, textContent: t("admin.orders.totalMismatch") }),
        card.firstChild
      );
    });
  }

  // Rejection reason (view)
  if (order.status === "rejected" && order.rejectReason) {
    card.appendChild(el("div", {
      className: "text-xs text-danger",
      style: { whiteSpace: "pre-line" },
      textContent: `${t("orders.reason")}: ${order.rejectReason}`
    }));
  }

  // Paid block: code + copy/resend + unlock state
  if (order.status === "paid") {
    const code = secretsCache.get(order.id) || "";
    card.appendChild(el("hr", { className: "divider" }));

    const codeRow = el("div", { className: "row row--between" });
    codeRow.appendChild(el("span", { className: "text-xs text-muted", textContent: t("admin.orders.code") }));
    codeRow.appendChild(el("span", { className: "text-bold code-input", style: { letterSpacing: "0.1em" }, textContent: code || "—" }));
    card.appendChild(codeRow);

    // Unlock state
    const gameIds = order.itemIds || [];
    const unlockedCount = gameIds.filter((gid) => unlocksCache.has(`${order.uid}_${gid}`)).length;
    const status = unlockedCount === gameIds.length && gameIds.length
      ? t("admin.orders.unlocked")
      : t("admin.orders.notUnlocked");
    card.appendChild(el("div", { className: "text-xs", textContent: `${unlockedCount}/${gameIds.length} • ${status}` }));

    const actionsRow = el("div", { className: "row", style: { gap: "8px", marginTop: "8px", flexWrap: "wrap" } });

    if (code) {
      actionsRow.appendChild(el("button", {
        className: "btn btn--glass btn--sm",
        type: "button",
        textContent: t("admin.orders.copyCode"),
        onClick: async () => {
          const ok = await copyToClipboard(code);
          if (ok) toastSuccess(t("common.copied"));
        }
      }));
    }

    actionsRow.appendChild(el("button", {
      className: "btn btn--glass btn--sm",
      type: "button",
      textContent: t("admin.orders.resend"),
      onClick: () => resendPaymentEmail(order, code)
    }));

    card.appendChild(actionsRow);
  }

  // Actions for pending
  if (order.status === "pending") {
    const actions = el("div", { className: "row", style: { gap: "8px", marginTop: "8px", flexWrap: "wrap" } });

    actions.appendChild(el("button", {
      className: "btn btn--primary",
      type: "button",
      textContent: t("admin.orders.markPaid"),
      onClick: async () => {
        const ok = await confirmDialog({
          title: t("admin.orders.markPaid"),
          message: t("admin.orders.confirmPaid"),
          confirmLabel: t("common.confirm")
        });
        if (!ok) return;
        await markOrderPaid(order);
      }
    }));

    actions.appendChild(el("button", {
      className: "btn btn--danger",
      type: "button",
      textContent: t("admin.orders.reject"),
      onClick: () => promptRejectOrder(order)
    }));

    card.appendChild(actions);
  }

  return card;
}

function row2(label, value, bold = false) {
  const r = el("div", { className: "row row--between" });
  r.appendChild(el("span", { className: bold ? "text-bold" : "text-muted", textContent: label }));
  r.appendChild(el("span", { className: bold ? "text-bold" : "", textContent: value }));
  return r;
}

/**
 * Compare stored order total against current prices + coupon.
 * Returns true if they differ (mismatch → show warning).
 */
async function checkTotalMismatch(order) {
  try {
    let subtotal = 0;
    for (const it of (order.items || [])) {
      const snap = await getDoc(doc(db, "games", it.gameId));
      if (!snap.exists()) continue;
      const g = snap.data() || {};
      const eff = currentEffectivePrice(g);
      subtotal += eff;
    }
    const dp = Number(order.discountPercent) || 0;
    const total = Math.max(0, Math.round((subtotal - (subtotal * dp) / 100) * 100) / 100);
    return Math.abs(total - Number(order.total)) > 0.05;
  } catch (_) {
    return false;
  }
}

function currentEffectivePrice(g) {
  const offer = Number(g.offerPrice);
  if (Number.isFinite(offer) && offer >= 0) {
    const endsAt = g.offerEndsAt?.toDate?.();
    if (!endsAt || endsAt.getTime() > Date.now()) return offer;
  }
  return Number(g.price) || 0;
}

/* ---- Actions on orders ------------------------------------------------- */

async function markOrderPaid(order) {
  const code = generateUnlockCode();

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "orderSecrets", order.id), {
      code,
      createdAt: serverTimestamp()
    });
    batch.update(doc(db, "orders", order.id), {
      status: "paid",
      paidAt: serverTimestamp()
    });
    await batch.commit();
  } catch (e) {
    console.error("markOrderPaid failed:", e);
    toastError(t("error.unknown"));
    return;
  }

  // Send payment email
  const ok = await sendPaymentEmail(order, code);
  if (ok) {
    toastSuccess(t("admin.orders.paidSuccess"));
  } else {
    // Keep paid, but tell the owner to copy the code manually.
    toastError(t("admin.orders.emailFailed"));
    openModal({
      title: t("admin.orders.code"),
      body: code,
      actions: [
        { label: t("common.ok") },
        {
          label: t("admin.orders.copyCode"),
          variant: "primary",
          closeAfter: true,
          onClick: async () => { await copyToClipboard(code); toastSuccess(t("common.copied")); }
        }
      ]
    });
  }
}

async function promptRejectOrder(order) {
  const body = el("div");
  const field = el("div", { className: "field" });
  field.appendChild(el("label", { className: "field__label", textContent: t("admin.orders.reason") }));
  const ta = el("textarea", { className: "textarea", maxLength: 300 });
  field.appendChild(ta);
  body.appendChild(field);

  openModal({
    title: t("admin.orders.reject"),
    body,
    actions: [
      { label: t("common.cancel"), variant: "ghost" },
      {
        label: t("common.confirm"),
        variant: "danger",
        onClick: async () => {
          const reason = ta.value.trim();
          if (!reason) { toastError(t("admin.orders.reasonRequired")); return false; }
          await rejectOrder(order, reason);
        }
      }
    ]
  });
}

async function rejectOrder(order, reason) {
  try {
    await updateDoc(doc(db, "orders", order.id), {
      status: "rejected",
      rejectReason: reason,
      rejectionSeen: false
    });
    // Free up the "once" coupon if any.
    if (order.couponCode) {
      try {
        const couponSnap = await getDoc(doc(db, "coupons", order.couponCode));
        if (couponSnap.exists() && couponSnap.data()?.mode === "once") {
          await deleteDoc(doc(db, "couponUses", `${order.couponCode}_${order.uid}`));
        }
      } catch (e) {
        console.error("coupon free failed:", e);
      }
    }
    toastSuccess(t("admin.orders.rejectedSuccess"));
  } catch (e) {
    console.error("rejectOrder failed:", e);
    toastError(t("error.unknown"));
  }
}

/* ---- Emails ------------------------------------------------------------ */

async function sendPaymentEmail(order, code) {
  const siteUrl = CONFIG.siteUrl;

  // Use titles in the customer's language, falling back to English.
  const lang = getLang();
  const games = (order.items || []).map((it) => it.title).join("\n");

  const params = {
    to_email: order.email,
    customer_name: order.customerName || "",
    order_id: order.id.slice(0, 8).toUpperCase(),
    games,
    total: Number(order.total).toFixed(2),
    code,
    site_url: siteUrl
  };

  return await sendEmailViaEmailJS(CONFIG.emailjs.paymentTemplateId, params);
}

async function resendPaymentEmail(order, code) {
  const ok = await sendPaymentEmail(order, code);
  if (ok) toastSuccess(t("admin.orders.emailSent"));
  else toastError(t("admin.orders.emailFailed"));
}

/* ============================================================================
   2) GAMES TAB
   ========================================================================== */

async function mountGamesTab(container) {
  const state = { search: "" };
  const listSlot = el("div");

  const bar = el("div", { className: "row row--between", style: { gap: "8px", marginBottom: "12px" } });
  const search = el("input", {
    className: "input grow",
    placeholder: t("admin.games.searchPlaceholder"),
    onInput: (e) => { state.search = e.target.value.toLowerCase(); paint(); }
  });
  const addBtn = el("button", {
    className: "btn btn--primary",
    type: "button",
    onClick: () => openGameForm(null, () => paint())
  });
  addBtn.appendChild(icon("plus", 18));
  addBtn.appendChild(el("span", { textContent: t("admin.games.add") }));
  bar.appendChild(search);
  bar.appendChild(addBtn);
  container.appendChild(bar);
  container.appendChild(listSlot);

  let games = [];

  async function reload() {
    try {
      const snap = await getDocs(collection(db, "games"));
      games = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Sort by createdAt desc in JS.
      games.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    } catch (e) {
      console.error("games load failed:", e);
      games = [];
    }
    paint();
  }

  function paint() {
    listSlot.innerHTML = "";
    if (!games.length) {
      listSlot.appendChild(emptyState({
        iconName: "gamepad",
        title: t("admin.games.none")
      }));
      return;
    }
    const needle = state.search.trim();
    const filtered = needle
      ? games.filter((g) =>
          (g.title_ar || "").toLowerCase().includes(needle) ||
          (g.title_en || "").toLowerCase().includes(needle) ||
          g.id.toLowerCase().includes(needle)
        )
      : games;

    const wrap = el("div", { className: "stack" });
    for (const g of filtered) wrap.appendChild(buildAdminGameRow(g, reload));
    listSlot.appendChild(wrap);
  }

  await reload();
  return () => {};
}

function buildAdminGameRow(game, onChanged) {
  const row = el("div", { className: "line", style: { padding: "12px" } });

  const thumb = el("div", { className: "line__thumb" });
  if (game.coverUrl) {
    const img = el("img", { src: cloudinaryThumb(game.coverUrl, 200), alt: "", loading: "lazy" });
    img.addEventListener("error", () => img.remove());
    thumb.appendChild(img);
  }
  row.appendChild(thumb);

  const body = el("div", { className: "line__body" });
  body.appendChild(el("div", { className: "line__title", textContent: pickLocalized(game.title_ar, game.title_en) || "—" }));
  const sub = el("div", { className: "line__sub" });
  sub.appendChild(el("span", { textContent: game.platform === "android" ? "Android" : "PC" }));
  sub.appendChild(document.createTextNode(" • "));
  sub.appendChild(el("span", { textContent: formatPrice(currentEffectivePrice(game)) }));
  if (game.hidden) {
    sub.appendChild(document.createTextNode(" • "));
    sub.appendChild(el("span", { className: "pill pill--danger", textContent: t("admin.games.hidden") }));
  }
  body.appendChild(sub);
  row.appendChild(body);

  const actions = el("div", { className: "row", style: { gap: "4px", flexWrap: "wrap" } });

  actions.appendChild(el("button", {
    className: "btn btn--glass btn--sm",
    type: "button",
    textContent: t("common.edit"),
    onClick: () => openGameForm(game, onChanged)
  }));

  actions.appendChild(el("button", {
    className: "btn btn--ghost btn--sm",
    type: "button",
    textContent: game.hidden ? t("admin.games.visible") : t("admin.games.hidden"),
    onClick: async () => {
      try {
        await updateDoc(doc(db, "games", game.id), { hidden: !game.hidden, updatedAt: serverTimestamp() });
        resetCatalogCache();
        onChanged();
      } catch (e) {
        console.error("toggle hidden failed:", e);
        toastError(t("error.unknown"));
      }
    }
  }));

  actions.appendChild(el("button", {
    className: "btn btn--ghost btn--sm",
    type: "button",
    textContent: t("common.delete"),
    onClick: async () => {
      const ok = await confirmDialog({
        title: t("admin.games.delete"),
        message: t("admin.games.deleteConfirm"),
        confirmLabel: t("common.delete"),
        danger: true
      });
      if (!ok) return;
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, "games", game.id));
        batch.delete(doc(db, "links", game.id));
        await batch.commit();
        resetCatalogCache();
        toastSuccess(t("admin.games.deleted"));
        onChanged();
      } catch (e) {
        console.error("delete game failed:", e);
        toastError(t("error.unknown"));
      }
    }
  }));

  row.appendChild(actions);
  return row;
}

/**
 * Add / edit game modal.
 * @param {object|null} game
 * @param {Function} onSaved
 */
async function openGameForm(game, onSaved) {
  const isEdit = Boolean(game);
  const g = game || {
    title_ar: "", title_en: "",
    desc_ar: "", desc_en: "",
    platform: "pc",
    price: 0,
    offerPrice: null,
    offerEndsAt: null,
    size: "",
    worksPercent: 100,
    sysReq: "",
    coverUrl: "",
    screenshots: [],
    hidden: false,
    badgeMostRequested: false,
    badgeUpdated: false
  };

  // Fetch the private download link (owner-only read)
  let downloadUrl = "";
  if (isEdit) {
    try {
      const s = await getDoc(doc(db, "links", g.id));
      downloadUrl = s.exists() ? (s.data()?.downloadUrl || "") : "";
    } catch (e) {
      console.error("load link failed:", e);
    }
  }

  const body = el("div");

  // Field helpers
  const mkField = (label, input, hint) => {
    const f = el("div", { className: "field" });
    if (label) f.appendChild(el("label", { className: "field__label", textContent: label }));
    f.appendChild(input);
    if (hint) f.appendChild(el("div", { className: "field__hint", textContent: hint }));
    return f;
  };

  // Titles
  const titleAr = el("input", { className: "input", value: g.title_ar || "", maxLength: 100 });
  const titleEn = el("input", { className: "input", value: g.title_en || "", maxLength: 100 });
  body.appendChild(mkField(t("admin.games.field.title_ar"), titleAr));
  body.appendChild(mkField(t("admin.games.field.title_en"), titleEn));

  // Platform
  const platformSel = el("select", { className: "select" });
  for (const [v, l] of [["pc", "PC"], ["android", "Android"]]) {
    const o = el("option", { value: v, textContent: l });
    if (g.platform === v) o.selected = true;
    platformSel.appendChild(o);
  }
  body.appendChild(mkField(t("admin.games.field.platform"), platformSel));

  // Price / size / works
  const priceIn = el("input", { className: "input", type: "number", min: 0, step: "0.01", value: String(g.price ?? "") });
  const sizeIn  = el("input", { className: "input", value: g.size || "", maxLength: 40 });
  const worksIn = el("input", { className: "input", type: "number", min: 0, max: 100, value: String(g.worksPercent ?? 100) });
  body.appendChild(mkField(t("admin.games.field.price"), priceIn));
  body.appendChild(mkField(t("admin.games.field.size"), sizeIn));
  body.appendChild(mkField(t("admin.games.field.worksPercent"), worksIn));

  // Sys req (PC only)
  const sysReqIn = el("textarea", { className: "textarea", maxLength: 800 });
  sysReqIn.value = g.sysReq || "";
  const sysReqField = mkField(t("admin.games.field.sysReq"), sysReqIn);
  body.appendChild(sysReqField);
  const updateSysReqVisibility = () => { sysReqField.style.display = platformSel.value === "pc" ? "" : "none"; };
  platformSel.addEventListener("change", updateSysReqVisibility);
  updateSysReqVisibility();

  // Descriptions
  const descArIn = el("textarea", { className: "textarea", maxLength: 4000 });
  descArIn.value = g.desc_ar || "";
  const descEnIn = el("textarea", { className: "textarea", maxLength: 4000 });
  descEnIn.value = g.desc_en || "";
  body.appendChild(mkField(t("admin.games.field.desc_ar"), descArIn));
  body.appendChild(mkField(t("admin.games.field.desc_en"), descEnIn));

  // Cover (upload or URL)
  const coverState = { url: g.coverUrl || "" };
  const coverField = el("div", { className: "field" });
  coverField.appendChild(el("label", { className: "field__label", textContent: t("admin.games.field.cover") }));

  const coverPreview = el("div", { className: "line__thumb", style: { width: "120px", height: "80px", marginBottom: "8px" } });
  const renderCoverPreview = () => {
    coverPreview.innerHTML = "";
    if (coverState.url) {
      const img = el("img", { src: cloudinaryThumb(coverState.url, 300), alt: "" });
      img.addEventListener("error", () => img.remove());
      coverPreview.appendChild(img);
    }
  };
  renderCoverPreview();
  coverField.appendChild(coverPreview);

  const coverFile = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp" });
  const coverUrlIn = el("input", { className: "input", placeholder: t("admin.games.field.orUrl") });
  coverUrlIn.value = coverState.url;
  coverUrlIn.addEventListener("input", () => { coverState.url = coverUrlIn.value.trim(); renderCoverPreview(); });

  const coverUploadStatus = el("div", { className: "text-xs text-muted" });

  coverFile.addEventListener("change", async () => {
    const file = coverFile.files?.[0];
    if (!file) return;
    coverUploadStatus.textContent = t("admin.games.uploading");
    const url = await uploadImage(file);
    if (!url) {
      coverUploadStatus.textContent = "";
      toastError(t("error.unknown"));
      return;
    }
    coverState.url = url;
    coverUrlIn.value = url;
    renderCoverPreview();
    coverUploadStatus.textContent = "";
    toastSuccess(t("common.saveChanges"));
  });

  coverField.appendChild(coverFile);
  coverField.appendChild(coverUrlIn);
  coverField.appendChild(coverUploadStatus);
  body.appendChild(coverField);

  // Screenshots (up to 8)
  const shotsField = el("div", { className: "field" });
  shotsField.appendChild(el("label", { className: "field__label", textContent: t("admin.games.field.screenshots") }));
  let shots = Array.isArray(g.screenshots) ? g.screenshots.slice(0, 8) : [];

  const shotsList = el("div", { className: "row row--wrap", style: { gap: "8px" } });
  const renderShots = () => {
    shotsList.innerHTML = "";
    shots.forEach((url, i) => {
      const thumb = el("div", { className: "line__thumb", style: { width: "90px", height: "60px", position: "relative" } });
      const img = el("img", { src: cloudinaryThumb(url, 300), alt: "" });
      img.addEventListener("error", () => img.remove());
      thumb.appendChild(img);
      const rm = el("button", {
        type: "button",
        className: "btn btn--danger btn--icon",
        style: { position: "absolute", top: "-6px", insetInlineEnd: "-6px", width: "28px", minHeight: "28px" },
        "aria-label": t("common.delete"),
        onClick: () => { shots.splice(i, 1); renderShots(); }
      }, icon("x", 14));
      thumb.appendChild(rm);
      shotsList.appendChild(thumb);
    });
  };
  renderShots();
  shotsField.appendChild(shotsList);

  const shotsFile = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true });
  const shotsUrlIn = el("input", { className: "input", placeholder: t("admin.games.field.orUrl") });
  const addShotBtn = el("button", {
    className: "btn btn--glass btn--sm",
    type: "button",
    textContent: t("admin.games.field.addScreenshot"),
    onClick: () => {
      const url = shotsUrlIn.value.trim();
      if (!url || shots.length >= 8) return;
      shots.push(url);
      shotsUrlIn.value = "";
      renderShots();
    }
  });

  shotsFile.addEventListener("change", async () => {
    const files = Array.from(shotsFile.files || []).slice(0, 8 - shots.length);
    for (const f of files) {
      const url = await uploadImage(f);
      if (url) shots.push(url);
    }
    renderShots();
  });

  shotsField.appendChild(shotsFile);
  shotsField.appendChild(el("div", { className: "row", style: { gap: "8px" } }, shotsUrlIn, addShotBtn));
  body.appendChild(shotsField);

  // Download URL (private)
  const dlIn = el("input", { className: "input", value: downloadUrl, placeholder: "https://…" });
  body.appendChild(mkField(t("admin.games.field.downloadUrl"), dlIn));

  // Toggles
  const hiddenSw = switchRow(t("admin.games.field.hidden"), !!g.hidden);
  const mostSw   = switchRow(t("admin.games.field.mostRequested"), !!g.badgeMostRequested);
  const updSw    = switchRow(t("admin.games.field.updated"), !!g.badgeUpdated);
  body.appendChild(hiddenSw.wrap);
  body.appendChild(mostSw.wrap);
  body.appendChild(updSw.wrap);

  // Offer block
  body.appendChild(el("hr", { className: "divider" }));
  body.appendChild(el("div", { className: "text-sm text-bold", textContent: t("admin.games.field.offer") }));

  const offerPriceIn = el("input", {
    className: "input",
    type: "number",
    min: 0,
    step: "0.01",
    value: g.offerPrice == null ? "" : String(g.offerPrice)
  });
  body.appendChild(mkField(t("admin.games.field.offerPrice"), offerPriceIn));

  // Offer mode radio (permanent / until)
  const currentEnds = g.offerEndsAt?.toDate?.();
  const offerModePermanent = !currentEnds;
  const permanentRadio = el("input", { type: "radio", name: "offerMode" });
  if (offerModePermanent) permanentRadio.checked = true;
  const untilRadio = el("input", { type: "radio", name: "offerMode" });
  if (!offerModePermanent) untilRadio.checked = true;
  const dtIn = el("input", { className: "input", type: "datetime-local" });
  if (currentEnds) {
    // Format to local datetime-local value: YYYY-MM-DDTHH:MM
    const pad = (n) => String(n).padStart(2, "0");
    dtIn.value = `${currentEnds.getFullYear()}-${pad(currentEnds.getMonth() + 1)}-${pad(currentEnds.getDate())}T${pad(currentEnds.getHours())}:${pad(currentEnds.getMinutes())}`;
  }

  const offerModeRow = el("div", { className: "stack stack--sm" });
  offerModeRow.appendChild(el("label", { className: "row", style: { gap: "8px" } },
    permanentRadio,
    el("span", { textContent: t("admin.games.field.offerPermanent") })
  ));
  offerModeRow.appendChild(el("label", { className: "row", style: { gap: "8px" } },
    untilRadio,
    el("span", { textContent: t("admin.games.field.offerUntil") })
  ));
  offerModeRow.appendChild(dtIn);
  const updateDtDisabled = () => { dtIn.disabled = permanentRadio.checked; };
  permanentRadio.addEventListener("change", updateDtDisabled);
  untilRadio.addEventListener("change", updateDtDisabled);
  updateDtDisabled();
  body.appendChild(offerModeRow);

  // Save
  openModal({
    title: isEdit ? t("admin.games.edit") : t("admin.games.add"),
    body,
    dismissible: true,
    actions: [
      { label: t("common.cancel"), variant: "ghost" },
      {
        label: t("common.saveChanges"),
        variant: "primary",
        closeAfter: false,
        onClick: async () => {
          const titleA = titleAr.value.trim();
          const titleE = titleEn.value.trim();
          if (!titleA && !titleE) { toastError(t("admin.games.errors.titleRequired")); return false; }
          const price = Number(priceIn.value);
          if (!Number.isFinite(price) || price < 0) { toastError(t("admin.games.errors.priceRequired")); return false; }
          const dl = dlIn.value.trim();
          if (!dl) { toastError(t("admin.games.errors.linkRequired")); return false; }

          const offerPriceRaw = offerPriceIn.value.trim();
          const offerPrice = offerPriceRaw === "" ? null : Number(offerPriceRaw);
          let offerEndsAt = null;
          if (untilRadio.checked && dtIn.value) {
            const d = new Date(dtIn.value);
            if (!isNaN(d.getTime())) offerEndsAt = Timestamp.fromDate(d);
          }

          const gameId = g.id || autoId();
          const payload = {
            title_ar: titleA,
            title_en: titleE,
            desc_ar: descArIn.value.trim(),
            desc_en: descEnIn.value.trim(),
            platform: platformSel.value,
            price,
            offerPrice: Number.isFinite(offerPrice) ? offerPrice : null,
            offerEndsAt,
            size: sizeIn.value.trim(),
            worksPercent: Math.max(0, Math.min(100, Number(worksIn.value) || 0)),
            sysReq: platformSel.value === "pc" ? sysReqIn.value.trim() : "",
            coverUrl: coverState.url.trim(),
            screenshots: shots.slice(0, 8),
            hidden: hiddenSw.input.checked,
            badgeMostRequested: mostSw.input.checked,
            badgeUpdated: updSw.input.checked,
            createdAt: g.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp()
          };

          try {
            const batch = writeBatch(db);
            batch.set(doc(db, "games", gameId), payload, { merge: true });
            batch.set(doc(db, "links", gameId), { downloadUrl: dl }, { merge: true });
            await batch.commit();
            resetCatalogCache();
            toastSuccess(t("admin.games.saved"));
            if (typeof onSaved === "function") onSaved();
            return true;
          } catch (e) {
            console.error("save game failed:", e);
            toastError(t("admin.games.errors.saveFailed"));
            return false;
          }
        }
      }
    ]
  });
}

function switchRow(label, initialChecked) {
  const wrap = el("label", { className: "switch", style: { marginBottom: "8px" } });
  const input = el("input", { type: "checkbox", className: "switch__input" });
  input.checked = !!initialChecked;
  const track = el("span", { className: "switch__track" });
  wrap.appendChild(input);
  wrap.appendChild(track);
  wrap.appendChild(el("span", { className: "text-sm", textContent: label }));
  return { wrap, input };
}

/* ============================================================================
   3) COUPONS TAB
   ========================================================================== */

function mountCouponsTab(container) {
  const listSlot = el("div");
  const bar = el("div", { className: "row row--between", style: { marginBottom: "12px" } });
  bar.appendChild(el("div"));
  const addBtn = el("button", {
    className: "btn btn--primary",
    type: "button",
    onClick: () => openCouponForm(null, reload)
  });
  addBtn.appendChild(icon("plus", 18));
  addBtn.appendChild(el("span", { textContent: t("admin.coupons.add") }));
  bar.appendChild(addBtn);
  container.appendChild(bar);
  container.appendChild(listSlot);

  let coupons = [];
  async function reload() {
    try {
      const snap = await getDocs(collection(db, "coupons"));
      coupons = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      coupons.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    } catch (e) {
      console.error("coupons load failed:", e);
      coupons = [];
    }
    paint();
  }
  function paint() {
    listSlot.innerHTML = "";
    if (!coupons.length) {
      listSlot.appendChild(emptyState({ iconName: "info", title: t("admin.coupons.none") }));
      return;
    }
    const wrap = el("div", { className: "stack" });
    for (const c of coupons) wrap.appendChild(buildCouponRow(c, reload));
    listSlot.appendChild(wrap);
  }
  reload();
  return () => {};
}

function buildCouponRow(c, onChanged) {
  const row = el("div", { className: "line", style: { padding: "12px" } });
  const body = el("div", { className: "line__body" });
  body.appendChild(el("div", { className: "line__title", textContent: c.id }));
  const sub = el("div", { className: "line__sub" });
  sub.appendChild(el("span", { textContent: `${c.percent}%` }));
  sub.appendChild(document.createTextNode(" • "));
  sub.appendChild(el("span", { textContent: c.mode === "once" ? t("admin.coupons.mode.once") : t("admin.coupons.mode.open") }));
  const endsAt = c.expiresAt?.toDate?.();
  if (endsAt) {
    sub.appendChild(document.createTextNode(" • "));
    sub.appendChild(el("span", { textContent: formatDate(c.expiresAt) }));
  }
  if (!c.active) {
    sub.appendChild(document.createTextNode(" • "));
    sub.appendChild(el("span", { className: "pill pill--danger", textContent: t("common.inactive") }));
  }
  body.appendChild(sub);
  row.appendChild(body);

  const actions = el("div", { className: "row", style: { gap: "4px" } });

  actions.appendChild(el("button", {
    className: "btn btn--glass btn--sm",
    type: "button",
    textContent: t("common.edit"),
    onClick: () => openCouponForm(c, onChanged)
  }));

  actions.appendChild(el("button", {
    className: "btn btn--ghost btn--sm",
    type: "button",
    textContent: c.active ? t("common.inactive") : t("common.active"),
    onClick: async () => {
      try {
        await updateDoc(doc(db, "coupons", c.id), { active: !c.active });
        onChanged();
      } catch (e) { toastError(t("error.unknown")); }
    }
  }));

  actions.appendChild(el("button", {
    className: "btn btn--ghost btn--sm",
    type: "button",
    textContent: t("common.delete"),
    onClick: async () => {
      const ok = await confirmDialog({
        title: t("admin.coupons.delete"),
        message: t("admin.coupons.deleteConfirm"),
        confirmLabel: t("common.delete"),
        danger: true
      });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "coupons", c.id));
        toastSuccess(t("admin.coupons.deleted"));
        onChanged();
      } catch (e) { toastError(t("error.unknown")); }
    }
  }));

  row.appendChild(actions);
  return row;
}

function openCouponForm(coupon, onSaved) {
  const isEdit = Boolean(coupon);
  const c = coupon || { percent: 10, mode: "once", expiresAt: null, active: true };

  const body = el("div");
  const mk = (label, input) => {
    const f = el("div", { className: "field" });
    f.appendChild(el("label", { className: "field__label", textContent: label }));
    f.appendChild(input);
    return f;
  };

  const codeIn = el("input", { className: "input code-input", value: isEdit ? coupon.id : "", placeholder: "GLASSA10" });
  if (isEdit) codeIn.disabled = true;
  body.appendChild(mk(t("admin.coupons.code"), codeIn));

  const percentIn = el("input", { className: "input", type: "number", min: 1, max: 100, value: String(c.percent || 10) });
  body.appendChild(mk(t("admin.coupons.percent"), percentIn));

  const modeSel = el("select", { className: "select" });
  for (const [v, l] of [["once", t("admin.coupons.mode.once")], ["open", t("admin.coupons.mode.open")]]) {
    const o = el("option", { value: v, textContent: l });
    if ((c.mode || "once") === v) o.selected = true;
    modeSel.appendChild(o);
  }
  body.appendChild(mk(t("admin.coupons.mode"), modeSel));

  const expiresIn = el("input", { className: "input", type: "datetime-local" });
  const endsAt = c.expiresAt?.toDate?.();
  if (endsAt) {
    const pad = (n) => String(n).padStart(2, "0");
    expiresIn.value = `${endsAt.getFullYear()}-${pad(endsAt.getMonth() + 1)}-${pad(endsAt.getDate())}T${pad(endsAt.getHours())}:${pad(endsAt.getMinutes())}`;
  }
  body.appendChild(mk(t("admin.coupons.expiresAt"), expiresIn));

  const activeSw = switchRow(t("admin.coupons.active"), c.active !== false);
  body.appendChild(activeSw.wrap);

  openModal({
    title: isEdit ? t("admin.coupons.edit") : t("admin.coupons.add"),
    body,
    actions: [
      { label: t("common.cancel"), variant: "ghost" },
      {
        label: t("common.saveChanges"),
        variant: "primary",
        closeAfter: false,
        onClick: async () => {
          const code = String(isEdit ? coupon.id : codeIn.value).trim().toUpperCase();
          if (!code) { toastError(t("admin.coupons.errors.codeRequired")); return false; }
          if (!/^[A-Z0-9-]+$/.test(code)) { toastError(t("admin.coupons.errors.codeFormat")); return false; }
          const percent = Number(percentIn.value);
          if (!Number.isFinite(percent) || percent < 1 || percent > 100) { toastError(t("admin.coupons.errors.percent")); return false; }

          let expiresAt = null;
          if (expiresIn.value) {
            const d = new Date(expiresIn.value);
            if (!isNaN(d.getTime())) expiresAt = Timestamp.fromDate(d);
          }

          const payload = {
            percent,
            mode: modeSel.value,
            expiresAt,
            active: !!activeSw.input.checked,
            createdAt: c.createdAt || serverTimestamp()
          };

          try {
            await setDoc(doc(db, "coupons", code), payload, { merge: true });
            toastSuccess(t("admin.coupons.saved"));
            onSaved();
            return true;
          } catch (e) {
            console.error("save coupon failed:", e);
            toastError(t("error.unknown"));
            return false;
          }
        }
      }
    ]
  });
}

/* ============================================================================
   4) POPUPS TAB
   ========================================================================== */

function mountPopupsTab(container) {
  const listSlot = el("div");
  const bar = el("div", { className: "row row--between", style: { marginBottom: "12px" } });
  bar.appendChild(el("div"));
  const addBtn = el("button", {
    className: "btn btn--primary",
    type: "button",
    onClick: () => openPopupForm(null, reload)
  });
  addBtn.appendChild(icon("plus", 18));
  addBtn.appendChild(el("span", { textContent: t("admin.popups.add") }));
  bar.appendChild(addBtn);
  container.appendChild(bar);
  container.appendChild(listSlot);

  let popups = [];
  async function reload() {
    try {
      const snap = await getDocs(collection(db, "popups"));
      popups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      popups.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    } catch (e) {
      console.error("popups load failed:", e);
      popups = [];
    }
    paint();
  }
  function paint() {
    listSlot.innerHTML = "";
    if (!popups.length) {
      listSlot.appendChild(emptyState({ iconName: "info", title: t("admin.popups.none") }));
      return;
    }
    const wrap = el("div", { className: "stack" });
    for (const p of popups) wrap.appendChild(buildPopupRow(p, reload));
    listSlot.appendChild(wrap);
  }
  reload();
  return () => {};
}

function buildPopupRow(p, onChanged) {
  const row = el("div", { className: "line", style: { padding: "12px" } });
  const body = el("div", { className: "line__body" });
  body.appendChild(el("div", { className: "line__title", textContent: pickLocalized(p.title_ar, p.title_en) || "—" }));
  const sub = el("div", { className: "line__sub" });
  if (!p.active) sub.appendChild(el("span", { className: "pill pill--danger", textContent: t("common.inactive") }));
  else sub.appendChild(el("span", { className: "pill pill--success", textContent: t("common.active") }));
  body.appendChild(sub);
  row.appendChild(body);

  const actions = el("div", { className: "row", style: { gap: "4px" } });
  actions.appendChild(el("button", {
    className: "btn btn--glass btn--sm",
    type: "button",
    textContent: t("common.edit"),
    onClick: () => openPopupForm(p, onChanged)
  }));
  actions.appendChild(el("button", {
    className: "btn btn--ghost btn--sm",
    type: "button",
    textContent: p.active ? t("common.inactive") : t("common.active"),
    onClick: async () => {
      try { await updateDoc(doc(db, "popups", p.id), { active: !p.active }); onChanged(); }
      catch (_) { toastError(t("error.unknown")); }
    }
  }));
  actions.appendChild(el("button", {
    className: "btn btn--ghost btn--sm",
    type: "button",
    textContent: t("common.delete"),
    onClick: async () => {
      const ok = await confirmDialog({ title: t("common.delete"), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      try { await deleteDoc(doc(db, "popups", p.id)); toastSuccess(t("admin.popups.deleted")); onChanged(); }
      catch (_) { toastError(t("error.unknown")); }
    }
  }));
  row.appendChild(actions);
  return row;
}

function openPopupForm(popup, onSaved) {
  const isEdit = Boolean(popup);
  const p = popup || { title_ar: "", title_en: "", body_ar: "", body_en: "", imageUrl: "", active: true };

  const body = el("div");
  const mk = (label, input) => {
    const f = el("div", { className: "field" });
    f.appendChild(el("label", { className: "field__label", textContent: label }));
    f.appendChild(input);
    return f;
  };

  const titleAr = el("input", { className: "input", value: p.title_ar || "" });
  const titleEn = el("input", { className: "input", value: p.title_en || "" });
  const bodyAr = el("textarea", { className: "textarea" }); bodyAr.value = p.body_ar || "";
  const bodyEn = el("textarea", { className: "textarea" }); bodyEn.value = p.body_en || "";
  const imageIn = el("input", { className: "input", value: p.imageUrl || "" });

  body.appendChild(mk(t("admin.popups.title_ar"), titleAr));
  body.appendChild(mk(t("admin.popups.title_en"), titleEn));
  body.appendChild(mk(t("admin.popups.body_ar"), bodyAr));
  body.appendChild(mk(t("admin.popups.body_en"), bodyEn));
  body.appendChild(mk(t("admin.popups.imageUrl"), imageIn));

  const activeSw = switchRow(t("admin.popups.active"), p.active !== false);
  body.appendChild(activeSw.wrap);

  openModal({
    title: isEdit ? t("admin.popups.edit") : t("admin.popups.add"),
    body,
    actions: [
      { label: t("common.cancel"), variant: "ghost" },
      {
        label: t("common.saveChanges"),
        variant: "primary",
        closeAfter: false,
        onClick: async () => {
          const payload = {
            title_ar: titleAr.value.trim(),
            title_en: titleEn.value.trim(),
            body_ar: bodyAr.value.trim(),
            body_en: bodyEn.value.trim(),
            imageUrl: imageIn.value.trim(),
            active: !!activeSw.input.checked,
            createdAt: p.createdAt || serverTimestamp()
          };
          try {
            if (isEdit) await setDoc(doc(db, "popups", popup.id), payload, { merge: true });
            else await addDoc(collection(db, "popups"), payload);
            toastSuccess(t("admin.popups.saved"));
            onSaved();
            return true;
          } catch (e) { toastError(t("error.unknown")); return false; }
        }
      }
    ]
  });
}

/* ============================================================================
   5) ANNOUNCEMENT TAB
   ========================================================================== */

async function mountAnnouncementTab(container) {
  const body = el("div", { className: "glass glass--pad stack" });
  container.appendChild(body);

  let data = { text_ar: "", text_en: "", active: false };
  try {
    const snap = await getDoc(doc(db, "settings", "announcement"));
    if (snap.exists()) data = { ...data, ...snap.data() };
  } catch (e) { console.error(e); }

  const taAr = el("textarea", { className: "textarea" }); taAr.value = data.text_ar || "";
  const taEn = el("textarea", { className: "textarea" }); taEn.value = data.text_en || "";
  const activeSw = switchRow(t("admin.announcement.active"), !!data.active);

  const mk = (label, input) => {
    const f = el("div", { className: "field" });
    f.appendChild(el("label", { className: "field__label", textContent: label }));
    f.appendChild(input);
    return f;
  };

  body.appendChild(mk(t("admin.announcement.title_ar"), taAr));
  body.appendChild(mk(t("admin.announcement.title_en"), taEn));
  body.appendChild(activeSw.wrap);

  const saveBtn = el("button", {
    className: "btn btn--primary",
    type: "button",
    textContent: t("common.save"),
    onClick: async () => {
      try {
        await setDoc(doc(db, "settings", "announcement"), {
          text_ar: taAr.value.trim(),
          text_en: taEn.value.trim(),
          active: !!activeSw.input.checked
        }, { merge: true });
        toastSuccess(t("admin.announcement.saved"));
      } catch (e) { toastError(t("error.unknown")); }
    }
  });
  body.appendChild(saveBtn);

  return () => {};
}

/* ============================================================================
   6) REQUESTS TAB
   ========================================================================== */

async function mountRequestsTab(container) {
  const wrap = el("div", { className: "stack" });

  // Game requests
  const grSlot = el("div");
  grSlot.appendChild(el("h2", { style: { fontSize: "var(--fs-lg)", fontWeight: "700", marginBottom: "8px" }, textContent: t("admin.requests.games") }));
  const grList = el("div", { className: "stack stack--sm" });
  grSlot.appendChild(grList);
  wrap.appendChild(grSlot);

  // Link reports
  const lrSlot = el("div");
  lrSlot.appendChild(el("h2", { style: { fontSize: "var(--fs-lg)", fontWeight: "700", margin: "24px 0 8px" }, textContent: t("admin.requests.links") }));
  const lrList = el("div", { className: "stack stack--sm" });
  lrSlot.appendChild(lrList);
  wrap.appendChild(lrSlot);

  container.appendChild(wrap);

  async function reloadGameRequests() {
    grList.innerHTML = "";
    try {
      const snap = await getDocs(collection(db, "gameRequests"));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      if (!list.length) {
        grList.appendChild(el("div", { className: "text-muted text-sm", textContent: t("admin.requests.none") }));
        return;
      }
      for (const r of list) grList.appendChild(buildGameRequestRow(r, reloadGameRequests));
    } catch (e) { console.error(e); }
  }

  async function reloadLinkReports() {
    lrList.innerHTML = "";
    try {
      const snap = await getDocs(collection(db, "linkReports"));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      if (!list.length) {
        lrList.appendChild(el("div", { className: "text-muted text-sm", textContent: t("admin.requests.none") }));
        return;
      }
      for (const r of list) lrList.appendChild(buildLinkReportRow(r, reloadLinkReports));
    } catch (e) { console.error(e); }
  }

  reloadGameRequests();
  reloadLinkReports();
  return () => {};
}

function buildGameRequestRow(r, onChanged) {
  const row = el("div", { className: "glass glass--pad" });
  const head = el("div", { className: "row row--between" });
  head.appendChild(el("span", { className: "text-sm text-bold", textContent: r.gameName || "—" }));
  const pill = r.status === "done"
    ? el("span", { className: "pill pill--success", textContent: t("admin.requests.status.done") })
    : el("span", { className: "pill pill--warning", textContent: t("admin.requests.status.new") });
  head.appendChild(pill);
  row.appendChild(head);
  row.appendChild(el("div", { className: "text-xs text-muted", textContent: `${r.userName || ""} • ${formatDate(r.createdAt)}` }));
  if (r.note) row.appendChild(el("div", { className: "text-sm", style: { marginTop: "4px", whiteSpace: "pre-line" }, textContent: r.note }));

  const actions = el("div", { className: "row", style: { gap: "6px", marginTop: "8px" } });
  if (r.status !== "done") {
    actions.appendChild(el("button", {
      className: "btn btn--glass btn--sm",
      type: "button",
      textContent: t("admin.requests.markDone"),
      onClick: async () => {
        try { await updateDoc(doc(db, "gameRequests", r.id), { status: "done" }); onChanged(); }
        catch (_) { toastError(t("error.unknown")); }
      }
    }));
  }
  actions.appendChild(el("button", {
    className: "btn btn--ghost btn--sm",
    type: "button",
    textContent: t("common.delete"),
    onClick: async () => {
      const ok = await confirmDialog({ title: t("common.delete"), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      try { await deleteDoc(doc(db, "gameRequests", r.id)); onChanged(); }
      catch (_) { toastError(t("error.unknown")); }
    }
  }));
  row.appendChild(actions);
  return row;
}

function buildLinkReportRow(r, onChanged) {
  const row = el("div", { className: "glass glass--pad" });
  const head = el("div", { className: "row row--between" });
  head.appendChild(el("span", { className: "text-sm text-bold", textContent: r.gameTitle || r.gameId }));
  row.appendChild(head);
  row.appendChild(el("div", { className: "text-xs text-muted", textContent: formatDate(r.createdAt) }));

  const actions = el("div", { className: "row", style: { gap: "6px", marginTop: "8px" } });
  actions.appendChild(el("button", {
    className: "btn btn--glass btn--sm",
    type: "button",
    textContent: t("admin.requests.jumpToGame"),
    onClick: () => { location.hash = `#/game/${encodeURIComponent(r.gameId)}`; }
  }));
  actions.appendChild(el("button", {
    className: "btn btn--ghost btn--sm",
    type: "button",
    textContent: t("common.delete"),
    onClick: async () => {
      const ok = await confirmDialog({ title: t("common.delete"), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      try { await deleteDoc(doc(db, "linkReports", r.id)); onChanged(); }
      catch (_) { toastError(t("error.unknown")); }
    }
  }));
  row.appendChild(actions);
  return row;
}

/* ============================================================================
   Cloudinary unsigned upload (resized client-side)
   ========================================================================== */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Resize an image file to <= maxSide px on the longest side,
 * then upload it unsigned to Cloudinary.
 * @returns {Promise<string|null>} secure_url or null on failure
 */
async function uploadImage(file) {
  if (!file) return null;
  if (!ALLOWED_TYPES.includes(file.type)) {
    toastError(t("error.unknown"));
    return null;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    toastError(t("error.unknown"));
    return null;
  }

  let blob;
  try {
    blob = await resizeImage(file, 1600);
  } catch (e) {
    console.error("resize failed:", e);
    blob = file;
  }

  const fd = new FormData();
  fd.append("file", blob, file.name || "upload.jpg");
  fd.append("upload_preset", CONFIG.cloudinary.uploadPreset);

  try {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CONFIG.cloudinary.cloudName}/image/upload`,
      { method: "POST", body: fd }
    );
    if (!res.ok) throw new Error(`upload ${res.status}`);
    const data = await res.json();
    return data.secure_url || null;
  } catch (e) {
    console.error("cloudinary upload failed:", e);
    return null;
  }
}

/**
 * Resize an image file using a canvas. Returns a Blob.
 */
async function resizeImage(file, maxSide = 1600) {
  const dataUrl = await fileToDataURL(file);
  const img = await dataUrlToImage(dataUrl);
  const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b || file), "image/jpeg", 0.85);
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function dataUrlToImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/* ============================================================================
   Misc
   ========================================================================== */

function autoId() {
  // Same shape as Firestore auto-IDs (20 chars).
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const buf = new Uint32Array(20);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 20; i++) out += chars[buf[i] % chars.length];
  return out;
     }
