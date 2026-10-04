/**
 * ============================================================================
 *  Glassa — UI primitives
 * ============================================================================
 *  Small, dependency-free helpers used across the app:
 *   - DOM helpers and escapeHtml
 *   - Toast notifications
 *   - Modal (glass), Confirm dialog
 *   - Skeletons and empty states
 *   - Inline SVG icon set
 *   - Formatters (price, date, countdown) and debounce
 * ============================================================================
 */

import { t, formatPrice as i18nFormatPrice } from "./i18n.js";

/* ============================================================================
   DOM helpers
   ========================================================================== */

/** Shorthand for document.querySelector. */
export const $  = (sel, root = document) => root.querySelector(sel);

/** Shorthand for document.querySelectorAll (returns Array). */
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Create an element with attributes and children.
 * `attrs` supports: className, textContent, dataset, style, on* events.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;

    if (key === "className") {
      node.className = value;
    } else if (key === "textContent") {
      node.textContent = value;
    } else if (key === "html") {
      // Caller must have escaped any dynamic content.
      node.innerHTML = value;
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(node.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "disabled" || key === "checked" || key === "selected") {
      node[key] = Boolean(value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    if (typeof child === "string" || typeof child === "number") {
      node.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      node.appendChild(child);
    }
  }

  return node;
}

/** Remove all children of a node. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace children of a node with the given list of nodes/strings. */
export function replace(node, ...children) {
  clear(node);
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    if (c instanceof Node) node.appendChild(c);
    else node.appendChild(document.createTextNode(String(c)));
  }
  return node;
}

/**
 * Escape any string that will be inserted via innerHTML.
 * Prefer textContent whenever possible.
 */
export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Toggle a CSS class conditionally. */
export function toggleClass(node, className, on) {
  if (!node) return;
  node.classList.toggle(className, Boolean(on));
}

/* ============================================================================
   Debounce / throttle
   ========================================================================== */

export function debounce(fn, wait = 200) {
  let timer = null;
  return function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  };
}

export function throttle(fn, wait = 200) {
  let last = 0;
  let timer = null;
  return function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn.apply(this, args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

/* ============================================================================
   Toast
   ========================================================================== */

const TOAST_DURATION = 3200;

/**
 * Show a toast notification.
 * @param {string} message
 * @param {"info"|"success"|"error"} type
 */
export function toast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const node = el("div", { className: `toast toast--${type}` });
  node.appendChild(icon(type === "success" ? "check" : type === "error" ? "x" : "info", 18));
  node.appendChild(el("span", { textContent: message }));
  container.appendChild(node);

  const remove = () => {
    node.classList.add("toast--out");
    setTimeout(() => node.remove(), 220);
  };

  const timer = setTimeout(remove, TOAST_DURATION);
  node.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
}

export const toastSuccess = (m) => toast(m, "success");
export const toastError   = (m) => toast(m, "error");
export const toastInfo    = (m) => toast(m, "info");

/* ============================================================================
   Modal
   ========================================================================== */

let activeModal = null;
let lastFocused = null;

/**
 * Open a modal.
 * @param {object} opts
 * @param {string} opts.title
 * @param {Node|string} opts.body
 * @param {Array<{label:string, variant?:string, onClick?:Function, closeAfter?:boolean}>} [opts.actions]
 * @param {boolean} [opts.dismissible=true]  — close on backdrop/Escape
 * @param {Function} [opts.onClose]
 * @returns {{close:Function, node:HTMLElement}}
 */
export function openModal(opts) {
  const root = document.getElementById("modal-root");
  if (!root) return { close() {}, node: null };

  // If a modal is already open, close it first.
  if (activeModal) activeModal.close();

  lastFocused = document.activeElement;
  document.body.classList.add("no-scroll");

  const backdrop = el("div", { className: "modal__backdrop" });
  const dialog = el("div", { className: "modal", role: "dialog", "aria-modal": "true" });

  const header = el("div", { className: "modal__header" });
  header.appendChild(el("h2", { className: "modal__title", textContent: opts.title || "" }));

  const closeBtn = el("button", {
    className: "modal__close",
    type: "button",
    "aria-label": t("common.close"),
    onClick: () => close()
  }, icon("x", 20));
  header.appendChild(closeBtn);

  const body = el("div", { className: "modal__body" });
  if (typeof opts.body === "string") body.textContent = opts.body;
  else if (opts.body instanceof Node) body.appendChild(opts.body);

  dialog.appendChild(header);
  dialog.appendChild(body);

  if (Array.isArray(opts.actions) && opts.actions.length) {
    const footer = el("div", { className: "modal__footer" });
    for (const action of opts.actions) {
      const btn = el("button", {
        type: "button",
        className: `btn ${action.variant ? `btn--${action.variant}` : "btn--glass"}`,
        textContent: action.label || "",
        onClick: async () => {
          try {
            if (typeof action.onClick === "function") {
              const result = await action.onClick();
              if (result === false) return; // caller asked to keep open
            }
          } catch (e) {
            console.error(e);
          }
          if (action.closeAfter !== false) close();
        }
      });
      footer.appendChild(btn);
    }
    dialog.appendChild(footer);
  }

  root.appendChild(backdrop);
  root.appendChild(dialog);
  root.classList.add("is-open");

  const onKey = (e) => {
    if (e.key === "Escape" && opts.dismissible !== false) close();
    if (e.key === "Tab") trapFocus(e, dialog);
  };

  function close() {
    if (!root.classList.contains("is-open")) return;
    document.removeEventListener("keydown", onKey);
    root.classList.remove("is-open");
    document.body.classList.remove("no-scroll");
    backdrop.remove();
    dialog.remove();
    activeModal = null;
    if (typeof opts.onClose === "function") {
      try { opts.onClose(); } catch (e) { console.error(e); }
    }
    if (lastFocused && typeof lastFocused.focus === "function") {
      try { lastFocused.focus(); } catch (_) {}
    }
  }

  if (opts.dismissible !== false) backdrop.addEventListener("click", close);
  document.addEventListener("keydown", onKey);

  // Focus first focusable inside dialog.
  requestAnimationFrame(() => {
    const focusable = dialog.querySelector(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );
    if (focusable) focusable.focus();
  });

  activeModal = { close, node: dialog };
  return activeModal;
}

function trapFocus(e, container) {
  const focusables = container.querySelectorAll(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Confirm dialog. Returns a Promise<boolean>.
 */
export function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = false } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    openModal({
      title: title || t("common.confirm"),
      body: message || "",
      dismissible: true,
      actions: [
        {
          label: cancelLabel || t("common.cancel"),
          variant: "ghost",
          onClick: () => { decided = true; resolve(false); }
        },
        {
          label: confirmLabel || t("common.confirm"),
          variant: danger ? "danger" : "primary",
          onClick: () => { decided = true; resolve(true); }
        }
      ],
      onClose: () => { if (!decided) resolve(false); }
    });
  });
}

