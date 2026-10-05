export const CONFIG = {
  siteUrl: (import.meta.env.VITE_SITE_URL || `${window.location.origin}${import.meta.env.BASE_URL}`).replace(/\/$/, ""),
  ownerEmail: (import.meta.env.VITE_OWNER_EMAIL || "OWNER_EMAIL_HERE")
    .trim()
    .toLowerCase(),
  firebase: {
    apiKey: "AIzaSyDNp7eIv6mRXUHA76wyz3ozC9L1MG4RCFA",
    authDomain: "cybertfhem.firebaseapp.com",
    projectId: "cybertfhem",
    storageBucket: "cybertfhem.firebasestorage.app",
    messagingSenderId: "287774208226",
    appId: "1:287774208226:web:081be7dfb45eb139d72ebb",
  },
  emailjs: {
    serviceId: "service_6nidwpe",
    publicKey: "-WlszUS59Pe40x7vF",
    verifyTemplateId: "template_x0njxed",
    paymentTemplateId: "template_ds7gx09",
  },
  cloudinary: {
    cloudName: "zsul1nvx",
    uploadPreset: "glassa_unsigned",
  },
} as const;

export const isConfiguredOwner = (email?: string | null) =>
  Boolean(
    email &&
      CONFIG.ownerEmail !== "owner_email_here" &&
      email.trim().toLowerCase() === CONFIG.ownerEmail,
  );
