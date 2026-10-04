/**
 * ============================================================================
 *  Glassa — Authentication
 * ============================================================================
 *  - Sign up (email + password + name)
 *  - 6-digit email verification via EmailJS (no Firebase email link)
 *  - Owner email is verified like any other account (no bypass)
 *  - Owner's display name is kept in sync with CONFIG.ownerName
 *  - Login, logout, password reset
 * ============================================================================
 */

import {
  auth,
  db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "./firebase.js";
import { CONFIG, isOwnerEmail } from "./config.js";
import {
  toastSuccess,
  toastError,
  formatTime,
  randomDigits
} from "./ui.js";
import { t } from "./i18n.js";

/* ============================================================================
   State
   ========================================================================== */

let currentUser = null;
let currentProfile = null;

const listeners = new Set();

export function getUser() { return currentUser; }
export function getProfile() { return currentProfile; }

export function isOwner() {
  return isOwnerEmail(currentUser?.email);
}

export function onAuth(fn) {
  listeners.add(fn);
  fn({ user: currentUser, profile: currentProfile, isOwner: isOwner() });
  return () => listeners.delete(fn);
}

function emit() {
  const payload = { user: currentUser, profile: currentProfile, isOwner: isOwner() };
  for (const fn of listeners) {
    try { fn(payload); } catch (e) { console.error("onAuth listener error:", e); }
  }
}

/* ============================================================================
   Profile document
   ========================================================================== */

async function loadProfile(uid) {
  try {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data();
  } catch (e) {
    console.error("loadProfile failed:", e);
    return null;
  }
}

/* ============================================================================
   Auth state observer
   ========================================================================== */

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentProfile = user ? await loadProfile(user.uid) : null;

  if (user && isOwnerEmail(user.email) && currentProfile) {
    if (currentProfile.name !== CONFIG.ownerName) {
      try {
        await updateDoc(doc(db, "users", user.uid), { name: CONFIG.ownerName });
        currentProfile.name = CONFIG.ownerName;
      } catch (e) {
        console.error("Failed to sync owner name:", e);
      }
    }
  }

  emit();
});

/* ============================================================================
   Sign up / Sign in / Sign out
   ========================================================================== */

export async function signup({ name, email, password }) {
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();

  const effectiveName = isOwnerEmail(cleanEmail) ? CONFIG.ownerName : cleanName;

  if (!effectiveName) return { ok: false, code: "nameRequired" };
  if (effectiveName.length > 40) return { ok: false, code: "nameTooLong" };
  if (!cleanEmail) return { ok: false, code: "invalidEmail" };
  if (String(password || "").length < 8) return { ok: false, code: "weakPassword" };

  try {
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);

    try { await updateProfile(cred.user, { displayName: effectiveName }); } catch (_) {}

    await setDoc(doc(db, "users", cred.user.uid), {
      name: effectiveName,
      email: cleanEmail,
      emailVerified: false,
      favorites: [],
      dismissedPopups: [],
      createdAt: serverTimestamp()
    });

    return { ok: true, user: cred.user };
  } catch (err) {
    console.error("signup failed:", err);
    return { ok: false, code: err?.code || "generic" };
  }
}

export async function login({ email, password }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return { ok: false, code: "invalidEmail" };
  if (!password) return { ok: false, code: "invalidCredential" };
  try {
    const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
    return { ok: true, user: cred.user };
  } catch (err) {
    console.error("login failed:", err);
    return { ok: false, code: err?.code || "generic" };
  }
}

export async function logout() {
  try {
    await signOut(auth);
    toastSuccess(t("toast.loggedOut"));
  } catch (err) {
    console.error("logout failed:", err);
    toastError(t("auth.errors.generic"));
  }
}

export async function sendPasswordReset(email) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return { ok: false, code: "invalidEmail" };
  try {
    await sendPasswordResetEmail(auth, cleanEmail);
    return { ok: true };
  } catch (err) {
    console.error("password reset failed:", err);
    return { ok: false, code: err?.code || "generic" };
  }
}

export async function markEmailVerified() {
  if (!currentUser) return { ok: false, code: "notSignedIn" };
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { emailVerified: true });
    if (currentProfile) currentProfile.emailVerified = true;
    emit();
    return { ok: true };
  } catch (err) {
    console.error("markEmailVerified failed:", err);
    return { ok: false, code: err?.code || "generic" };
  }
}

export function isVerified() {
  return Boolean(currentProfile?.emailVerified);
}

/* ============================================================================
   6-digit email verification
   ========================================================================== */

const OTP_KEY = "glassa.otp";
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function readOtp() {
  try {
    const raw = sessionStorage.getItem(OTP_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || typeof rec !== "object") return null;
    return rec;
  } catch (_) {
    return null;
  }
}

function writeOtp(rec) {
  try { sessionStorage.setItem(OTP_KEY, JSON.stringify(rec)); } catch (_) {}
}

function clearOtp() {
  try { sessionStorage.removeItem(OTP_KEY); } catch (_) {}
}

