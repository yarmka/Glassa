/**
 * ============================================================================
 *  Glassa — Authentication
 * ============================================================================
 *  - Sign up (email + password + name)
 *  - 6-digit email verification via EmailJS (no Firebase email link)
 *  - Login, logout, password reset
 *  - Auth state broadcast + owner detection
 *  - The public profile doc (users/{uid}) is created on signup
 *
 *  NOTE: The owner account is now verified like any other account.
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
  randomDigits,
  secureRandomInt
} from "./ui.js";
import { t } from "./i18n.js";

/* ============================================================================
   State
   ========================================================================== */

/** @type {import("firebase/auth").User|null} */
let currentUser = null;
/** @type {{name?:string,email?:string,emailVerified?:boolean,favorites?:string[],dismissedPopups?:string[]}|null} */
let currentProfile = null;

const listeners = new Set();

/** Current Firebase user (or null). */
export function getUser() { return currentUser; }

/** Cached users/{uid} document data (or null). */
export function getProfile() { return currentProfile; }

/** True if the current user is the owner. */
export function isOwner() {
  return isOwnerEmail(currentUser?.email);
}

/**
 * Subscribe to auth changes. Called immediately with the current state.
 * fn({ user, profile, isOwner })
 */
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
   Auth state observer (started once, at module import)
   ========================================================================== */

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentProfile = user ? await loadProfile(user.uid) : null;
  emit();
});

/* ============================================================================
   Sign up / Sign in / Sign out
   ========================================================================== */

/**
 * Sign up a new account and create the users/{uid} document.
 * @returns {Promise<{ok:true, user:any} | {ok:false, code:string}>}
 */
export async function signup({ name, email, password }) {
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (!cleanName) return { ok: false, code: "nameRequired" };
  if (cleanName.length > 40) return { ok: false, code: "nameTooLong" };
  if (!cleanEmail) return { ok: false, code: "invalidEmail" };
  if (String(password || "").length < 8) return { ok: false, code: "weakPassword" };

  try {
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);

    // Best-effort display name on the Firebase user.
    try { await updateProfile(cred.user, { displayName: cleanName }); } catch (_) {}

    // Create the profile doc. Matches firestore.rules users/{uid} create.
    await setDoc(doc(db, "users", cred.user.uid), {
      name: cleanName,
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

/**
 * Sign in an existing account.
 * @returns {Promise<{ok:true,user:any} | {ok:false, code:string}>}
 */
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

/** Sign the current user out. */
export async function logout() {
  try {
    await signOut(auth);
    toastSuccess(t("toast.loggedOut"));
  } catch (err) {
    console.error("logout failed:", err);
    toastError(t("auth.errors.generic"));
  }
}

/** Send a password reset email. */
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

/**
 * Mark the current user's profile as verified.
 * Called after successful OTP entry.
 */
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

/**
 * True when the current user's profile has emailVerified === true.
 * The owner is NOT auto-verified anymore — they go through the same flow.
 */
export function isVerified() {
  return Boolean(currentProfile?.emailVerified);
}

/* ============================================================================
   6-digit email verification (client-side OTP, sessionStorage-backed)
   ========================================================================== */

const OTP_KEY = "glassa.otp";
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_MS = 60_000;    // 60 seconds between resends

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

/**
 * Generate a fresh 6-digit code and email it.
 * The OTP is only persisted AFTER a successful send, so a failed
 * send does not invalidate a previously working code.
 */
export async function sendVerificationCode({ email }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return { ok: false, code: "invalidEmail", cooldownMs: 0 };

  // 60s resend cooldown
  const existing = readOtp();
  if (existing && existing.email === cleanEmail) {
    const elapsed = Date.now() - (existing.lastSentAt || 0);
    const remaining = OTP_COOLDOWN_MS - elapsed;
    if (remaining > 0) {
      return { ok: false, code: "cooldown", cooldownMs: remaining };
    }
  }

  const code = randomDigits(6);
  const now = Date.now();
  const expiresAt = now + OTP_TTL_MS;
  const time = formatTime(new Date(expiresAt));

  // Extra param aliases in case the EmailJS template uses different names.
  const params = {
    to_email: cleanEmail,
    passcode: code,
    time,
    email: cleanEmail,
    code,
    verification_code: code
  };

  const emailOk = await sendEmailViaEmailJS(CONFIG.emailjs.verifyTemplateId, params);

  if (!emailOk) {
    return { ok: false, code: "sendFailed", cooldownMs: 0 };
  }

  // Persist AFTER successful send.
  writeOtp({
    code,
    email: cleanEmail,
    expiresAt,
    attempts: 0,
    lastSentAt: now
  });

  return { ok: true, cooldownMs: OTP_COOLDOWN_MS, expiresAt };
}

/**
 * Verify an OTP code. On success, marks the profile as verified.
 * @returns {Promise<{ok:true} | {ok:false, code:"wrong"|"expired"|"tooMany"|"noCode"|"notSignedIn"|"generic"}>}
 */
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

/** Remaining cooldown in ms (0 if ready to send). */
export function getResendCooldownMs() {
  const rec = readOtp();
  if (!rec) return 0;
  const elapsed = Date.now() - (rec.lastSentAt || 0);
  return Math.max(0, OTP_COOLDOWN_MS - elapsed);
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
 * Logs full diagnostics to the browser console.
 * @returns {Promise<boolean>} true on success.
 */
export async function sendEmailViaEmailJS(templateId, templateParams) {
  try {
    const body = {
      service_id: CONFIG.emailjs.serviceId,
      template_id: templateId,
      user_id: CONFIG.emailjs.publicKey,
      template_params: templateParams || {}
    };

    console.log("[EmailJS] →", {
      service_id: body.service_id,
      template_id: body.template_id,
      params: body.template_params
    });

    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await res.text().catch(() => "");
    console.log("[EmailJS] ←", res.status, text);

    if (!res.ok) {
      // Common EmailJS errors, printed for easy debugging.
      const hint = {
        400: "Bad request — missing or invalid parameters (check template variables).",
        401: "Unauthorized — invalid public key.",
        402: "Payment required — EmailJS free plan limit reached (200/month).",
        403: "Forbidden — domain not allowed, or service disabled.",
        412: "Precondition failed — invalid service_id or template_id.",
        422: "Unprocessable — recipient email rejected by EmailJS."
      }[res.status] || "";
      console.error(`[EmailJS] HTTP ${res.status}. ${hint}`, text);
      return false;
    }

    // EmailJS returns body "OK" on success.
    if (text && !text.trim().toLowerCase().startsWith("ok")) {
      console.error("[EmailJS] Non-OK body:", text);
      return false;
    }

    return true;
  } catch (e) {
    console.error("[EmailJS] network error:", e);
    return false;
  }
}

/**
 * Debug helper. Call from the console:
 *   (await import("./auth.js")).testEmailJS("you@example.com")
 */
export async function testEmailJS(toEmail) {
  const params = {
    to_email: toEmail,
    passcode: "123456",
    time: "12:00 PM",
    email: toEmail,
    code: "123456",
    verification_code: "123456"
  };
  return await sendEmailViaEmailJS(CONFIG.emailjs.verifyTemplateId, params);
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
    case "nameTooLong":
      return t("auth.errors.nameRequired");
    default:
      return t("auth.errors.generic");
  }
}

/* Kept for tree-shakers; safe to remove if you delete unused imports. */
export const __secureRandomInt = secureRandomInt;
