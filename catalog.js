/**
 * ============================================================================
 *  Glassa — Catalog
 * ============================================================================
 *  - Loads public games from Firestore
 *  - Home: search, filter chips, sort, grid
 *  - Game page: carousel, info, reviews, add-to-cart, favorite, share
 *  - Reviews (write/edit/delete — only for buyers with an unlock)
 *  - Favorites (heart → users/{uid}.favorites)
 *  - Game requests (creates gameRequests/{id})
 * ============================================================================
 */

import {
  db,
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  deleteDoc
} from "./firebase.js";
import {
  t,
  formatPrice,
  pickLocalized,
  getLang
} from "./i18n.js";
import {
  el,
  icon,
  toast,
  toastSuccess,
  toastError,
  toastInfo,
  openModal,
  confirmDialog,
  skeletonGrid,
  emptyState,
  formatDate,
  formatCountdown,
  isNewGame,
  normalizeForSearch,
  cloudinaryThumb,
  cloudinaryHero,
  copyToClipboard
} from "./ui.js";
import { getUser, getProfile } from "./auth.js";

/* ============================================================================
   Module state
   ========================================================================== */

let gamesCache = [];
let favoritesSet = new Set();

/* ============================================================================
   Public API
   ========================================================================== */

export async function loadGames() {
  try {
    const ref = collection(db, "games");
    const q = query(ref, where("hidden", "==", false));
    const snap = await getDocs(q);
    gamesCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    gamesCache.sort((a, b) => {
      const ta = a.createdAt?.seconds || 0;
      const tb = b.createdAt?.seconds || 0;
      return tb - ta;
    });
    return gamesCache;
  } catch (e) {
    console.error("loadGames failed:", e);
    toastError(t("error.network"));
    return [];
  }
}

export async function getGame(gameId) {
  const cached = gamesCache.find((g) => g.id === gameId);
  if (cached) return cached;
  try {
    const snap = await getDoc(doc(db, "games", gameId));
    if (!snap.exists()) return null;
    const g = { id: snap.id, ...snap.data() };
    gamesCache.push(g);
    return g;
  } catch (e) {
    console.error("getGame failed:", e);
    return null;
  }
}

export function effectivePrice(game) {
  if (!game) return 0;
  const offer = Number(game.offerPrice);
  if (!Number.isFinite(offer) || offer < 0) return Number(game.price) || 0;
  const endsAt = game.offerEndsAt?.toDate?.();
  if (endsAt && endsAt.getTime() <= Date.now()) return Number(game.price) || 0;
  return offer;
}

export function hasActiveOffer(game) {
  if (!game) return false;
  const offer = Number(game.offerPrice);
  if (!Number.isFinite(offer) || offer < 0) return false;
  const endsAt = game.offerEndsAt?.toDate?.();
  if (endsAt && endsAt.getTime() <= Date.now()) return false;
  return offer < Number(game.price || 0);
}

export function syncFavoritesFromProfile() {
  const profile = getProfile();
  favoritesSet = new Set(Array.isArray(profile?.favorites) ? profile.favorites : []);
}

/* ============================================================================
   Favorites
   ========================================================================== */

export function isFavorite(gameId) {
  return favoritesSet.has(gameId);
}

export async function toggleFavorite(gameId) {
  const user = getUser();
  if (!user) {
    toastInfo(t("toast.loginRequired"));
    return null;
  }

  const { updateDoc } = await import("./firebase.js");

  const next = new Set(favoritesSet);
  if (next.has(gameId)) next.delete(gameId);
  else next.add(gameId);

  const arr = Array.from(next);
  try {
    await updateDoc(doc(db, "users", user.uid), { favorites: arr });
    favoritesSet = next;
    if (next.has(gameId)) toastSuccess(t("toast.addedToFav"));
    else toastSuccess(t("toast.removedFromFav"));
    return next.has(gameId);
  } catch (e) {
    console.error("toggleFavorite failed:", e);
    toastError(t("error.unknown"));
    return null;
  }
}

/* ============================================================================
   Rendering helpers
   ========================================================================== */

function starsDisplay(avg) {
  const wrap = el("div", { className: "stars", "aria-hidden": "true" });
  const rounded = Math.round(avg || 0);
  for (let i = 1; i <= 5; i++) {
    const s = icon("star", 14, `stars__star${i <= rounded ? "" : " stars__star--empty"}`);
    wrap.appendChild(s);
  }
  return wrap;
}

function platformLabel(platform) {
  return platform === "android" ? "Android" : "PC";
}

