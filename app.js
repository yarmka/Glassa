/**
 * ============================================================================
 *  Glassa — Entry point
 * ============================================================================
 *  - Initializes i18n + theme
 *  - Renders the app shell (top bar / main / bottom nav)
 *  - Hash router (#/...)
 *  - Announcement bar + popups on boot
 *  - Reacts to auth changes (nav, cart badge, admin entry)
 *
 *  NOTE: verification is required for all users, including the owner.
 * ============================================================================
 */

import { CONFIG, isOwnerEmailConfigured } from "./config.js";
import {
  initLang,
  getLang,
  toggleLang,
  onLangChange,
  t
} from "./i18n.js";
import {
  el,
  icon,
  toast,
  toastInfo,
  toastError,
  emptyState,
  skeletonLines,
  openModal,
  formatPrice,
  cloudinaryThumb
} from "./ui.js";
import {
  onAuth,
  getUser,
  getProfile,
  isOwner,
  isVerified,
  logout
} from "./auth.js";
import {
  loadGames,
  resetCatalogCache,
  renderHome,
  renderGame,
  renderFavorites,
  openGameRequestModal,
  syncFavoritesFromProfile
} from "./catalog.js";
import {
  loadCartFromStorage,
  cartCount,
  renderCart,
  renderProcessing,
  renderOrders,
  renderPaid,
  checkRejectedOrders
} from "./cart.js";
import { renderAdmin } from "./admin.js";

/* ============================================================================
   Theme handling (auto / light / dark, persisted)
   ========================================================================== */

const THEME_KEY = "glassa.theme";
const THEME_ORDER = ["auto", "light", "dark"];

function getThemeMode() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "auto" || v === "light" || v === "dark") return v;
  } catch (_) {}
  return "auto";
}

function resolveTheme(mode) {
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode) {
  const html = document.documentElement;
  const resolved = resolveTheme(mode);
  html.setAttribute("data-theme-mode", mode);
  html.setAttribute("data-theme", resolved);
  try { localStorage.setItem(THEME_KEY, mode); } catch (_) {}
}

function cycleTheme() {
  const current = getThemeMode();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
  applyTheme(next);
  return next;
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (getThemeMode() === "auto") applyTheme("auto");
});

/* ============================================================================
   Router
   ========================================================================== */

const ROUTES = {
  home:       { pattern: /^\/$/ },
  game:       { pattern: /^\/game\/([^/]+)$/ },
  cart:       { pattern: /^\/cart$/ },
  favorites:  { pattern: /^\/favorites$/ },
  orders:     { pattern: /^\/orders$/ },
  paid:       { pattern: /^\/paid$/ },
  account:    { pattern: /^\/account$/ },
  login:      { pattern: /^\/login$/ },
  signup:     { pattern: /^\/signup$/ },
  verify:     { pattern: /^\/verify$/ },
  admin:      { pattern: /^\/admin$/ },
  processing: { pattern: /^\/processing\/([^/]+)$/ }
};

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [pathPart] = raw.split("?");
  const path = pathPart.startsWith("/") ? pathPart : "/" + pathPart;
  for (const [name, def] of Object.entries(ROUTES)) {
    const m = path.match(def.pattern);
    if (m) return { name, params: m.slice(1), path };
  }
  return { name: "home", params: [], path: "/" };
}

/* ============================================================================
   Shell
   ========================================================================== */

let viewCleanup = [];
const app = document.getElementById("app");

function cleanupView() {
  for (const fn of viewCleanup) {
    try { fn(); } catch (e) { console.error(e); }
  }
  viewCleanup = [];
}

function renderShell() {
  if (!app) return null;
  app.innerHTML = "";
  const shell = el("div", { className: "app-shell" });

  const topbar = el("header", { className: "topbar" });
  topbar.appendChild(el("a", {
    className: "topbar__brand",
    href: "#/",
    textContent: t("app.name")
  }));

  const topnav = el("nav", { className: "topnav" });
  for (const link of buildNavLinks()) topnav.appendChild(link);
  topbar.appendChild(topnav);

  const actions = el("div", { className: "topbar__actions" });
  actions.appendChild(buildLangButton());
  actions.appendChild(buildThemeButton());
  topbar.appendChild(actions);
  shell.appendChild(topbar);

  const main = el("main", { className: "main", id: "main-region", role: "main" });
  shell.appendChild(main);
  shell.appendChild(buildBottomNav());
  app.appendChild(shell);
  return main;
}

