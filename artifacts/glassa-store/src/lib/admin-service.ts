import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import { auth, db } from "./firebase";
import { isConfiguredOwner } from "./config";
import {
  hasStaffPermission,
  type StaffGrant,
} from "./staff-service";
import type { Coupon } from "./store-service";

function requirePermission(
  grant: StaffGrant | null | undefined,
  permission: "coupons.manage" | "popups.manage" | "settings.manage" | "requests.manage",
) {
  if (!isConfiguredOwner(auth.currentUser?.email) && !hasStaffPermission(grant, permission)) {
    throw new Error("You do not have permission to make this change.");
  }
}

export async function saveCoupon(
  input: Omit<Coupon, "code" | "expiresAt"> & { code: string; expiresAt: Date | null },
  grant?: StaffGrant | null,
) {
  requirePermission(grant, "coupons.manage");
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(code)) {
    throw new Error("Use only letters, numbers, and hyphens in a coupon code.");
  }
  if (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > 100) {
    throw new Error("Discount must be from 1% to 100%.");
  }
  const ref = doc(db, "coupons", code);
  const existing = await getDoc(ref);
  await setDoc(
    ref,
    {
      percent: input.percent,
      mode: input.mode,
      expiresAt: input.expiresAt,
      active: input.active,
      ...(!existing.exists() ? { createdAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function removeCoupon(
  codeInput: string,
  grant?: StaffGrant | null,
) {
  requirePermission(grant, "coupons.manage");
  await deleteDoc(doc(db, "coupons", codeInput.trim().toUpperCase()));
}

export type Popup = {
  id: string;
  title_ar: string;
  title_en: string;
  body_ar: string;
  body_en: string;
  imageUrl: string;
  active: boolean;
  createdAt?: unknown;
};

export function watchPopups(
  ownerView: boolean,
  onChange: (popups: Popup[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const popupRef = collection(db, "popups");
  const popupQuery = ownerView
    ? query(popupRef, orderBy("createdAt", "desc"))
    : query(popupRef, where("active", "==", true));
  return onSnapshot(
    popupQuery,
    (snapshot) =>
      onChange(
        snapshot.docs.map((item) => ({
          ...(item.data() as Omit<Popup, "id">),
          id: item.id,
        })),
      ),
    onError,
  );
}

export async function savePopup(
  popup: Omit<Popup, "id" | "createdAt">,
  grant?: StaffGrant | null,
  id?: string,
) {
  requirePermission(grant, "popups.manage");
  const ref = id ? doc(db, "popups", id) : doc(collection(db, "popups"));
  await setDoc(
    ref,
    { ...popup, updatedAt: serverTimestamp(), ...(id ? {} : { createdAt: serverTimestamp() }) },
    { merge: true },
  );
  return ref.id;
}

export async function removePopup(id: string, grant?: StaffGrant | null) {
  requirePermission(grant, "popups.manage");
  await deleteDoc(doc(db, "popups", id));
}

export async function setPopupActive(
  id: string,
  active: boolean,
  grant?: StaffGrant | null,
) {
  requirePermission(grant, "popups.manage");
  await updateDoc(doc(db, "popups", id), { active, updatedAt: serverTimestamp() });
}

export type Announcement = { text_ar: string; text_en: string; active: boolean };

export function watchAnnouncement(
  onChange: (announcement: Announcement | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, "settings", "announcement"),
    (snapshot) =>
      onChange(snapshot.exists() ? (snapshot.data() as Announcement) : null),
    onError,
  );
}

export async function saveAnnouncement(
  announcement: Announcement,
  grant?: StaffGrant | null,
) {
  requirePermission(grant, "settings.manage");
  await setDoc(doc(db, "settings", "announcement"), {
    ...announcement,
    updatedAt: serverTimestamp(),
  });
}

export type GameRequest = {
  id: string;
  uid: string;
  userName: string;
  gameName: string;
  note: string;
  platform: "pc" | "android" | "both";
  status: "new" | "done";
  createdAt?: unknown;
};

export async function submitGameRequest(
  gameName: string,
  note: string,
  platform: GameRequest["platform"],
) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to request a game.");
  const ref = doc(collection(db, "gameRequests"));
  await setDoc(ref, {
    uid: user.uid,
    userName: user.displayName ?? user.email ?? "",
    gameName: gameName.trim(),
    note: note.trim(),
    platform,
    status: "new",
    createdAt: serverTimestamp(),
  });
}

export function watchGameRequests(
  grant: StaffGrant | null | undefined,
  onChange: (requests: GameRequest[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  requirePermission(grant, "requests.manage");
  return onSnapshot(
    query(collection(db, "gameRequests"), orderBy("createdAt", "desc")),
    (snapshot) =>
      onChange(
        snapshot.docs.map((item) => ({
          ...(item.data() as Omit<GameRequest, "id">),
          id: item.id,
        })),
      ),
    onError,
  );
}

export async function listGameRequests(grant?: StaffGrant | null) {
  requirePermission(grant, "requests.manage");
  const snapshot = await getDocs(
    query(collection(db, "gameRequests"), orderBy("createdAt", "desc")),
  );
  return snapshot.docs.map((item) => ({
    ...(item.data() as Omit<GameRequest, "id">),
    id: item.id,
  }));
}

export async function markRequestDone(
  requestId: string,
  grant?: StaffGrant | null,
) {
  requirePermission(grant, "requests.manage");
  await updateDoc(doc(db, "gameRequests", requestId), { status: "done" });
}

export async function removeGameRequest(
  requestId: string,
  grant?: StaffGrant | null,
) {
  requirePermission(grant, "requests.manage");
  await deleteDoc(doc(db, "gameRequests", requestId));
}
