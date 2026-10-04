/**
 * Firebase bootstrap (v10.12.2 modular via CDN).
 * Re-exports the small set of auth/firestore primitives the rest of the app
 * uses, so other modules never import directly from the CDN URLs.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  updateProfile,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { CONFIG } from "./config.js";

export const app = initializeApp(CONFIG.firebase);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Persist auth across sessions. Silently ignore failures (private mode).
setPersistence(auth, browserLocalPersistence).catch(() => {});

export {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  deleteUser,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  Timestamp
};