export async function sendVerificationCode({ email }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return { ok: false, code: "invalidEmail", cooldownMs: 0 };

  const existing = readOtp();
  if (existing && existing.email === cleanEmail) {
    const elapsed = Date.now() - (existing.lastSentAt || 0);
    const remaining = 60_000 - elapsed;
    if (remaining > 0) {
      return { ok: false, code: "cooldown", cooldownMs: remaining };
    }
  }

  const code = randomDigits(6);
  const now = Date.now();
  const expiresAt = now + OTP_TTL_MS;

  const record = {
    code,
    email: cleanEmail,
    expiresAt,
    attempts: 0,
    lastSentAt: now
  };
  writeOtp(record);

  const time = formatTime(new Date(expiresAt));

  const result = await sendEmailViaEmailJS(CONFIG.emailjs.verifyTemplateId, {
    to_email: cleanEmail,
    email: cleanEmail,
    user_email: cleanEmail,
    recipient: cleanEmail,
    passcode: code,
    code: code,
    verification_code: code,
    otp: code,
    time,
    expiry: time,
    expires_at: time,
    site_url: CONFIG.siteUrl,
    site_name: "Glassa"
  });

  if (!result.ok) {
    clearOtp();
    return { ok: false, code: "sendFailed", cooldownMs: 0, detail: result.detail };
  }

  return { ok: true, cooldownMs: 60_000, expiresAt };
}

export async function verifyCode({ code }) {
  if (!currentUser) return { ok: false, code: "notSignedIn" };

  const rec = readOtp();
  if (!rec) return { ok: false, code: "noCode" };
  if (Date.now() > rec.expiresAt) {
    clearOtp();
    return { ok: false, code: "expired" };
  }
  if (rec.attempts >= OTP_MAX_ATTEMPTS) {
    clearOtp();
    return { ok: false, code: "tooMany" };
  }

  const normalized = String(code || "").replace(/\D/g, "");
  if (normalized.length !== 6) {
    rec.attempts = (rec.attempts || 0) + 1;
    writeOtp(rec);
    return { ok: false, code: "wrong" };
  }

  if (normalized !== rec.code) {
    rec.attempts = (rec.attempts || 0) + 1;
    if (rec.attempts >= OTP_MAX_ATTEMPTS) {
      clearOtp();
      return { ok: false, code: "tooMany" };
    }
    writeOtp(rec);
    return { ok: false, code: "wrong" };
  }

  clearOtp();
  const marked = await markEmailVerified();
  if (!marked.ok) return { ok: false, code: "generic" };
  return { ok: true };
}

export function getResendCooldownMs() {
  const rec = readOtp();
  if (!rec) return 0;
  const elapsed = Date.now() - (rec.lastSentAt || 0);
  return Math.max(0, 60_000 - elapsed);
}

export function getCodeTimeLeftMs() {
  const rec = readOtp();
  if (!rec) return 0;
  return Math.max(0, rec.expiresAt - Date.now());
}

/* ============================================================================
   EmailJS helper
   ========================================================================== */

export async function sendEmailViaEmailJS(templateId, templateParams) {
  try {
    const body = {
      service_id: CONFIG.emailjs.serviceId,
      template_id: templateId,
      user_id: CONFIG.emailjs.publicKey,
      template_params: templateParams || {}
    };
    const res = await fetch("https://api.emailjs.com/api/v1/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.error("EmailJS error:", res.status, res.statusText, text);
      return { ok: false, detail: `${res.status} ${res.statusText} — ${text}` };
    }
    return { ok: true, detail: text };
  } catch (e) {
    console.error("EmailJS network error:", e);
    return { ok: false, detail: String(e) };
  }
}

/* ============================================================================
   Firebase error → friendly message
   ========================================================================== */

export function authErrorMessage(code) {
  switch (code) {
    case "auth/invalid-email":
    case "invalidEmail":
      return t("auth.errors.invalidEmail");
    case "auth/weak-password":
    case "weakPassword":
      return t("auth.errors.weakPassword");
    case "auth/email-already-in-use":
    case "emailInUse":
      return t("auth.errors.emailInUse");
    case "auth/user-not-found":
    case "userNotFound":
      return t("auth.errors.userNotFound");
    case "auth/wrong-password":
    case "wrongPassword":
      return t("auth.errors.wrongPassword");
    case "auth/too-many-requests":
    case "tooMany":
      return t("auth.errors.tooMany");
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "invalidCredential":
      return t("auth.errors.invalidCredential");
    case "nameRequired":
      return t("auth.errors.nameRequired");
    case "nameTooLong":
      return t("auth.errors.nameRequired");
    default:
      return t("auth.errors.generic");
  }
}empts = (rec.attempts || 0) + 1;
    if (rec.attempts >= OTP_MAX_ATTEMPTS) {
      clearOtp();
      return { ok: false, code: "tooMany" };
    }
    writeOtp(rec);
    return { ok: false, code: "wrong" };
  }

  clearOtp();
  const marked = await markEmailVerified();
  if (!marked.ok) return { ok: false, code: "generic" };
  return { ok: true };
}