/* ============================================================================
   Skeletons + empty states
   ========================================================================== */

/** Game-card skeleton grid. */
export function skeletonGrid(count = 8) {
  const wrap = el("div", { className: "grid-games" });
  for (let i = 0; i < count; i++) {
    const card = el("div", { className: "skel-card" });
    card.appendChild(el("div", { className: "skel skel-card__cover" }));
    const body = el("div", { className: "skel-card__body" });
    body.appendChild(el("div", { className: "skel skel-card__line" }));
    body.appendChild(el("div", { className: "skel skel-card__line skel-card__line--sm" }));
    card.appendChild(body);
    wrap.appendChild(card);
  }
  return wrap;
}

/** Generic centered loading spinner. */
export function skeletonLines(count = 3) {
  const wrap = el("div", { className: "stack" });
  for (let i = 0; i < count; i++) {
    wrap.appendChild(el("div", { className: "skel", style: { height: "14px", borderRadius: "8px" } }));
  }
  return wrap;
}

/** Friendly empty state. */
export function emptyState({ iconName = "info", title, subtitle, action } = {}) {
  const wrap = el("div", { className: "empty" });
  wrap.appendChild(el("div", { className: "empty__icon" }, icon(iconName, 72)));
  wrap.appendChild(el("div", { className: "empty__title", textContent: title || "" }));
  if (subtitle) wrap.appendChild(el("div", { className: "empty__subtitle", textContent: subtitle }));
  if (action && action.label && typeof action.onClick === "function") {
    wrap.appendChild(el("button", {
      className: "btn btn--primary",
      type: "button",
      textContent: action.label,
      onClick: action.onClick
    }));
  }
  return wrap;
}

/* ============================================================================
   Formatters
   ========================================================================== */

/** Price with SAR suffix, Latin digits. */
export function formatPrice(amount) {
  return i18nFormatPrice(amount);
}

/** Format a Firestore Timestamp or Date into a short local string. */
export function formatDate(ts) {
  const date = toDate(ts);
  if (!date) return "";
  try {
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (_) {
    return date.toString();
  }
}

/** Format a Firestore Timestamp or Date into a short local time (e.g. 7:55 PM). */
export function formatTime(ts) {
  const date = toDate(ts);
  if (!date) return "";
  try {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return date.toString();
  }
}

/** Normalize Firestore Timestamp | Date | number → Date. */
export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    try { return value.toDate(); } catch (_) { return null; }
  }
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Live countdown formatter. Returns a string like "1d 03:24:11".
 * If the target has passed, returns "".
 */