export function buildGameCard(game) {
  const card = el("a", {
    className: "card",
    href: `#/game/${encodeURIComponent(game.id)}`
  });

  const cover = el("div", { className: "card__cover" });
  if (game.coverUrl) {
    const img = el("img", {
      src: cloudinaryThumb(game.coverUrl, 600),
      alt: pickLocalized(game.title_ar, game.title_en),
      loading: "lazy",
      width: "600",
      height: "375"
    });
    img.addEventListener("error", () => img.remove());
    cover.appendChild(img);
  }
  card.appendChild(cover);

  const badges = el("div", { className: "card__badges" });
  if (isNewGame(game.createdAt)) {
    badges.appendChild(el("span", { className: "badge badge--new", textContent: t("catalog.badge.new") }));
  }
  if (hasActiveOffer(game)) {
    badges.appendChild(el("span", { className: "badge badge--offer", textContent: t("catalog.badge.offer") }));
  }
  if (game.badgeMostRequested) {
    badges.appendChild(el("span", { className: "badge badge--popular", textContent: t("catalog.badge.mostRequested") }));
  }
  if (game.badgeUpdated) {
    badges.appendChild(el("span", { className: "badge badge--updated", textContent: t("catalog.badge.updated") }));
  }
  if (badges.childNodes.length) card.appendChild(badges);

  const fav = el("button", {
    type: "button",
    className: `card__fav${isFavorite(game.id) ? " is-active" : ""}`,
    "aria-label": t("nav.favorites"),
    onClick: async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const now = await toggleFavorite(game.id);
      if (now === true) fav.classList.add("is-active");
      if (now === false) fav.classList.remove("is-active");
    }
  }, icon("heart", 18));
  card.appendChild(fav);

  const body = el("div", { className: "card__body" });
  body.appendChild(el("div", {
    className: "card__title",
    textContent: pickLocalized(game.title_ar, game.title_en) || "—"
  }));

  const meta = el("div", { className: "card__meta" });
  meta.appendChild(el("span", { textContent: platformLabel(game.platform) }));
  meta.appendChild(starsDisplay(game.avgRating || 0));
  body.appendChild(meta);

  const priceRow = el("div", { className: "card__price" });
  if (hasActiveOffer(game)) {
    priceRow.appendChild(el("span", { className: "card__price-old", textContent: formatPrice(game.price) }));
    priceRow.appendChild(el("span", { className: "card__price-new", textContent: formatPrice(game.offerPrice) }));
  } else {
    priceRow.appendChild(el("span", { className: "card__price-new", textContent: formatPrice(game.price) }));
  }
  body.appendChild(priceRow);

  card.appendChild(body);
  return card;
}

function buildChips(active, onChange) {
  const chips = el("div", { className: "chips" });
  const items = [
    { id: "all", label: t("common.all") },
    { id: "pc", label: t("common.pc") },
    { id: "android", label: t("common.android") },
    { id: "offers", label: t("common.offers") }
  ];
  for (const it of items) {
    const chip = el("button", {
      type: "button",
      className: `chip${active === it.id ? " is-active" : ""}`,
      textContent: it.label,
      onClick: () => onChange(it.id)
    });
    chips.appendChild(chip);
  }
  return chips;
}

function buildSort(current, onChange) {
  const wrap = el("select", {
    className: "select",
    "aria-label": t("sort.label"),
    onChange: (e) => onChange(e.target.value)
  });
  const options = [
    { v: "newest", l: t("sort.newest") },
    { v: "topRated", l: t("sort.topRated") },
    { v: "priceLow", l: t("sort.priceLow") },
    { v: "priceHigh", l: t("sort.priceHigh") }
  ];
  for (const o of options) {
    const opt = el("option", { value: o.v, textContent: o.l });
    if (o.v === current) opt.selected = true;
    wrap.appendChild(opt);
  }
  return wrap;
}

function applyFilters({ filter, search, sort }) {
  const needle = normalizeForSearch(search || "");
  let list = gamesCache.slice();

  if (filter === "pc") list = list.filter((g) => g.platform === "pc");
  if (filter === "android") list = list.filter((g) => g.platform === "android");
  if (filter === "offers") list = list.filter((g) => hasActiveOffer(g));

  if (needle) {
    list = list.filter((g) => {
      const a = normalizeForSearch(g.title_ar);
      const e = normalizeForSearch(g.title_en);
      return a.includes(needle) || e.includes(needle);
    });
  }

  switch (sort) {
    case "topRated":
      list.sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0));
      break;
    case "priceLow":
      list.sort((a, b) => effectivePrice(a) - effectivePrice(b));
      break;
    case "priceHigh":
      list.sort((a, b) => effectivePrice(b) - effectivePrice(a));
      break;
    case "newest":
    default:
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  }
  return list;
}

/* ============================================================================
   Home view
   ========================================================================== */