function buildNavLinks() {
  const links = [
    { href: "#/", label: t("nav.home") },
    { href: "#/favorites", label: t("nav.favorites") },
    { href: "#/cart", label: t("nav.cart") },
    { href: "#/orders", label: t("nav.orders") },
    { href: "#/paid", label: t("nav.paid") }
  ];
  const user = getUser();
  links.push(user
    ? { href: "#/account", label: t("nav.account") }
    : { href: "#/login", label: t("nav.login") });
  if (isOwner()) links.push({ href: "#/admin", label: t("nav.admin") });

  const route = parseHash();
  const currentPath = route.path;
  return links.map((l) => el("a", {
    href: l.href,
    className: `topnav__link${l.href === "#" + currentPath || (currentPath === "/" && l.href === "#/") ? " is-active" : ""}`,
    textContent: l.label
  }));
}

function buildLangButton() {
  return el("button", {
    className: "btn btn--ghost btn--icon",
    type: "button",
    "aria-label": t("account.language"),
    onClick: () => { toggleLang(); renderShell(); navigate(); }
  }, icon("globe", 20));
}

function buildThemeButton() {
  const mode = getThemeMode();
  const iconName = mode === "auto" ? "auto" : mode === "light" ? "sun" : "moon";
  return el("button", {
    className: "btn btn--ghost btn--icon",
    type: "button",
    "aria-label": t("account.theme"),
    onClick: () => { cycleTheme(); renderShell(); }
  }, icon(iconName, 20));
}

function buildBottomNav() {
  const nav = el("nav", { className: "bottomnav" });
  const items = [
    { href: "#/", icon: "home", label: t("nav.home") },
    { href: "#/favorites", icon: "heart", label: t("nav.favorites") },
    { href: "#/cart", icon: "cart", label: t("nav.cart"), badge: cartCount() },
    { href: "#/account", icon: "user", label: t("nav.account") }
  ];
  const route = parseHash();
  const currentPath = route.path;
  for (const it of items) {
    const link = el("a", {
      href: it.href,
      className: `bottomnav__link${it.href === "#" + currentPath || (currentPath === "/" && it.href === "#/") ? " is-active" : ""}`
    });
    link.appendChild(icon(it.icon, 22, "bottomnav__icon"));
    link.appendChild(el("span", { textContent: it.label }));
    if (it.badge && it.badge > 0) {
      link.appendChild(el("span", { className: "bottomnav__badge", textContent: String(it.badge) }));
    }
    nav.appendChild(link);
  }
  return nav;
}

/* ============================================================================
   Announcement bar
   ========================================================================== */

async function mountAnnouncement(main) {
  try {
    const { db, doc, getDoc } = await import("./firebase.js");
    const snap = await getDoc(doc(db, "settings", "announcement"));
    if (!snap.exists()) return;
    const data = snap.data() || {};
    if (!data.active) return;
    const text = getLang() === "ar" ? (data.text_ar || data.text_en) : (data.text_en || data.text_ar);
    if (!text) return;
    if (sessionStorage.getItem("glassa.announceDismissed") === "1") return;

    const bar = el("div", { className: "announce", role: "status" });
    bar.appendChild(el("div", { className: "announce__body", textContent: text }));
    const close = el("button", {
      type: "button",
      className: "announce__close",
      "aria-label": t("announce.dismiss"),
      onClick: () => {
        try { sessionStorage.setItem("glassa.announceDismissed", "1"); } catch (_) {}
        bar.remove();
      }
    }, icon("x", 18));
    bar.appendChild(close);
    main.insertBefore(bar, main.firstChild);
  } catch (e) {
    console.error("announcement load failed:", e);
  }
}

/* ============================================================================
   Popups
   ========================================================================== */

async function mountPopups() {
  try {
    const { db, collection, getDocs } = await import("./firebase.js");
    const snap = await getDocs(collection(db, "popups"));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.active === true)
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    const localDismissed = readDismissedPopups();
    const profile = getProfile();
    const userDismissed = Array.isArray(profile?.dismissedPopups) ? profile.dismissedPopups : [];
    const dismissedSet = new Set([...localDismissed, ...userDismissed]);
    const queue = list.filter((p) => !dismissedSet.has(p.id));
    if (!queue.length) return;
    showNextPopup(queue);
  } catch (e) {
    console.error("popups load failed:", e);
  }
}

