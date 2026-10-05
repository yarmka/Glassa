export type Platform = "PC" | "Android" | "PC + Android";
export type Permission =
  | "orders.view"
  | "orders.process"
  | "games.manage"
  | "coupons.manage"
  | "popups.manage"
  | "requests.manage"
  | "settings.manage";
export type OrderStatus = "pending" | "paid" | "rejected";

export type Game = {
  id: string;
  title_ar: string;
  title_en: string;
  desc_ar: string;
  desc_en: string;
  platform: Platform;
  price: number;
  offerPrice?: number;
  offerEndsAt?: string;
  size: string;
  worksPercent: number;
  sysReq: string;
  coverUrl: string;
  screenshots: string[];
  hidden: boolean;
  badgeMostRequested: boolean;
  badgeUpdated: boolean;
};

export type CartLine = { gameId: string; quantity: number };
export type Order = {
  id: string;
  customerName: string;
  phone: string;
  note: string;
  items: CartLine[];
  total: number;
  status: OrderStatus;
  rejectReason?: string;
  createdAt: string;
  uid?: string;
  email?: string;
  itemIds?: string[];
  couponCode?: string;
  discountPercent?: number;
};

export type Coupon = {
  code: string;
  percent: number;
  mode: "once" | "open";
  expiresAt: string;
  active: boolean;
};
export type StaffGrant = { email: string; permissions: Permission[]; active: boolean };
export type RequestItem = {
  id: string;
  title: string;
  platform: Platform;
  customer: string;
  status: "new" | "reviewed";
};
export type PopupItem = { id: string; title: string; body: string; active: boolean };
export type Announcement = { text_ar: string; text_en: string; active: boolean };