export async function renderHome(container) {
  const state = { filter: "all", search: "", sort: "newest" };

  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("app.name") }));
  header.appendChild(el("div", { className: "page-header__subtitle", textContent: t("app.tagline") }));
  container.appendChild(header);

  const searchWrap = el("div", { className: "field", style: { marginBottom: "12px" } });
  const searchInput = el("input", {
    className: "input",
    type: "search",
    placeholder: t("catalog.search.placeholder"),
    autocomplete: "off",
    onInput: (e) => {
      state.search = e.target.value;
      rerender();
    }
  });
  searchWrap.appendChild(searchInput);
  container.appendChild(searchWrap);

  const controls = el("div", { className: "row row--between", style: { marginBottom: "12px", gap: "8px" } });
  const chipsSlot = el("div", { className: "grow" });
  const sortSlot  = el("div", {}, buildSort(state.sort, (v) => { state.sort = v; rerender(); }));
  controls.appendChild(chipsSlot);
  controls.appendChild(sortSlot);
  container.appendChild(controls);

  const resultsSlot = el("div");
  container.appendChild(resultsSlot);

  function paintChips() {
    chipsSlot.innerHTML = "";
    chipsSlot.appendChild(buildChips(state.filter, (id) => {
      state.filter = id;
      paintChips();
      rerender();
    }));
  }
  paintChips();

  function rerender() {
    resultsSlot.innerHTML = "";

    const list = applyFilters(state);

    if (!gamesCache.length) {
      resultsSlot.appendChild(emptyState({
        iconName: "gamepad",
        title: t("catalog.emptyAll")
      }));
      return;
    }
    if (!list.length) {
      resultsSlot.appendChild(emptyState({
        iconName: "search",
        title: t("catalog.empty")
      }));
      return;
    }

    const grid = el("div", { className: "grid-games" });
    for (const g of list) grid.appendChild(buildGameCard(g));
    resultsSlot.appendChild(grid);
  }

  resultsSlot.appendChild(skeletonGrid(6));

  await ensureGamesLoadedWithRatings();
  rerender();

  return () => {};
}

let ratingsLoaded = false;

async function ensureGamesLoadedWithRatings() {
  if (ratingsLoaded) return;
  if (!gamesCache.length) await loadGames();
  syncFavoritesFromProfile();

  try {
    const snap = await getDocs(collection(db, "reviews"));
    const agg = new Map();
    snap.forEach((d) => {
      const r = d.data() || {};
      const g = r.gameId;
      const s = Number(r.stars) || 0;
      if (!g) return;
      const cur = agg.get(g) || { sum: 0, count: 0 };
      cur.sum += s;
      cur.count += 1;
      agg.set(g, cur);
    });
    for (const g of gamesCache) {
      const a = agg.get(g.id);
      if (a && a.count) {
        g.avgRating = a.sum / a.count;
        g.ratingCount = a.count;
      } else {
        g.avgRating = 0;
        g.ratingCount = 0;
      }
    }
  } catch (e) {
    console.error("ratings load failed:", e);
  }

  ratingsLoaded = true;
}

export function resetCatalogCache() {
  gamesCache = [];
  favoritesSet = new Set();
  ratingsLoaded = false;
}

/* ============================================================================
   Game page
   ========================================================================== */