function showNextPopup(queue) {
  if (!queue.length) return;
  const p = queue.shift();
  const lang = getLang();
  const title = lang === "ar" ? (p.title_ar || p.title_en) : (p.title_en || p.title_ar);
  const body = lang === "ar" ? (p.body_ar || p.body_en) : (p.body_en || p.body_ar);

  const wrap = el("div", { className: "stack" });
  if (p.imageUrl) {
    const img = el("img", {
      src: p.imageUrl,
      alt: "",
      loading: "lazy",
      style: { borderRadius: "16px", maxHeight: "240px", objectFit: "cover", width: "100%" }
    });
    img.addEventListener("error", () => img.remove());
    wrap.appendChild(img);
  }
  if (body) wrap.appendChild(el("p", { style: { whiteSpace: "pre-line" }, textContent: body }));

  openModal({
    title: title || t("app.name"),
    body: wrap,
    onClose: async () => {
      await dismissPopup(p.id);
      showNextPopup(queue);
    },
    actions: [{ label: t("common.close"), variant: "primary" }]
  });
}

async function dismissPopup(id) {
  const local = readDismissedPopups();
  if (!local.includes(id)) {
    local.push(id);
    try { localStorage.setItem("glassa.dismissedPopups", JSON.stringify(local.slice(-50))); } catch (_) {}
  }
  const user = getUser();
  if (user) {
    try {
      const { db, doc, getDoc, setDoc } = await import("./firebase.js");
      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref);
      const existing = Array.isArray(snap.data()?.dismissedPopups) ? snap.data().dismissedPopups : [];
      if (!existing.includes(id)) {
        await setDoc(ref, { dismissedPopups: [...existing, id].slice(-100) }, { merge: true });
      }
    } catch (e) {
      console.error("dismiss popup failed:", e);
    }
  }
}

function readDismissedPopups() {
  try {
    const raw = localStorage.getItem("glassa.dismissedPopups");
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch (_) {
    return [];
  }
}

/* ============================================================================
   Views
   ========================================================================== */

async function renderViewFor(route, main) {
  main.innerHTML = "";
  if (route.name === "home") await mountAnnouncement(main);

  switch (route.name) {
    case "home": {
      const cleanup = await renderHome(main);
      if (typeof cleanup === "function") viewCleanup.push(cleanup);
      break;
    }
    case "game": {
      const cleanup = await renderGame(main, decodeURIComponent(route.params[0] || ""));
      if (typeof cleanup === "function") viewCleanup.push(cleanup);
      break;
    }
    case "cart":
      await renderCart(main);
      break;
    case "favorites":
      await renderFavorites(main);
      break;
    case "orders": {
      const cleanup = renderOrders(main);
      if (typeof cleanup === "function") viewCleanup.push(cleanup);
      break;
    }
    case "paid": {
      const cleanup = renderPaid(main);
      if (typeof cleanup === "function") viewCleanup.push(cleanup);
      break;
    }
    case "processing": {
      const cleanup = renderProcessing(main, decodeURIComponent(route.params[0] || ""));
      if (typeof cleanup === "function") viewCleanup.push(cleanup);
      break;
    }
    case "account":
      await renderAccount(main);
      break;
    case "login":
      await renderLogin(main);
      break;
    case "signup":
      await renderSignup(main);
      break;
    case "verify":
      await renderVerify(main);
      break;
    case "admin": {
      const cleanup = await renderAdmin(main);
      if (typeof cleanup === "function") viewCleanup.push(cleanup);
      break;
    }
    default:
      main.appendChild(emptyState({ iconName: "info", title: t("error.unknown") }));
  }
}

async function navigate() {
  cleanupView();
  const route = parseHash();
  const main = renderShell();
  if (!main) return;
  await renderViewFor(route, main);
  window.scrollTo({ top: 0, behavior: "auto" });
}

/* ============================================================================
   Login
   ========================================================================== */

async function renderLogin(main) {
  const auth = await import("./auth.js");
  const { login, sendPasswordReset, authErrorMessage } = auth;

  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("auth.login.title") }));
  main.appendChild(header);

  const card = el("div", { className: "glass glass--pad-lg stack" });

  const emailField = el("div", { className: "field" });
  emailField.appendChild(el("label", { className: "field__label", textContent: t("auth.email") }));
  const emailIn = el("input", { className: "input", type: "email", autocomplete: "email", inputMode: "email" });
  emailField.appendChild(emailIn);
  card.appendChild(emailField);

  const pwField = el("div", { className: "field" });
  pwField.appendChild(el("label", { className: "field__label", textContent: t("auth.password") }));
  const pwIn = el("input", { className: "input", type: "password", autocomplete: "current-password" });
  pwField.appendChild(pwIn);
  card.appendChild(pwField);

  const loginBtn = el("button", {
    className: "btn btn--primary btn--block",
    type: "button",
    textContent: t("auth.login.btn"),
    onClick: async () => {
      loginBtn.disabled = true;
      try {
        const res = await login({ email: emailIn.value, password: pwIn.value });
        if (!res.ok) {
          toastError(authErrorMessage(res.code));
          return;
        }
        if (!auth.isVerified()) {
          await sendVerificationAndRoute();
        } else {
          location.hash = "#/";
        }
      } finally {
        loginBtn.disabled = false;
      }
    }
  });
  card.appendChild(loginBtn);

  card.appendChild(el("button", {
    className: "btn btn--ghost btn--block",
    type: "button",
    textContent: t("auth.forgotPassword"),
    onClick: async () => {
      if (!emailIn.value) {
        toastInfo(t("auth.errors.invalidEmail"));
        return;
      }
      const res = await sendPasswordReset(emailIn.value);
      if (res.ok) toastInfo(t("auth.resetSent"));
      else toastError(authErrorMessage(res.code));
    }
  }));

  main.appendChild(card);
  main.appendChild(el("div", { className: "text-center text-sm text-muted", style: { marginTop: "16px" } },
    t("auth.noAccount") + " ",
    el("a", { href: "#/signup", className: "text-brand text-bold", textContent: t("nav.signup") })
  ));
}

