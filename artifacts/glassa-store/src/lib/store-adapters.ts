import type { Announcement, Coupon, Game, Order, PopupItem, RequestItem, StaffGrant } from "./store";
import type { Game as FirebaseGame, Order as FirebaseOrder, Coupon as FirebaseCoupon } from "./store-service";
import type { StaffGrant as FirebaseStaffGrant } from "./staff-service";
import type { GameRequest, Popup, Announcement as FirebaseAnnouncement } from "./admin-service";
type Lang = "ar" | "en";

function asDateString(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === "object" && "toDate" in value) {
    const date = (value as { toDate: () => Date }).toDate();
    return date.toISOString().slice(0, 10);
  }
  return typeof value === "string" ? value.slice(0, 10) : "";
}

export function fromFirebaseGame(game: FirebaseGame): Game {
  return {
    ...game,
    platform: game.platform === "android" ? "Android" : game.platform === "both" ? "PC + Android" : "PC",
    offerPrice: game.offerPrice ?? undefined,
    offerEndsAt: asDateString(game.offerEndsAt) || undefined,
    screenshots: game.screenshots ?? [],
    coverUrl: game.coverUrl ?? "",
    size: game.size ?? "",
    sysReq: game.sysReq ?? "",
  };
}

export function fromFirebaseOrder(order: FirebaseOrder): Order {
  const itemIds = order.itemIds ?? order.items.map((item) => item.gameId);
  return {
    id: order.id,
    uid: order.uid,
    email: order.email,
    customerName: order.customerName,
    phone: order.phone,
    note: order.note,
    items: itemIds.map((gameId) => ({ gameId, quantity: 1 })),
    itemIds,
    total: order.total,
    status: order.status,
    rejectReason: order.rejectReason,
    couponCode: order.couponCode,
    discountPercent: order.discountPercent,
    createdAt: asDateString(order.createdAt),
  };
}

export function fromFirebaseCoupon(coupon: FirebaseCoupon): Coupon {
  return {
    ...coupon,
    expiresAt: asDateString(coupon.expiresAt),
  };
}

export function fromFirebaseStaff(grant: FirebaseStaffGrant): StaffGrant {
  return {
    email: grant.email,
    active: grant.active,
    permissions: Object.entries(grant.permissions)
      .filter(([, enabled]) => enabled)
      .map(([permission]) => permission) as StaffGrant["permissions"],
  };
}

export function fromFirebaseRequest(request: GameRequest): RequestItem {
  return {
    id: request.id,
    title: request.gameName,
    platform: request.platform === "android" ? "Android" : request.platform === "both" ? "PC + Android" : "PC",
    customer: request.userName,
    status: request.status === "done" ? "reviewed" : "new",
  };
}

export function fromFirebasePopup(popup: Popup, lang: Lang): PopupItem {
  return {
    id: popup.id,
    title: lang === "ar" ? popup.title_ar : popup.title_en,
    body: lang === "ar" ? popup.body_ar : popup.body_en,
    active: popup.active,
  };
}

export function fromFirebaseAnnouncement(announcement: FirebaseAnnouncement | null): Announcement {
  return announcement ?? { text_ar: "", text_en: "", active: false };
}