export async function renderGame(container, gameId) {
  container.appendChild(skeletonGrid(2));

  const game = await getGame(gameId);
  container.innerHTML = "";
  if (!game) {
    container.appendChild(emptyState({
      iconName: "info",
      title: t("catalog.notFound")
    }));
    return () => {};
  }

  const reviews = await loadReviewsForGame(game.id);
  const avg = reviews.length
    ? reviews.reduce((s, r) => s + (r.stars || 0), 0) / reviews.length
    : 0;

  const hero = el("div", { className: "game-hero" });
  const shots = Array.isArray(game.screenshots) ? game.screenshots.slice(0, 8) : [];
  const heroImages = shots.length ? shots : [game.coverUrl].filter(Boolean);

  const carouselWrap = el("div");
  if (heroImages.length) {
    const carousel = el("div", { className: "carousel" });
    heroImages.forEach((url, i) => {
      const slide = el("div", { className: "carousel__slide" });
      const img = el("img", {
        src: cloudinaryHero(url, 1200),
        alt: `${pickLocalized(game.title_ar, game.title_en)} — ${i + 1}`,
        loading: i === 0 ? "eager" : "lazy",
        width: "1200",
        height: "750"
      });
      img.addEventListener("error", () => img.remove());
      slide.appendChild(img);
      carousel.appendChild(slide);
    });
    carouselWrap.appendChild(carousel);

    const dots = el("div", { className: "carousel__dots" });
    heroImages.forEach((_, i) => dots.appendChild(el("span", { className: `carousel__dot${i === 0 ? " is-active" : ""}` })));
    carouselWrap.appendChild(dots);

    carousel.addEventListener("scroll", () => {
      const w = carousel.clientWidth || 1;
      const idx = Math.round(carousel.scrollLeft / w);
      Array.from(dots.children).forEach((d, i) => d.classList.toggle("is-active", i === idx));
    }, { passive: true });
  } else {
    carouselWrap.appendChild(el("div", { className: "skel", style: { aspectRatio: "16 / 10", borderRadius: "22px" } }));
  }
  hero.appendChild(carouselWrap);

  const right = el("div", { className: "glass glass--pad stack" });

  const title = el("h1", { style: { fontSize: "var(--fs-2xl)", lineHeight: "1.2", fontWeight: "700" } });
  title.textContent = pickLocalized(game.title_ar, game.title_en) || "—";
  right.appendChild(title);

  const meta = el("div", { className: "row row--wrap", style: { gap: "8px" } });
  meta.appendChild(el("span", { className: "pill", textContent: platformLabel(game.platform) }));
  if (game.size) meta.appendChild(el("span", { className: "pill", textContent: `${t("catalog.size")}: ${game.size}` }));
  if (Number.isFinite(Number(game.worksPercent))) {
    meta.appendChild(el("span", { className: "pill pill--success", textContent: t("catalog.works", { n: game.worksPercent }) }));
  }
  right.appendChild(meta);

  if (reviews.length) {
    const r = el("div", { className: "row", style: { gap: "8px" } });
    r.appendChild(starsDisplay(avg));
    r.appendChild(el("span", { className: "text-xs text-muted", textContent: t("catalog.ratingAvg", { avg: avg.toFixed(1), count: reviews.length }) }));
    right.appendChild(r);
  }

  const priceBox = el("div", { className: "row row--wrap", style: { gap: "12px", alignItems: "baseline" } });
  if (hasActiveOffer(game)) {
    priceBox.appendChild(el("span", { className: "card__price-old", textContent: formatPrice(game.price) }));
    priceBox.appendChild(el("span", { className: "card__price-new", style: { fontSize: "var(--fs-2xl)" }, textContent: formatPrice(game.offerPrice) }));
    const endsAt = game.offerEndsAt?.toDate?.();
    if (endsAt) {
      const cd = el("span", { className: "countdown" });
      const tick = () => { cd.textContent = `${t("catalog.endIn")} ${formatCountdown(endsAt)}`; };
      tick();
      setInterval(tick, 1000);
      priceBox.appendChild(cd);
    } else {
      priceBox.appendChild(el("span", { className: "pill pill--danger", textContent: t("catalog.badge.offer") }));
    }
  } else {
    priceBox.appendChild(el("span", { className: "card__price-new", style: { fontSize: "var(--fs-2xl)" }, textContent: formatPrice(game.price) }));
  }
  right.appendChild(priceBox);

  const actions = el("div", { className: "row", style: { gap: "8px", flexWrap: "wrap" } });

  const addBtn = el("button", {
    className: "btn btn--glass",
    type: "button",
    onClick: async () => {
      const { addToCart, isInCart } = await import("./cart.js");
      if (isInCart(game.id)) {
        toastInfo(t("catalog.inCart"));
        return;
      }
      const ok = await addToCart(game);
      if (ok) toastSuccess(t("toast.addedToCart"));
    }
  });
  addBtn.appendChild(icon("cart", 18));
  addBtn.appendChild(el("span", { textContent: t("catalog.addToCart") }));

  const buyBtn = el("button", {
    className: "btn btn--primary",
    type: "button",
    onClick: async () => {
      const { addToCart, goToCheckout } = await import("./cart.js");
      const ok = await addToCart(game);
      if (ok) goToCheckout();
    }
  });
  buyBtn.appendChild(icon("check", 18));
  buyBtn.appendChild(el("span", { textContent: t("catalog.buyNow") }));

  actions.appendChild(addBtn);
  actions.appendChild(buyBtn);
  right.appendChild(actions);

  const extras = el("div", { className: "row", style: { gap: "8px" } });

  const fav = el("button", {
    type: "button",
    className: `btn btn--glass${isFavorite(game.id) ? " is-active" : ""}`,
    onClick: async () => {
      const now = await toggleFavorite(game.id);
      fav.classList.toggle("is-active", now === true);
    }
  });
  fav.appendChild(icon("heart", 18));
  fav.appendChild(el("span", { textContent: t("nav.favorites") }));

  const share = el("button", {
    type: "button",
    className: "btn btn--glass",
    onClick: async () => {
      const url = `${location.origin}${location.pathname}#/game/${encodeURIComponent(game.id)}`;
      const title = pickLocalized(game.title_ar, game.title_en);
      try {
        if (navigator.share) {
          await navigator.share({ title, url });
        } else {
          const ok = await copyToClipboard(url);
          if (ok) toastSuccess(t("toast.linkCopied"));
        }
      } catch (_) {}
    }
  });
  share.appendChild(icon("share", 18));
  share.appendChild(el("span", { textContent: t("catalog.share") }));

  extras.appendChild(fav);
  extras.appendChild(share);
  right.appendChild(extras);

  hero.appendChild(right);
  container.appendChild(hero);

  const desc = pickLocalized(game.desc_ar, game.desc_en);
  if (desc) {
    const box = el("div", { className: "glass glass--pad stack", style: { marginBottom: "16px" } });
    box.appendChild(el("h2", { style: { fontSize: "var(--fs-lg)", fontWeight: "700" }, textContent: t("catalog.description") }));
    box.appendChild(el("p", { style: { whiteSpace: "pre-line", color: "var(--text-2)" }, textContent:ilter((g) => hasActiveOffer(g));

  if (needle) {
    list = list.filter((g) => {
      const a = normalizeForSearch(g.title_ar);
      const e = normalizeForSearch(g.title_en);
      return a.includes(needle) || e.includes(needle);
    });
  }

  switch (sort) {
    case "topRated":
      list.sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0));
      break;
    case "priceLow":
      list.sort((a, b) => effectivePrice(a) - effectivePrice(b));
      break;
    case "priceHigh":
      list.sort((a, b) => effectivePrice(b) - effectivePrice(a));
      break;
    case "newest":
    default:
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  }
  return list;
}

/* ============================================================================
   Home view
   ========================================================================== */

/**
 * Render the home page into `container`.
 * @param {HTMLElement} container
 */
export async function renderHome(container) {
  // Local view state
  const state = { filter: "all", search: "", sort: "newest" };

  // Page header
  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("app.name") }));
  header.appendChild(el("div", { className: "page-header__subtitle", textContent: t("app.tagline") }));
  container.appendChild(header);

  // Search
  const searchWrap = el("div", { className: "field", style: { marginBottom: "12px" } });
  const searchInput = el("input", {
    className: "input",
    type: "search",
    placeholder: t("catalog.search.placeholder"),
    autocomplete: "off",
    onInput: (e) => {
      state.search = e.target.value;
      rerender();
    }
  });
  searchWrap.appendChild(searchInput);
  container.appendChild(searchWrap);

  // Chips + sort row
  const controls = el("div", { className: "row row--between", style: { marginBottom: "12px", gap: "8px" } });
  const chipsSlot = el("div", { className: "grow" });
  const sortSlot  = el("div", {}, buildSort(state.sort, (v) => { state.sort = v; rerender(); }));
  controls.appendChild(chipsSlot);
  controls.appendChild(sortSlot);
  container.appendChild(controls);

  // Results
  const resultsSlot = el("div");
  container.appendChild(resultsSlot);

  function paintChips() {
    chipsSlot.innerHTML = "";
    chipsSlot.appendChild(buildChips(state.filter, (id) => { state.filter = id; paintChips(); rerender(); }));
  }
  paintChips();

  function rerender() {
    // Loading
    resultsSlot.innerHTML = "";
    resultsSlot.appendChild(skeletonGrid(6));

    const list = applyFilters(state);
    resultsSlot.innerHTML = "";

    if (!gamesCache.length) {
      resultsSlot.appendChild(emptyState({
        iconName: "gamepad",
        title: t("catalog.emptyAll")
      }));
      return;
    }
    if (!list.length) {
      resultsSlot.appendChild(emptyState({
        iconName: "search",
        title: t("catalog.empty")
      }));
      return;
    }

    const grid = el("div", { className: "grid-games" });
    for (const g of list) grid.appendChild(buildGameCard(g));
    resultsSlot.appendChild(grid);
  }

  // First paint
  resultsSlot.appendChild(skeletonGrid(6));

  // Load games (with rating aggregates)
  await ensureGamesLoadedWithRatings();
  rerender();

  // React to login/logout so heart state stays in sync
  return () => {};
}