/* ============================================================================
   Signup (all users verify)
   ========================================================================== */

async function renderSignup(main) {
  const auth = await import("./auth.js");
  const { signup, authErrorMessage } = auth;

  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("auth.signup.title") }));
  main.appendChild(header);

  const card = el("div", { className: "glass glass--pad-lg stack" });

  const nameField = el("div", { className: "field" });
  nameField.appendChild(el("label", { className: "field__label", textContent: t("auth.name") }));
  const nameIn = el("input", { className: "input", autocomplete: "name", maxLength: 40 });
  nameField.appendChild(nameIn);
  card.appendChild(nameField);

  const emailField = el("div", { className: "field" });
  emailField.appendChild(el("label", { className: "field__label", textContent: t("auth.email") }));
  const emailIn = el("input", { className: "input", type: "email", autocomplete: "email", inputMode: "email" });
  emailField.appendChild(emailIn);
  card.appendChild(emailField);

  const pwField = el("div", { className: "field" });
  pwField.appendChild(el("label", { className: "field__label", textContent: t("auth.password") }));
  const pwIn = el("input", { className: "input", type: "password", autocomplete: "new-password" });
  pwField.appendChild(pwIn);
  card.appendChild(pwField);

  const pw2Field = el("div", { className: "field" });
  pw2Field.appendChild(el("label", { className: "field__label", textContent: t("auth.confirmPassword") }));
  const pw2In = el("input", { className: "input", type: "password", autocomplete: "new-password" });
  pw2Field.appendChild(pw2In);
  card.appendChild(pw2Field);

  const btn = el("button", {
    className: "btn btn--primary btn--block",
    type: "button",
    textContent: t("auth.signup.btn"),
    onClick: async () => {
      if (pwIn.value !== pw2In.value) {
        toastError(t("auth.errors.passwordMismatch"));
        return;
      }
      btn.disabled = true;
      try {
        const res = await signup({ name: nameIn.value, email: emailIn.value, password: pwIn.value });
        if (!res.ok) {
          toastError(authErrorMessage(res.code));
          return;
        }
        await sendVerificationAndRoute();
      } finally {
        btn.disabled = false;
      }
    }
  });
  card.appendChild(btn);
  main.appendChild(card);

  main.appendChild(el("div", { className: "text-center text-sm text-muted", style: { marginTop: "16px" } },
    t("auth.haveAccount") + " ",
    el("a", { href: "#/login", className: "text-brand text-bold", textContent: t("nav.login") })
  ));
}

