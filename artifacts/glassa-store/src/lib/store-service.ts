import {
  arrayRemove,
  arrayUnion,
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
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";

import { auth } from "./firebase";
import { db } from "./firebase";
import { CONFIG, isConfiguredOwner } from "./config";
import { sendEmail } from "./email-service";
import { hasStaffPermission, type StaffGrant } from "./staff-service";

export type Platform = "pc" | "android" | "both";
export type OrderStatus = "pending" | "paid" | "rejected";

export type Game = {
  id: string;
  title_ar: string;
  title_en: string;
  desc_ar: string;
  desc_en: string;
  platform: Platform;
  price: number;
  offerPrice: number | null;
  offerEndsAt: Date | { toDate?: () => Date } | null;
  size: string;
  worksPercent: number;
  sysReq: string;
  coverUrl: string;
  screenshots: string[];
  hidden: boolean;
  badgeMostRequested: boolean;
  badgeUpdated: boolean;
  createdAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
};

export type OrderItem = { gameId: string; title: string; price: number };
export type Order = {
  id: string;
  uid: string;
  email: string;
  customerName: string;
  phone: string;
  note: string;
  items: OrderItem[];
  itemIds: string[];
  subtotal: number;
  couponCode: string;
  discountPercent: number;
  total: number;
  status: OrderStatus;
  rejectReason: string;
  rejectionSeen: boolean;
  createdAt?: { toDate?: () => Date } | null;
  paidAt?: { toDate?: () => Date } | null;
};

export type Coupon = {
  code: string;
  percent: number;
  mode: "once" | "open";
  expiresAt: { toDate?: () => Date } | null;
  active: boolean;
};

export type GameInput = Omit<Game, "id" | "createdAt" | "updatedAt">;
export type GameDraft = GameInput & { downloadUrl: string };

const effectivePrice = (game: Game) => {
  const end =
    game.offerEndsAt instanceof Date
      ? game.offerEndsAt
      : game.offerEndsAt?.toDate?.();
  const offerIsLive =
    game.offerPrice !== null && (!end || end.getTime() > Date.now());
  return offerIsLive ? game.offerPrice! : game.price;
};

const sortNewest = <T extends { createdAt?: { toDate?: () => Date } | null }>(
  entries: T[],
) =>
  entries.sort(
    (a, b) =>
      (b.createdAt?.toDate?.().getTime() ?? 0) -
      (a.createdAt?.toDate?.().getTime() ?? 0),
  );

function requireSignedIn() {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to continue.");
  return user;
}

function canManageGames(grant?: StaffGrant | null) {
  return isConfiguredOwner(auth.currentUser?.email) || hasStaffPermission(grant, "games.manage");
}

function canProcessOrders(grant?: StaffGrant | null) {
  return isConfiguredOwner(auth.currentUser?.email) || hasStaffPermission(grant, "orders.process");
}

export function watchGames(
  includeHidden: boolean,
  onChange: (games: Game[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const base = collection(db, "games");
  // Keep customer queries single-field so Firestore does not need composite indexes.
  const gamesQuery = includeHidden
    ? query(base, orderBy("createdAt", "desc"))
    : query(base, where("hidden", "==", false));

  return onSnapshot(
    gamesQuery,
    (snapshot) => onChange(sortNewest(snapshot.docs.map((item) => ({
      ...(item.data() as Omit<Game, "id">),
      id: item.id,
    })))),
    onError,
  );
}

export function watchOrders(
  ownerView: boolean,
  onChange: (orders: Order[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const user = requireSignedIn();
  const ordersRef = collection(db, "orders");
  const ordersQuery = ownerView
    ? query(ordersRef, orderBy("createdAt", "desc"))
    : query(ordersRef, where("uid", "==", user.uid));

  return onSnapshot(
    ordersQuery,
    (snapshot) =>
      onChange(
        sortNewest(
          snapshot.docs.map((item) => ({
            ...(item.data() as Omit<Order, "id">),
            id: item.id,
          })),
        ),
      ),
    onError,
  );
}

export async function saveGame(input: GameDraft, grant?: StaffGrant | null) {
  if (!canManageGames(grant)) throw new Error("You do not have permission to manage games.");
  const gameId = doc(collection(db, "games")).id;
  const batch = writeBatch(db);
  const timestamp = serverTimestamp();
  const { downloadUrl, ...game } = input;
  batch.set(doc(db, "games", gameId), {
    ...game,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  batch.set(doc(db, "links", gameId), { downloadUrl });
  await batch.commit();
  return gameId;
}

export async function updateGame(
  gameId: string,
  input: GameDraft,
  grant?: StaffGrant | null,
) {
  if (!canManageGames(grant)) throw new Error("You do not have permission to manage games.");
  const { downloadUrl, ...game } = input;
  const batch = writeBatch(db);
  batch.set(
    doc(db, "games", gameId),
    { ...game, updatedAt: serverTimestamp() },
    { merge: true },
  );
  batch.set(doc(db, "links", gameId), { downloadUrl });
  await batch.commit();
}

export async function deleteGame(gameId: string, grant?: StaffGrant | null) {
  if (!canManageGames(grant)) throw new Error("You do not have permission to manage games.");
  const batch = writeBatch(db);
  batch.delete(doc(db, "games", gameId));
  batch.delete(doc(db, "links", gameId));
  await batch.commit();
}

export async function getManagedDownloadUrl(
  gameId: string,
  grant?: StaffGrant | null,
) {
  if (!canManageGames(grant)) throw new Error("You do not have permission to manage games.");
  const snapshot = await getDoc(doc(db, "links", gameId));
  return snapshot.exists() ? (snapshot.data().downloadUrl as string) : "";
}

export async function setGameVisibility(
  gameId: string,
  hidden: boolean,
  grant?: StaffGrant | null,
) {
  if (!canManageGames(grant)) throw new Error("You do not have permission to manage games.");
  await updateDoc(doc(db, "games", gameId), { hidden, updatedAt: serverTimestamp() });
}

export async function getGame(gameId: string) {
  const snapshot = await getDoc(doc(db, "games", gameId));
  return snapshot.exists()
    ? ({ ...(snapshot.data() as Omit<Game, "id">), id: snapshot.id } satisfies Game)
    : null;
}

export async function toggleFavorite(gameId: string, favorite: boolean) {
  const user = requireSignedIn();
  await updateDoc(doc(db, "users", user.uid), {
    favorites: favorite ? arrayRemove(gameId) : arrayUnion(gameId),
  });
}

export async function validateCoupon(codeInput: string): Promise<Coupon> {
  requireSignedIn();
  const code = codeInput.trim().toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(code)) throw new Error("Coupon code is invalid.");
  const snapshot = await getDoc(doc(db, "coupons", code));
  if (!snapshot.exists()) throw new Error("Coupon was not found.");
  const coupon = snapshot.data() as Omit<Coupon, "code">;
  const expiry = coupon.expiresAt?.toDate?.();
  if (!coupon.active || (expiry && expiry.getTime() <= Date.now())) {
    throw new Error("This coupon is inactive or expired.");
  }
  if (coupon.mode === "once") {
    const used = await getDoc(doc(db, "couponUses", `${code}_${auth.currentUser!.uid}`));
    if (used.exists()) throw new Error("This coupon has already been used.");
  }
  return { ...coupon, code };
}

export async function createOrder(input: {
  gameIds: string[];
  customerName: string;
  phone?: string;
  note?: string;
  coupon?: Coupon | null;
}) {
  const user = requireSignedIn();
  if (input.gameIds.length === 0 || input.gameIds.length > 20) {
    throw new Error("Choose between 1 and 20 games.");
  }
  if (!user.email) throw new Error("The signed-in account has no email address.");
  const profile = await getDoc(doc(db, "users", user.uid));
  if (!profile.exists() || (!profile.data().emailVerified && !isConfiguredOwner(user.email))) {
    throw new Error("Verify your email before placing an order.");
  }

  const games = await Promise.all(input.gameIds.map((id) => getGame(id)));
  if (games.some((game) => !game || game.hidden)) {
    throw new Error("One or more games are no longer available.");
  }
  const available = games as Game[];
  const priorUnlocks = await Promise.all(
    available.map((game) => getDoc(doc(db, "unlocks", `${user.uid}_${game.id}`))),
  );
  if (priorUnlocks.some((unlock) => unlock.exists())) {
    throw new Error("Remove games you already own from your cart.");
  }
  const items = available.map((game) => ({
    gameId: game.id,
    title: game.title_en || game.title_ar,
    price: effectivePrice(game),
  }));
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  let discountPercent = 0;
  let couponCode = "";
  if (input.coupon) {
    const freshCoupon = await validateCoupon(input.coupon.code);
    couponCode = freshCoupon.code;
    discountPercent = freshCoupon.percent;
  }
  const total = Math.max(0, Math.round(subtotal * (1 - discountPercent / 100) * 100) / 100);
  const orderRef = doc(collection(db, "orders"));
  const batch = writeBatch(db);
  batch.set(orderRef, {
    uid: user.uid,
    email: user.email.toLowerCase(),
    customerName: input.customerName.trim(),
    phone: input.phone?.trim() ?? "",
    note: input.note?.trim() ?? "",
    items,
    itemIds: available.map((game) => game.id),
    subtotal,
    couponCode,
    discountPercent,
    total,
    status: "pending",
    rejectReason: "",
    rejectionSeen: false,
    createdAt: serverTimestamp(),
    paidAt: null,
  });
  if (couponCode && input.coupon?.mode === "once") {
    batch.set(doc(db, "couponUses", `${couponCode}_${user.uid}`), {
      uid: user.uid,
      code: couponCode,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return { orderId: orderRef.id, total };
}

function generatePaymentCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length])
    .join("")
    .match(/.{1,4}/g)!
    .join("-");
}

export async function markOrderPaid(
  order: Order,
  language: "ar" | "en",
  grant?: StaffGrant | null,
) {
  if (!canProcessOrders(grant)) throw new Error("You do not have permission to process orders.");
  const code = generatePaymentCode();
  const latest = await getDoc(doc(db, "orders", order.id));
  if (!latest.exists() || latest.data().status !== "pending") {
    throw new Error("This order is no longer waiting for payment.");
  }
  const batch = writeBatch(db);
  batch.set(doc(db, "orderSecrets", order.id), { code });
  batch.update(doc(db, "orders", order.id), {
    status: "paid",
    paidAt: serverTimestamp(),
  });
  await batch.commit();

  const games = await Promise.all(order.itemIds.map((gameId) => getGame(gameId)));
  const emailGameTitles = games.map((game, index) =>
    (language === "ar" ? game?.title_ar : game?.title_en) ||
    game?.title_en ||
    order.items[index]?.title ||
    "",
  );
  const emailResult = await sendEmail(CONFIG.emailjs.paymentTemplateId, {
    to_email: order.email,
    customer_name: order.customerName,
    order_id: order.id.slice(0, 8).toUpperCase(),
    games: emailGameTitles.join("\n"),
    total: order.total.toFixed(2),
    code,
    site_url: CONFIG.siteUrl,
  });
  return { code, emailSent: emailResult.ok, emailMessage: emailResult.message, language };
}

export async function rejectOrder(
  order: Order,
  reason: string,
  grant?: StaffGrant | null,
) {
  if (!canProcessOrders(grant)) throw new Error("You do not have permission to process orders.");
  if (!reason.trim()) throw new Error("A reason is required.");
  const batch = writeBatch(db);
  batch.update(doc(db, "orders", order.id), {
    status: "rejected",
    rejectReason: reason.trim(),
    rejectionSeen: false,
  });
  if (order.couponCode) {
    const coupon = await getDoc(doc(db, "coupons", order.couponCode));
    if (coupon.exists() && coupon.data().mode === "once") {
      batch.delete(doc(db, "couponUses", `${order.couponCode}_${order.uid}`));
    }
  }
  await batch.commit();
}

export async function claimPaidOrder(order: Order, code: string) {
  const user = requireSignedIn();
  if (order.uid !== user.uid || order.status !== "paid") {
    throw new Error("This paid order does not belong to your account.");
  }
  const batch = writeBatch(db);
  let pendingUnlocks = 0;
  for (const gameId of order.itemIds) {
    const existing = await getDoc(doc(db, "unlocks", `${user.uid}_${gameId}`));
    if (existing.exists()) continue;
    batch.set(doc(db, "unlocks", `${user.uid}_${gameId}`), {
      uid: user.uid,
      gameId,
      orderId: order.id,
      code: code.trim().toUpperCase(),
      createdAt: serverTimestamp(),
    });
    pendingUnlocks += 1;
  }
  if (pendingUnlocks > 0) await batch.commit();
}

export async function readDownloadUrl(gameId: string) {
  const snapshot = await getDoc(doc(db, "links", gameId));
  if (!snapshot.exists()) throw new Error("The download link is not available.");
  const url = snapshot.data().downloadUrl as string;
  if (!url) throw new Error("The owner has not added a download link yet.");
  return url;
}

export async function markRejectionSeen(orderId: string) {
  await updateDoc(doc(db, "orders", orderId), { rejectionSeen: true });
}

export async function listCoupons(): Promise<Coupon[]> {
  const snapshot = await getDocs(query(collection(db, "coupons"), orderBy("createdAt", "desc")));
  return snapshot.docs.map((item) => ({ ...(item.data() as Omit<Coupon, "code">), code: item.id }));
}