/**
 * Load games and attach avgRating / ratingCount from reviews.
 * Reviews are read per game (single-field query, no composite index).
 */
let ratingsLoaded = false;
async function ensureGamesLoadedWithRatings() {
  if (ratingsLoaded) return;
  if (!gamesCache.length) await loadGames();
  syncFavoritesFromProfile();

  // Fetch all reviews once (public read).
  try {
    const snap = await getDocs(collection(db, "reviews"));
    const agg = new Map(); // gameId → { sum, count }
    snap.forEach((d) => {
      const r = d.data() || {};
      const g = r.gameId;
      const s = Number(r.stars) || 0;
      if (!g) return;
      const cur = agg.get(g) || { sum: 0, count: 0 };
      cur.sum += s;
      cur.count += 1;
      agg.set(g, cur);
    });
    for (const g of gamesCache) {
      const a = agg.get(g.id);
      if (a && a.count) {
        g.avgRating = a.sum / a.count;
        g.ratingCount = a.count;
      } else {
        g.avgRating = 0;
        g.ratingCount = 0;
      }
    }
  } catch (e) {
    console.error("ratings load failed:", e);
  }

  ratingsLoaded = true;
}

/** Invalidate caches on logout / data change. */
export function resetCatalogCache() {
  gamesCache = [];
  favoritesSet = new Set();
  ratingsLoaded = false;
  if (gamesUnsub) { try { gamesUnsub(); } catch (_) {} gamesUnsub = null; }
}

/* ============================================================================
   Game page
   ========================================================================== */

/**
 * Render the game page.
 * @param {HTMLElement} container
 * @param {string} gameId
 * @returns {Promise<() => void>} cleanup
 */