async function sendVerificationAndRoute() {
  const auth = await import("./auth.js");
  const user = auth.getUser();
  if (!user || !user.email) {
    location.hash = "#/verify";
    return;
  }
  const res = await auth.sendVerificationCode({ email: user.email });
  if (!res.ok && res.code !== "cooldown") {
    console.error("sendVerificationCode failed:", res);
    toastError(t("verify.sendError"));
  }
  location.hash = "#/verify";
}

/* ============================================================================
   Verify screen
   ========================================================================== */

async function renderVerify(main) {
  const auth = await import("./auth.js");
  const { verifyCode, sendVerificationCode, getResendCooldownMs, getCodeTimeLeftMs, getUser, isVerified } = auth;

  const user = getUser();
  if (!user) { location.hash = "#/login"; return; }
  if (isVerified()) { location.hash = "#/"; return; }

  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("verify.title") }));
  header.appendChild(el("div", { className: "page-header__subtitle", textContent: t("verify.subtitle") }));
  main.appendChild(header);

  const card = el("div", { className: "glass glass--pad-lg stack" });

  const otp = el("div", { className: "otp" });
  const boxes = [];
  for (let i = 0; i < 6; i++) {
    const b = el("input", {
      className: "otp__box",
      type: "text",
      inputMode: "numeric",
      maxLength: 1,
      autocomplete: i === 0 ? "one-time-code" : "off",
      "aria-label": `${t("verify.codeLabel")} ${i + 1}`
    });
    b.addEventListener("input", (e) => {
      const v = e.target.value.replace(/\D/g, "");
      e.target.value = v.slice(-1);
      if (v && i < 5) boxes[i + 1].focus();
      checkComplete();
    });
    b.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !e.target.value && i > 0) {
        boxes[i - 1].focus();
      }
      if (e.key === "Enter") checkComplete();
    });
    b.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text") || "";
      const digits = text.replace(/\D/g, "").slice(0, 6);
      for (let j = 0; j < 6; j++) {
        boxes[j].value = digits[j] || "";
      }
      const next = Math.min(digits.length, 5);
      boxes[next].focus();
      checkComplete();
    });
    boxes.push(b);
    otp.appendChild(b);
  }
  card.appendChild(otp);

  const status = el("div", { className: "text-sm", style: { minHeight: "1.4em" } });
  card.appendChild(status);

  const hint = el("div", { className: "text-xs text-muted", textContent: t("verify.checkSpam") });
  card.appendChild(hint);

  const resendRow = el("div", { className: "row row--between" });
  const countdown = el("div", { className: "text-xs text-muted" });
  const resend = el("button", {
    className: "btn btn--ghost btn--sm",
    type: "button",
    textContent: t("verify.resend")
  });
  resendRow.appendChild(countdown);
  resendRow.appendChild(resend);
  card.appendChild(resendRow);

  main.appendChild(card);

  function tickCountdowns() {
    const codeLeft = getCodeTimeLeftMs();
    const cooldown = getResendCooldownMs();

    if (cooldown > 0) {
      resend.disabled = true;
      resend.textContent = t("verify.resendIn", { n: Math.ceil(cooldown / 1000) });
    } else {
      resend.disabled = false;
      resend.textContent = t("verify.resend");
    }

    if (codeLeft > 0) {
      const m = Math.floor(codeLeft / 60000);
      const s = Math.floor((codeLeft % 60000) / 1000);
      countdown.textContent = `${t("verify.timeLeft")}: ${m}:${String(s).padStart(2, "0")}`;
    } else {
      countdown.textContent = "";
    }
  }
  tickCountdowns();
  const tickId = setInterval(tickCountdowns, 1000);
  viewCleanup.push(() => clearInterval(tickId));

  resend.addEventListener("click", async () => {
    resend.disabled = true;
    status.textContent = t("verify.sending");
    const res = await sendVerificationCode({ email: user.email });
    if (res.ok) {
      status.textContent = "";
      toastInfo(t("verify.success"));
      boxes.forEach((b) => (b.value = ""));
      boxes[0].focus();
    } else if (res.code === "cooldown") {
      toastInfo(t("auth.errors.tooMany"));
    } else {
      status.textContent = "";
      toastError(t("verify.sendError"));
    }
    tickCountdowns();
  });

  async function checkComplete() {
    const code = boxes.map((b) => b.value).join("");
    if (code.length !== 6) return;
    status.textContent = "";
    const res = await verifyCode({ code });
    if (res.ok) {
      toastInfo(t("verify.success"));
      location.hash = "#/";
      return;
    }
    if (res.code === "expired") status.textContent = t("verify.expired");
    else if (res.code === "tooMany") status.textContent = t("verify.tooManyAttempts");
    else status.textContent = t("verify.wrongCode");
    status.className = "text-sm text-danger";
    boxes.forEach((b) => (b.value = ""));
    boxes[0].focus();
  }

  if (getCodeTimeLeftMs() === 0) {
    resend.click();
  }
}