export function getResendCooldownMs() {
  const rec = readOtp();
  if (!rec) return 0;
  const elapsed = Date.now() - (rec.lastSentAt || 0);
  return Math.max(0, 60_000 - elapsed);
}

export function getCodeTimeLeftMs() {
  const rec = readOtp();
  if (!rec) return 0;
  return Math.max(0, rec.expiresAt - Date.now());
}

/* ============================================================================
   EmailJS helper (REST API, no SDK)
   ========================================================================== */

/**
 * Post a message to EmailJS.
 * @returns {Promise<{ok:boolean, detail?:string}>}
 */
export async function sendEmailViaEmailJS(templateId, templateParams) {
  try {
    const body = {
      service_id: CONFIG.emailjs.serviceId,
      template_id: templateId,
      user_id: CONFIG.emailjs.publicKey,
      template_params: templateParams || {}
    };
    const res = await fetch("https://api.emailjs.com/api/v1/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      // Detailed log so you can diagnose from Chrome DevTools (remote inspect).
      console.error("EmailJS error:", res.status, res.statusText, text);
      return { ok: false, detail: `${res.status} ${res.statusText} — ${text}` };
    }
    return { ok: true, detail: text };
  } catch (e) {
    console.error("EmailJS network error:", e);
    return { ok: false, detail: String(e) };
  }
}

/* ============================================================================
   Map Firebase error codes → friendly i18n keys
   ========================================================================== */

export function authErrorMessage(code) {
  switch (code) {
    case "auth/invalid-email":
    case "invalidEmail":
      return t("auth.errors.invalidEmail");
    case "auth/weak-password":
    case "weakPassword":
      return t("auth.errors.weakPassword");
    case "auth/email-already-in-use":
    case "emailInUse":
      return t("auth.errors.emailInUse");
    case "auth/user-not-found":
    case "userNotFound":
      return t("auth.errors.userNotFound");
    case "auth/wrong-password":
    case "wrongPassword":
      return t("auth.errors.wrongPassword");
    case "auth/too-many-requests":
    case "tooMany":
      return t("auth.errors.tooMany");
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "invalidCredential":
      return t("auth.errors.invalidCredential");
    case "nameRequired":
      return t("auth.errors.nameRequired");
    case "nameTooLong":
      return t("auth.errors.nameRequired");
    default:
      return t("auth.errors.generic");
  }
                    } {
  const rec = readOtp();
  if (!rec) return 0;
  const elapsed = Date.now() - (rec.lastSentAt || 0);
  return Math.max(0, 60_000 - elapsed);
}

/** Remaining time on the current code (ms), or 0 if expired/missing. */
export function getCodeTimeLeftMs() {
  const rec = readOtp();
  if (!rec) return 0;
  return Math.max(0, rec.expiresAt - Date.now());
}

/* ============================================================================
   EmailJS helper (REST API, no SDK)
   ========================================================================== */

/**
 * Post a message to EmailJS.
 * @returns {Promise<boolean>} true on 2xx.
 */
export async function sendEmailViaEmailJS(templateId, templateParams) {
  try {
    const body = {
      service_id: CONFIG.emailjs.serviceId,
      template_id: templateId,
      user_id: CONFIG.emailjs.publicKey,
      template_params: templateParams || {}
    };
    const res = await fetch("https://api.emailjs.com/api/v1/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("EmailJS error:", res.status, text);
      return false;
    }
    return true;
  } catch (e) {
    console.error("EmailJS network error:", e);
    return false;
  }
}

/* ============================================================================
   Map Firebase error codes → friendly i18n keys
   ========================================================================== */

/**
 * Translate a Firebase auth error code into a friendly message.
 * @param {string} code
 * @returns {string}
 */
export function authErrorMessage(code) {
  switch (code) {
    case "auth/invalid-email":
    case "invalidEmail":
      return t("auth.errors.invalidEmail");
    case "auth/weak-password":
    case "weakPassword":
      return t("auth.errors.weakPassword");
    case "auth/email-already-in-use":
    case "emailInUse":
      return t("auth.errors.emailInUse");
    case "auth/user-not-found":
    case "userNotFound":
      return t("auth.errors.userNotFound");
    case "auth/wrong-password":
    case "wrongPassword":
      return t("auth.errors.wrongPassword");
    case "auth/too-many-requests":
    case "tooMany":
      return t("auth.errors.tooMany");
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "invalidCredential":
      return t("auth.errors.invalidCredential");
    case "nameRequired":
      return t("auth.errors.nameRequired");
    case "nameTooLong":
      return t("auth.errors.nameRequired");
    default:
      return t("auth.errors.generic");
  }
}

/* ============================================================================
   Unused-export guard (keeps tree-shakers happy in some bundlers)
   ========================================================================== */

export const __secureRandomInt = secureRandomInt;