export async function renderGame(container, gameId) {
  container.appendChild(skeletonGrid(2));

  const game = await getGame(gameId);
  container.innerHTML = "";
  if (!game) {
    container.appendChild(emptyState({
      iconName: "info",
      title: t("catalog.notFound")
    }));
    return () => {};
  }

  // Reviews (public read of a single-field query).
  const reviews = await loadReviewsForGame(game.id);
  const avg = reviews.length
    ? reviews.reduce((s, r) => s + (r.stars || 0), 0) / reviews.length
    : 0;

  // ── Screenshots carousel
  const hero = el("div", { className: "game-hero" });
  const shots = Array.isArray(game.screenshots) ? game.screenshots.slice(0, 8) : [];
  const heroImages = shots.length ? shots : [game.coverUrl].filter(Boolean);

  const carouselWrap = el("div");
  if (heroImages.length) {
    const carousel = el("div", { className: "carousel" });
    heroImages.forEach((url, i) => {
      const slide = el("div", { className: "carousel__slide" });
      const img = el("img", {
        src: cloudinaryHero(url, 1200),
        alt: `${pickLocalized(game.title_ar, game.title_en)} — ${i + 1}`,
        loading: i === 0 ? "eager" : "lazy",
        width: "1200",
        height: "750"
      });
      img.addEventListener("error", () => img.remove());
      slide.appendChild(img);
      carousel.appendChild(slide);
    });
    carouselWrap.appendChild(carousel);

    const dots = el("div", { className: "carousel__dots" });
    heroImages.forEach((_, i) => dots.appendChild(el("span", { className: `carousel__dot${i === 0 ? " is-active" : ""}` })));
    carouselWrap.appendChild(dots);

    carousel.addEventListener("scroll", () => {
      const w = carousel.clientWidth || 1;
      const idx = Math.round(carousel.scrollLeft / w);
      Array.from(dots.children).forEach((d, i) => d.classList.toggle("is-active", i === idx));
    }, { passive: true });
  } else {
    const placeholder = el("div", { className: "skel", style: { aspectRatio: "16 / 10", borderRadius: "22px" } });
    carouselWrap.appendChild(placeholder);
  }
  hero.appendChild(carouselWrap);

  // ── Right column: title, meta, actions
  const right = el("div", { className: "glass glass--pad stack" });

  const title = el("h1", { style: { fontSize: "var(--fs-2xl)", lineHeight: "1.2", fontWeight: "700" } });
  title.textContent = pickLocalized(game.title_ar, game.title_en) || "—";
  right.appendChild(title);

  const meta = el("div", { className: "row row--wrap", style: { gap: "8px" } });
  meta.appendChild(el("span", { className: "pill", textContent: platformLabel(game.platform) }));
  if (game.size) meta.appendChild(el("span", { className: "pill", textContent: `${t("catalog.size")}: ${game.size}` }));
  if (Number.isFinite(Number(game.worksPercent))) {
    meta.appendChild(el("span", { className: "pill pill--success", textContent: t("catalog.works", { n: game.worksPercent }) }));
  }
  right.appendChild(meta);

  // Stars + count
  if (reviews.length) {
    const r = el("div", { className: "row", style: { gap: "8px" } });
    r.appendChild(starsDisplay(avg));
    r.appendChild(el("span", { className: "text-xs text-muted", textContent: t("catalog.ratingAvg", { avg: avg.toFixed(1), count: reviews.length }) }));
    right.appendChild(r);
  }

  // Price
  const priceBox = el("div", { className: "row row--wrap", style: { gap: "12px", alignItems: "baseline" } });
  if (hasActiveOffer(game)) {
    priceBox.appendChild(el("span", { className: "card__price-old", textContent: formatPrice(game.price) }));
    priceBox.appendChild(el("span", { className: "card__price-new", style: { fontSize: "var(--fs-2xl)" }, textContent: formatPrice(game.offerPrice) }));
    const endsAt = game.offerEndsAt?.toDate?.();
    if (endsAt) {
      const cd = el("span", { className: "countdown" });
      const tick = () => { cd.textContent = `${t("catalog.endIn")} ${formatCountdown(endsAt)}`; };
      tick();
      const id = setInterval(tick, 1000);
      // Cleanup on navigation: rely on GC; the interval dies with the node
      // when its parent is removed (no references kept outside).
      priceBox.appendChild(cd);
    } else {
      priceBox.appendChild(el("span", { className: "pill pill--danger", textContent: t("catalog.badge.offer") }));
    }
  } else {
    priceBox.appendChild(el("span", { className: "card__price-new", style: { fontSize: "var(--fs-2xl)" }, textContent: formatPrice(game.price) }));
  }
  right.appendChild(priceBox);

  // Add to cart / buy now
  const actions = el("div", { className: "row", style: { gap: "8px", flexWrap: "wrap" } });

  const addBtn = el("button", {
    className: "btn btn--glass",
    type: "button",
    onClick: async () => {
      const { addToCart, isInCart } = await import("./cart.js");
      if (isInCart(game.id)) {
        toastInfo(t("catalog.inCart"));
        return;
      }
      const ok = await addToCart(game);
      if (ok) toastSuccess(t("toast.addedToCart"));
    }
  });
  addBtn.appendChild(icon("cart", 18));
  addBtn.appendChild(el("span", { textContent: t("catalog.addToCart") }));

  const buyBtn = el("button", {
    className: "btn btn--primary",
    type: "button",
    onClick: async () => {
      const { addToCart, goToCheckout } = await import("./cart.js");
      const ok = await addToCart(game);
      if (ok) goToCheckout();
    }
  });
  buyBtn.appendChild(icon("check", 18));
  buyBtn.appendChild(el("span", { textContent: t("catalog.buyNow") }));

  actions.appendChild(addBtn);
  actions.appendChild(buyBtn);
  right.appendChild(actions);

  // Favorite + share
  const extras = el("div", { className: "row", style: { gap: "8px" } });

  const fav = el("button", {
    type: "button",
    className: `btn btn--glass${isFavorite(game.id) ? " is-active" : ""}`,
    onClick: async () => {
      const now = await toggleFavorite(game.id);
      fav.classList.toggle("is-active", now === true);
    }
  });
  fav.appendChild(icon("heart", 18));
  fav.appendChild(el("span", { textContent: t("nav.favorites") }));

  const share = el("button", {
    type: "button",
    className: "btn btn--glass",
    onClick: async () => {
      const url = `${location.origin}${location.pathname}#/game/${encodeURIComponent(game.id)}`;
      const title = pickLocalized(game.title_ar, game.title_en);
      try {
        if (navigator.share) {
          await navigator.share({ title, url });
        } else {
          const ok = await copyToClipboard(url);
          if (ok) toastSuccess(t("toast.linkCopied"));
        }
      } catch (_) {}
    }
  });
  share.appendChild(icon("share", 18));
  share.appendChild(el("span", { textContent: t("catalog.share") }));

  extras.appendChild(fav);
  extras.appendChild(share);
  right.appendChild(extras);

  hero.appendChild(right);
  container.appendChild(hero);

  // ── Description
  const desc = pickLocalized(game.desc_ar, game.desc_en);
  if (desc) {
    const box = el("div", { className: "glass glass--pad stack", style: { marginBottom: "16px" } });
    box.appendChild(el("h2", { style: { fontSize: "var(--fs-lg)", fontWeight: "700" }, textContent: t("catalog.description") }));
    box.appendChild(el("p", { style: { whiteSpace: "pre-line", color: "var(--text-2)" }, textContent: desc }));
    container.appendChild(box);
  }

  // ── System requirements (PC only)
  if (game.platform === "pc" && game.sysReq) {
    const box = el("div", { className: "glass glass--pad stack", style: { marginBottom: "16px" } });
    box.appendChild(el("h2", { style: { fontSize: "var(--fs-lg)", fontWeight: "700" }, textContent: t("catalog.sysReq") }));
    box.appendChild(el("p", { style: { whiteSpace: "pre-line", color: "var(--text-2)" }, textContent: game.sysReq }));
    container.appendChild(box);
  }

  // ── Reviews
  const reviewsBox = el("div", { className: "glass glass--pad stack", style: { marginBottom: "16px" } });
  reviewsBox.appendChild(el("h2", { style: { fontSize: "var(--fs-lg)", fontWeight: "700" }, textContent: t("catalog.reviews") }));

  if (!reviews.length) {
    reviewsBox.appendChild(el("p", { className: "text-muted text-sm", textContent: t("catalog.noReviews") }));
  } else {
    const list = el("div", { className: "stack stack--sm" });
    for (const r of reviews.slice().sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))) {
      const row = el("div", { className: "glass glass--pad" });
      const head = el("div", { className: "row row--between" });
      head.appendChild(el("div", { className: "text-sm text-bold", textContent: r.name || "—" }));
      head.appendChild(starsDisplay(r.stars));
      row.appendChild(head);
      if (r.comment) row.appendChild(el("p", { className: "text-sm text-subtle", style: { marginTop: "6px", whiteSpace: "pre-line" }, textContent: r.comment }));
      row.appendChild(el("div", { className: "text-xs text-muted", style: { marginTop: "6px" }, textContent: formatDate(r.createdAt) }));
      list.appendChild(row);
    }
    reviewsBox.appendChild(list);
  }

  // Write-review block (only for owners of the game)
  const writeSlot = el("div");
  reviewsBox.appendChild(writeSlot);
  await mountWriteReview(writeSlot, game, reviews);
  container.appendChild(reviewsBox);

  return () => {};
}