/* ============================================================================
   Account page
   ========================================================================== */

async function renderAccount(main) {
  const user = getUser();
  if (!user) { location.hash = "#/login"; return; }

  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("account.title") }));
  main.appendChild(header);

  const profile = getProfile() || {};
  const card = el("div", { className: "glass glass--pad-lg stack" });

  card.appendChild(el("div", { className: "text-lg text-bold", textContent: profile.name || user.displayName || "" }));
  card.appendChild(el("div", { className: "text-sm text-muted", textContent: user.email || "" }));

  if (!isVerified() && !isOwner()) {
    card.appendChild(el("div", { className: "pill pill--warning", textContent: t("account.verificationPending") }));
    card.appendChild(el("button", {
      className: "btn btn--primary",
      type: "button",
      textContent: t("account.verifyNow"),
      onClick: () => { location.hash = "#/verify"; }
    }));
  }

  card.appendChild(el("hr", { className: "divider" }));

  const langRow = el("div", { className: "row row--between" });
  langRow.appendChild(el("span", { textContent: t("account.language") }));
  const langBtn = el("button", {
    className: "btn btn--glass btn--sm",
    type: "button",
    textContent: getLang() === "ar" ? t("account.english") : t("account.arabic"),
    onClick: () => { toggleLang(); renderShell(); navigate(); }
  });
  langRow.appendChild(langBtn);
  card.appendChild(langRow);

  const themeRow = el("div", { className: "row row--between" });
  themeRow.appendChild(el("span", { textContent: t("account.theme") }));
  const mode = getThemeMode();
  const themeLabel = mode === "auto" ? t("account.themeAuto")
    : mode === "light" ? t("account.themeLight")
    : t("account.themeDark");
  themeRow.appendChild(el("button", {
    className: "btn btn--glass btn--sm",
    type: "button",
    textContent: themeLabel,
    onClick: () => { cycleTheme(); renderShell(); navigate(); }
  }));
  card.appendChild(themeRow);

  card.appendChild(el("hr", { className: "divider" }));

  card.appendChild(el("button", {
    className: "btn btn--glass btn--block",
    type: "button",
    textContent: t("account.requestGame"),
    onClick: () => openGameRequestModal()
  }));

  if (isOwner()) {
    card.appendChild(el("button", {
      className: "btn btn--glass btn--block",
      type: "button",
      textContent: t("nav.admin"),
      onClick: () => { location.hash = "#/admin"; }
    }));
  }

  const logoutBtn = el("button", {
    className: "btn btn--danger btn--block",
    type: "button",
    textContent: t("account.logout"),
    onClick: async () => {
      const ok = await (await import("./ui.js")).confirmDialog({
        title: t("account.logout"),
        message: t("account.logoutConfirm"),
        confirmLabel: t("nav.logout"),
        danger: true
      });
      if (!ok) return;
      logoutBtn.disabled = true;
      await logout();
      resetCatalogCache();
      location.hash = "#/";
    }
  });
  card.appendChild(logoutBtn);

  main.appendChild(card);
}

/* ============================================================================
   Auth-aware re-render + boot
   ========================================================================== */

let previousUid = null;

onAuth(async ({ user, profile }) => {
  const uid = user?.uid || null;
  if (uid !== previousUid) {
    previousUid = uid;
    syncFavoritesFromProfile();
    renderShell();
    navigate();
    if (user) {
      setTimeout(() => { mountPopups(); }, 600);
      setTimeout(() => { checkRejectedOrders(); }, 900);
    }
  }
});

onLangChange(() => {
  renderShell();
  navigate();
});

window.addEventListener("hashchange", () => {
  navigate();
});

(function boot() {
  initLang();
  applyTheme(getThemeMode());
  loadCartFromStorage();

  if (!isOwnerEmailConfigured()) {
    console.warn("[Glassa] OWNER_EMAIL_HERE has not been replaced in config.js");
  }

  renderShell();
  const main = document.getElementById("main-region");
  if (main) {
    main.innerHTML = "";
    main.appendChild(skeletonLines(4));
  }
})();
