import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import { auth } from "./firebase";
import { db } from "./firebase";
import { isOwnerUser } from "./auth-service";

export const STAFF_PERMISSIONS = [
  "orders.view",
  "orders.process",
  "games.manage",
  "coupons.manage",
  "popups.manage",
  "requests.manage",
  "settings.manage",
] as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];
export type StaffPermissions = Record<StaffPermission, boolean>;

export type StaffGrant = {
  email: string;
  active: boolean;
  permissions: StaffPermissions;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export const EMPTY_STAFF_PERMISSIONS: StaffPermissions = {
  "orders.view": false,
  "orders.process": false,
  "games.manage": false,
  "coupons.manage": false,
  "popups.manage": false,
  "requests.manage": false,
  "settings.manage": false,
};

function requireOwner() {
  if (!isOwnerUser(auth.currentUser)) {
    throw new Error("Only the owner can manage staff access.");
  }
}

export async function listStaff(): Promise<StaffGrant[]> {
  requireOwner();
  const snapshot = await getDocs(collection(db, "staff"));
  return snapshot.docs
    .map((item) => item.data() as StaffGrant)
    .sort((a, b) => a.email.localeCompare(b.email));
}

export function watchStaff(
  onChange: (grant: StaffGrant | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const email = auth.currentUser?.email?.trim().toLowerCase();
  if (!email) {
    onChange(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, "staff", email),
    (snapshot) => onChange(snapshot.exists() ? (snapshot.data() as StaffGrant) : null),
    (error) => onError(error),
  );
}

export async function saveStaffGrant(
  emailInput: string,
  permissions: StaffPermissions,
) {
  requireOwner();
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  if (!STAFF_PERMISSIONS.some((permission) => permissions[permission])) {
    throw new Error("Choose at least one permission.");
  }

  const registeredUsers = await getDocs(
    query(collection(db, "users"), where("email", "==", email), limit(1)),
  );
  if (registeredUsers.empty) {
    throw new Error("This person must create an account first, then you can grant access.");
  }

  const existing = await getDoc(doc(db, "staff", email));
  const previous = existing.exists() ? (existing.data() as StaffGrant) : null;
  await setDoc(doc(db, "staff", email), {
    email,
    active: true,
    permissions: { ...EMPTY_STAFF_PERMISSIONS, ...permissions },
    createdAt: previous?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function deactivateStaff(emailInput: string) {
  requireOwner();
  const email = emailInput.trim().toLowerCase();
  await updateDoc(doc(db, "staff", email), {
    active: false,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteStaff(emailInput: string) {
  requireOwner();
  await deleteDoc(doc(db, "staff", emailInput.trim().toLowerCase()));
}

export function hasStaffPermission(
  grant: StaffGrant | null | undefined,
  permission: StaffPermission,
) {
  return Boolean(grant?.active && grant.permissions?.[permission]);
}

export function canViewOrders(grant: StaffGrant | null | undefined) {
  return (
    hasStaffPermission(grant, "orders.view") ||
    hasStaffPermission(grant, "orders.process")
  );
}