async function loadReviewsForGame(gameId) {
  try {
    const q = query(collection(db, "reviews"), where("gameId", "==", gameId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error("loadReviews failed:", e);
    return [];
  }
}

async function hasUnlock(gameId) {
  const user = getUser();
  if (!user) return false;
  try {
    const snap = await getDoc(doc(db, "unlocks", `${user.uid}_${gameId}`));
    return snap.exists();
  } catch (_) {
    return false;
  }
}

async function mountWriteReview(container, game, reviews) {
  const user = getUser();
  if (!user) return;

  const owns = await hasUnlock(game.id);
  if (!owns) return;

  const myReview = reviews.find((r) => r.uid === user.uid);

  const box = el("div", { className: "stack", style: { marginTop: "16px", borderTop: "1px solid var(--divider)", paddingTop: "16px" } });
  box.appendChild(el("h3", { style: { fontSize: "var(--fs-md)", fontWeight: "600" }, textContent: myReview ? t("catalog.editReview") : t("catalog.writeReview") }));

  // Stars input
  let stars = myReview?.stars || 0;
  const starsRow = el("div", { className: "stars-input", role: "radiogroup", "aria-label": t("catalog.starsLabel") });
  const starButtons = [];
  for (let i = 1; i <= 5; i++) {
    const b = el("button", {
      type: "button",
      className: `stars-input__btn${i <= stars ? " is-active" : ""}`,
      "aria-label": String(i),
      onClick: () => {
        stars = i;
        starButtons.forEach((sb, idx) => sb.classList.toggle("is-active", idx < i));
      }
    }, icon("star", 26));
    starButtons.push(b);
    starsRow.appendChild(b);
  }
  box.appendChild(starsRow);

  // Comment
  const ta = el("textarea", {
    className: "textarea",
    maxLength: 300,
    placeholder: t("catalog.reviewPlaceholder")
  });
  ta.value = myReview?.comment || "";
  box.appendChild(ta);

  // Actions
  const actions = el("div", { className: "row", style: { gap: "8px" } });

  const submit = el("button", {
    className: "btn btn--primary",
    type: "button",
    textContent: t("common.save")
  });
  submit.addEventListener("click", async () => {
    if (!stars) return;
    submit.disabled = true;
    try {
      const profile = getProfile();
      await setDoc(doc(db, "reviews", `${game.id}_${user.uid}`), {
        gameId: game.id,
        uid: user.uid,
        name: profile?.name || user.displayName || "User",
        stars,
        comment: String(ta.value || "").slice(0, 300),
        createdAt: myReview?.createdAt || serverTimestamp()
      }, { merge: true });
      toastSuccess(t("catalog.reviewPosted"));
      // Soft reload of the page section
      location.hash = `#/game/${encodeURIComponent(game.id)}`;
    } catch (e) {
      console.error("save review failed:", e);
      toastError(t("error.permission"));
    } finally {
      submit.disabled = false;
    }
  });
  actions.appendChild(submit);

  if (myReview) {
    const del = el("button", {
      className: "btn btn--ghost",
      type: "button",
      textContent: t("catalog.deleteReview")
    });
    del.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: t("catalog.deleteReview"),
        message: "",
        confirmLabel: t("common.delete"),
        danger: true
      });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "reviews", `${game.id}_${user.uid}`));
        toastSuccess(t("catalog.reviewDeleted"));
        location.hash = `#/game/${encodeURIComponent(game.id)}`;
      } catch (e) {
        console.error("delete review failed:", e);
        toastError(t("error.permission"));
      }
    });
    actions.appendChild(del);
  }

  box.appendChild(actions);
  container.appendChild(box);
}