export function formatCountdown(targetTs) {
  const target = toDate(targetTs);
  if (!target) return "";
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return "";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const hms = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  return days > 0 ? `${days}d ${hms}` : hms;
}

/** "12.5 MB" / "4.2 GB" friendly file size from a byte count. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

/* ============================================================================
   Random
   ========================================================================== */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1

/** Cryptographically-strong random integer in [0, max). */
export function secureRandomInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

/** Random 6-digit numeric string (verification codes). */
export function randomDigits(len = 6) {
  let out = "";
  for (let i = 0; i < len; i++) out += String(secureRandomInt(10));
  return out;
}

/**
 * Long one-time unlock code in the form XXXX-XXXX-XXXX-XXXX.
 * Uses an alphabet without visually ambiguous characters.
 */
export function generateUnlockCode() {
  const group = () => {
    let s = "";
    for (let i = 0; i < 4; i++) s += CODE_ALPHABET[secureRandomInt(CODE_ALPHABET.length)];
    return s;
  };
  return `${group()}-${group()}-${group()}-${group()}`;
}

/** Normalize a user-typed code to the canonical XXXX-XXXX-XXXX-XXXX form. */
export function normalizeUnlockCode(input) {
  const raw = String(input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const chunks = [];
  for (let i = 0; i < raw.length && chunks.length < 4; i += 4) {
    chunks.push(raw.slice(i, i + 4));
  }
  return chunks.join("-");
}

/* ============================================================================
   Icons (inline SVG, currentColor)
   ========================================================================== */

const ICONS = {
  home: "M3 10.5 12 3l9 7.5M5 10v10h5v-6h4v6h5V10",
  heart: "M12 21s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z",
  cart: "M3 4h2l2.4 12.2A2 2 0 0 0 9.4 18H19a2 2 0 0 0 2-1.7L22 8H6M9 21a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm10 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  x: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  star: "m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z",
  share: "M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  copy: "M9 9h10v10H9zM5 15V5h10",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  auto: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
  chevronLeft: "m15 18-6-6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  chevronDown: "m6 9 6 6 6-6",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.7.7 2.5a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.8.4 1.6.6 2.5.7a2 2 0 0 1 1.7 2z",
  external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  eye: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M17.9 17.4A10.7 10.7 0 0 1 12 19c-7 0-11-7-11-7a17 17 0 0 1 5-5.9M1 1l22 22M9.9 4.2A10.5 10.5 0 0 1 12 4c7 0 11 7 11 7a17 17 0 0 1-3 3.8",
  gamepad: "M6 12h4M8 10v4M15 12h.01M18 10h.01M17.3 5H6.7a5 5 0 0 0-4.9 4L1 15a3 3 0 0 0 5.4 2.1L8 15h8l1.6 2.1A3 3 0 0 0 23 15l-.8-6a5 5 0 0 0-4.9-4z"
};

/**
 * Return an SVG node for the given icon name.
 * @param {string} name
 * @param {number} [size=24]
 * @param {string} [className]
 */
export function icon(name, size = 24, className = "") {
  const path = ICONS[name] || ICONS.info;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  if (className) svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");

  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  if (name === "star") {
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("stroke", "none");
  }
  svg.appendChild(p);
  return svg;
}

/* ============================================================================
   Misc helpers
   ========================================================================== */

/** Copy text to clipboard, with fallback. Returns Promise<boolean>. */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

/** Add a Cloudinary transformation segment after /upload/. */
export function cloudinaryThumb(url, width = 600) {
  return cloudinaryTransform(url, `f_auto,q_auto,w_${width}`);
}
export function cloudinaryHero(url, width = 1200) {
  return cloudinaryTransform(url, `f_auto,q_auto,w_${width}`);
}

function cloudinaryTransform(url, transform) {
  if (!url || typeof url !== "string") return url;
  if (!url.includes("res.cloudinary.com")) return url;
  if (!url.includes("/upload/")) return url;
  if (/\/upload\/[^/]*[a-z]_[^/]*\//.test(url)) return url; // already transformed
  return url.replace("/upload/", `/upload/${transform}/`);
}

/** Detect a game's "new" badge (14 days). */
export function isNewGame(createdAt) {
  const d = toDate(createdAt);
  if (!d) return false;
  return Date.now() - d.getTime() < 14 * 24 * 60 * 60 * 1000;
}

/** Normalize Arabic text for search (strip diacritics, unify alef/ya). */
export function normalizeForSearch(input) {
  if (!input) return "";
  return String(input)
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // diacritics + tatweel
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
            }
