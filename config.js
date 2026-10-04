/**
 * ============================================================================
 *  Glassa — Runtime configuration
 * ============================================================================
 *  These values are intentionally shipped to the browser. They are public
 *  client-side keys (Firebase web config, EmailJS public key, Cloudinary
 *  unsigned preset). Real security lives in `firestore.rules`, never here.
 * ============================================================================
 */

export const CONFIG = {
  /** Canonical public URL of the deployed site (used in emails/links). */
  siteUrl: "https://yarmka.github.io/glassa/",

  /** Owner email — lowercase. Grants access to the admin panel. */
  ownerEmail: "yarmka0@gmail.com",

  /** Owner display name — applied automatically to the owner's profile. */
  ownerName: "محمد يوسف",

  /** Firebase web SDK config. */
  firebase: {
    apiKey: "AIzaSyDNp7eIv6mRXUHA76wyz3ozC9L1MG4RCFA",
    authDomain: "cybertfhem.firebaseapp.com",
    projectId: "cybertfhem",
    storageBucket: "cybertfhem.firebasestorage.app",
    messagingSenderId: "287774208226",
    appId: "1:287774208226:web:081be7dfb45eb139d72ebb"
  },

  /** EmailJS — REST API only, no SDK. */
  emailjs: {
    serviceId: "service_6nidwpe",
    publicKey: "-WlszUS59Pe40x7vF",
    verifyTemplateId: "template_x0njxed",
    paymentTemplateId: "template_ds7gx09"
  },

  /** Cloudinary — unsigned upload preset. */
  cloudinary: {
    cloudName: "zsul1nvx",
    uploadPreset: "glassa_unsigned"
  }
};

/** Case-insensitive check: does the given email belong to the owner? */
export function isOwnerEmail(email) {
  if (!email) return false;
  return String(email).toLowerCase() === String(CONFIG.ownerEmail).toLowerCase();
}

/** True when the owner email placeholder has not been replaced yet. */
export function isOwnerEmailConfigured() {
  return (
    typeof CONFIG.ownerEmail === "string" &&
    CONFIG.ownerEmail.length > 0 &&
    CONFIG.ownerEmail !== "OWNER_EMAIL_HERE"
  );
}