/* ============================================================================
   Favorites page
   ========================================================================== */

export async function renderFavorites(container) {
  const header = el("div", { className: "page-header" });
  header.appendChild(el("h1", { className: "page-header__title", textContent: t("nav.favorites") }));
  container.appendChild(header);

  const user = getUser();
  if (!user) {
    container.appendChild(emptyState({
      iconName: "user",
      title: t("catalog.mustLogin"),
      action: { label: t("nav.login"), onClick: () => { location.hash = "#/login"; } }
    }));
    return;
  }

  container.appendChild(skeletonGrid(4));
  if (!gamesCache.length) await ensureGamesLoadedWithRatings();
  syncFavoritesFromProfile();

  container.innerHTML = "";
  container.appendChild(header);

  const favIds = Array.from(favoritesSet);
  const list = gamesCache.filter((g) => favIds.includes(g.id));

  if (!list.length) {
    container.appendChild(emptyState({
      iconName: "heart",
      title: t("catalog.emptyAll")
    }));
    return;
  }

  const grid = el("div", { className: "grid-games" });
  for (const g of list) grid.appendChild(buildGameCard(g));
  container.appendChild(grid);
}

/* ============================================================================
   Game request modal
   ========================================================================== */

export function openGameRequestModal() {
  const user = getUser();
  if (!user) {
    toastInfo(t("toast.loginRequired"));
    location.hash = "#/login";
    return;
  }

  const body = el("div");
  const nameField = el("div", { className: "field" });
  nameField.appendChild(el("label", { className: "field__label", textContent: t("catalog.requestModal.name") }));
  const nameInput = el("input", { className: "input", maxLength: 80 });
  nameField.appendChild(nameInput);
  body.appendChild(nameField);

  const noteField = el("div", { className: "field" });
  noteField.appendChild(el("label", { className: "field__label", textContent: t("catalog.requestModal.note") }));
  const noteInput = el("textarea", { className: "textarea", maxLength: 300 });
  noteField.appendChild(noteInput);
  body.appendChild(noteField);

  openModal({
    title: t("catalog.requestModal.title"),
    body,
    actions: [
      { label: t("common.cancel"), variant: "ghost" },
      {
        label: t("catalog.requestModal.submit"),
        variant: "primary",
        onClick: async () => {
          const gameName = nameInput.value.trim();
          if (!gameName) { toastError(t("common.required")); return false; }
          try {
            const profile = getProfile();
            await addDoc(collection(db, "gameRequests"), {
              uid: user.uid,
              userName: profile?.name || user.displayName || "User",
              gameName,
              note: noteInput.value.trim().slice(0, 300),
              status: "new",
              createdAt: serverTimestamp()
            });
            toastSuccess(t("catalog.requestModal.sent"));
          } catch (e) {
            console.error("request game failed:", e);
            toastError(t("catalog.requestModal.error"));
            return false;
          }
        }
      }
    ]
  });
}
