import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  getDoc,
  onSnapshot,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";

import { isConfiguredOwner } from "./config";
import { auth, db } from "./firebase";

export type UserProfile = {
  uid: string;
  name: string;
  email: string;
  emailVerified: boolean;
  favorites: string[];
  dismissedPopups: string[];
};

export function watchUserProfile(
  uid: string,
  onChange: (profile: UserProfile | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, "users", uid),
    (snapshot) =>
      onChange(
        snapshot.exists()
          ? ({ ...(snapshot.data() as Omit<UserProfile, "uid">), uid } satisfies UserProfile)
          : null,
      ),
    onError,
  );
}

export async function getUserProfile(uid: string) {
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists()
    ? ({ ...(snapshot.data() as Omit<UserProfile, "uid">), uid } satisfies UserProfile)
    : null;
}

export async function sendVerificationEmail() {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again to continue.");
  if (isConfiguredOwner(user.email)) return;
  await sendEmailVerification(user);
}

export async function refreshEmailVerification() {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again to continue.");
  await reload(user);
  if (user.emailVerified) {
    await updateDoc(doc(db, "users", user.uid), { emailVerified: true });
  }
  return user.emailVerified;
}

export async function saveFavorites(favorites: string[]) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to continue.");
  await updateDoc(doc(db, "users", user.uid), { favorites });
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
}) {
  const email = input.email.trim().toLowerCase();
  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    input.password,
  );
  await updateProfile(credential.user, { displayName: input.name.trim() });
  await setDoc(doc(db, "users", credential.user.uid), {
    name: input.name.trim(),
    email,
    emailVerified: isConfiguredOwner(email),
    favorites: [],
    dismissedPopups: [],
    createdAt: serverTimestamp(),
  });

  if (!isConfiguredOwner(email)) {
    await sendEmailVerification(credential.user);
  }
  return credential.user;
}

export async function signIn(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  if (!isConfiguredOwner(email)) {
    const userRef = doc(db, "users", credential.user.uid);
    const profile = await getDoc(userRef);
    if (credential.user.emailVerified && profile.exists()) {
      await updateDoc(userRef, { emailVerified: true });
    } else if (!profile.exists() || !profile.data().emailVerified) {
      await sendVerificationCode(email, true);
    }
  }
  return credential.user;
}

export async function resetPassword(email: string) {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

export function signOutUser() {
  return signOut(auth);
}

export function watchAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export function isOwnerUser(user: User | null) {
  return isConfiguredOwner(user?.email);
}

