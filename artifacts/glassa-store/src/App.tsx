import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import heroArt from './assets/glassa-world.jpg';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowDownUp, ArrowLeft, ArrowRight, BadgeCheck, Bell, Check, CheckCircle2, ChevronDown,
  CircleHelp, Clock3, Download, Eye, EyeOff, Filter, Gamepad2, Heart, Languages, LayoutDashboard,
  LockKeyhole, LogIn, Mail, Minus, PackageCheck, Plus, Search, ShieldCheck, ShoppingBag,
  ShoppingCart, Sparkles, Tag, Trash2, UserRound, Users, X, XCircle,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useRoute, Router as WouterRouter } from 'wouter';
import {
  type Announcement, type CartLine, type Coupon, type Game, type Order, type Permission,
  type PopupItem, type RequestItem, type StaffGrant,
} from './lib/store';
import {
  getUserProfile, isOwnerUser, refreshEmailVerification, resetPassword, saveFavorites,
  sendVerificationEmail, signIn, signOutUser, signUp, watchAuth, watchUserProfile,
  type UserProfile,
} from './lib/auth-service';
import {
  createOrder, deleteGame, getManagedDownloadUrl, listCoupons, markOrderPaid, rejectOrder,
  saveGame, setGameVisibility, updateGame, validateCoupon, watchGames, watchOrders,
  type GameDraft, type Order as FirebaseOrder,
} from './lib/store-service';
import {
  canViewOrders, deleteStaff, deactivateStaff, listStaff, saveStaffGrant, watchStaff,
  hasStaffPermission, EMPTY_STAFF_PERMISSIONS, type StaffGrant as FirebaseStaffGrant,
  type StaffPermission,
} from './lib/staff-service';
import {
  markRequestDone, removeGameRequest, removePopup, saveAnnouncement, saveCoupon, savePopup,
  setPopupActive, submitGameRequest, watchAnnouncement, watchGameRequests, watchPopups,
} from './lib/admin-service';
import {
  fromFirebaseAnnouncement, fromFirebaseCoupon, fromFirebaseGame, fromFirebaseOrder,
  fromFirebasePopup, fromFirebaseRequest, fromFirebaseStaff,
} from './lib/store-adapters';
import { auth, db } from './lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { uploadGameImage } from './lib/media-service';

const queryClient = new QueryClient();
type Lang = 'ar' | 'en';
type StoreState = {
  user: FirebaseUser | null; profile: UserProfile | null; authLoading: boolean; isOwner: boolean;
  staffGrant: FirebaseStaffGrant | null; refreshStaff: () => Promise<void>; refreshCoupons: () => Promise<void>;
  lang: Lang; setLang: (lang: Lang) => void; games: Game[]; setGames: (g: Game[]) => void;
  cart: CartLine[]; setCart: (lines: CartLine[]) => void; favorites: string[]; setFavorites: (ids: string[]) => void;
  orders: Order[]; setOrders: (orders: Order[]) => void; coupons: Coupon[]; setCoupons: (coupons: Coupon[]) => void;
  staff: StaffGrant[]; setStaff: (staff: StaffGrant[]) => void; requests: RequestItem[]; setRequests: (r: RequestItem[]) => void;
  popups: PopupItem[]; setPopups: (p: PopupItem[]) => void; announcement: Announcement; setAnnouncement: (a: Announcement) => void;
  toast: string; notify: (message: string) => void;
};
const StoreContext = createContext<StoreState | null>(null);
function useStore() { const value = useContext(StoreContext); if (!value) throw new Error('Store provider missing'); return value; }
function usePersisted<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(`glassa:${key}`); return raw ? JSON.parse(raw) as T : initial; } catch { return initial; }
  });
  const update = (next: T) => { setValue(next); try { localStorage.setItem(`glassa:${key}`, JSON.stringify(next)); } catch { /* local preview only */ } };
  return [value, update];
}
function StoreProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = usePersisted<Lang>('language', 'ar');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [staffGrant, setStaffGrant] = useState<FirebaseStaffGrant | null>(null);
  const isOwner = isOwnerUser(user);
  const [games, setGames] = useState<Game[]>([]);
  const [cart, setCart] = usePersisted<CartLine[]>('cart', []);
  const [guestFavorites, setGuestFavorites] = usePersisted<string[]>('guest-favorites', []);
  const favorites = user ? profile?.favorites ?? [] : guestFavorites;
  const [orders, setOrders] = useState<Order[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [staff, setStaff] = useState<StaffGrant[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [popups, setPopups] = useState<PopupItem[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement>({ text_ar: '', text_en: '', active: false });
  const [toast,setToast] = useState('');
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600); };
  const handleError = useCallback((error: Error) => {
    console.error(error);
    notify(error.message || text(lang, 'تعذّر تحميل البيانات.', 'Could not load store data.'));
  }, [lang]);
  const refreshStaff = useCallback(async () => {
    if (!isOwner) { setStaff([]); return; }
    try { setStaff((await listStaff()).map(fromFirebaseStaff)); } catch (error) { handleError(error as Error); }
  }, [handleError, isOwner]);
  const refreshCoupons = useCallback(async () => {
    const permitted = isOwner || hasStaffPermission(staffGrant, 'coupons.manage');
    if (!permitted) { setCoupons([]); return; }
    try { setCoupons((await listCoupons()).map(fromFirebaseCoupon)); } catch (error) { handleError(error as Error); }
  }, [handleError, isOwner, staffGrant]);
  const setFavorites = useCallback((ids: string[]) => {
    if (!user) { setGuestFavorites(ids); return; }
    setProfile(current => current ? { ...current, favorites: ids } : current);
    void saveFavorites(ids).catch(handleError);
  }, [handleError, setGuestFavorites, user]);
  useEffect(() => watchAuth(next => { setUser(next); setAuthLoading(false); }), []);
  useEffect(() => {
    if (!user) {
      setProfile(null); setStaffGrant(null); setOrders([]); setCoupons([]); setStaff([]); setRequests([]);
      return;
    }
    return watchUserProfile(user.uid, setProfile, handleError);
  }, [handleError, user?.uid]);
  useEffect(() => {
    if (!user) { setStaffGrant(null); return; }
    return watchStaff(setStaffGrant, handleError);
  }, [handleError, user?.uid]);
  useEffect(() => watchGames(
    isOwner || hasStaffPermission(staffGrant, 'games.manage'),
    list => setGames(list.map(fromFirebaseGame)),
    handleError,
  ), [handleError, isOwner, staffGrant]);
  useEffect(() => {
    if (!user) { setOrders([]); return; }
    const allOrders = isOwner || canViewOrders(staffGrant);
    return watchOrders(allOrders, list => setOrders(list.map(fromFirebaseOrder)), handleError);
  }, [handleError, isOwner, staffGrant, user?.uid]);
  useEffect(() => {
    void refreshCoupons();
  }, [refreshCoupons]);
  useEffect(() => {
    void refreshStaff();
  }, [refreshStaff]);
  useEffect(() => {
    const permitted = isOwner || hasStaffPermission(staffGrant, 'requests.manage');
    if (!permitted) { setRequests([]); return; }
    return watchGameRequests(staffGrant, list => setRequests(list.map(fromFirebaseRequest)), handleError);
  }, [handleError, isOwner, staffGrant]);
  useEffect(() => watchPopups(
    isOwner || hasStaffPermission(staffGrant, 'popups.manage'),
    list => setPopups(list.map(item => fromFirebasePopup(item, lang))),
    handleError,
  ), [handleError, isOwner, lang, staffGrant]);
  useEffect(() => watchAnnouncement(
    value => setAnnouncement(fromFirebaseAnnouncement(value, lang)),
    handleError,
  ), [handleError, lang]);
  const state: StoreState = {
    user,profile,authLoading,isOwner,staffGrant,refreshStaff,refreshCoupons,
    lang,setLang,games,setGames,cart,setCart,favorites,setFavorites,orders,setOrders,coupons,setCoupons,
    staff,setStaff,requests,setRequests,popups,setPopups,announcement,setAnnouncement,toast,notify,
  };
  return <StoreContext.Provider value={state}>{children}</StoreContext.Provider>;
}
const text = (lang: Lang, ar: string, en: string) => lang === 'ar' ? ar : en;
const formatPrice = (price: number, lang: Lang) => `${price.toFixed(price % 1 ? 2 : 0)} ${lang === 'ar' ? 'ر.س' : 'SAR'}`;
const gameTitle = (game: Game, lang: Lang) => lang === 'ar' ? game.title_ar : game.title_en;
const gameDesc = (game: Game, lang: Lang) => lang === 'ar' ? game.desc_ar : game.desc_en;

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><StoreProvider><Router /></StoreProvider></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Shell><Switch>
    <Route path="/" component={CatalogPage} />
    <Route path="/game/:id" component={GamePage} />
    <Route path="/cart" component={CartPage} />
    <Route path="/favorites" component={FavoritesPage} />
    <Route path="/orders" component={OrdersPage} />
    <Route path="/paid" component={PaidPage} />
    <Route path="/account" component={AccountPage} />
    <Route path="/login" component={LoginPage} />
    <Route path="/signup" component={SignupPage} />
    <Route path="/verify" component={VerifyPage} />
    <Route path="/admin" component={AdminPage} />
    <Route path="/admin/staff" component={StaffManagementPage} />
    <Route path="/staff" component={StaffWorkspacePage} />
    <Route><NotFoundPage /></Route>
  </Switch></Shell></ErrorBoundary>;
}

function Shell({ children }: { children: ReactNode }) {
  const { lang,setLang,cart,toast,announcement,user,authLoading } = useStore();
  const [location] = useLocation();
  const rtl = lang === 'ar';
  const nav = [
    { href:'/', label:text(lang,'المتجر','Store'), icon:Gamepad2 },
    { href:'/favorites', label:text(lang,'المفضلة','Saved'), icon:Heart },
    { href:'/orders', label:text(lang,'طلباتي','Orders'), icon:PackageCheck },
  ];
  return <div className="app-shell has-mobile-nav" dir={rtl?'rtl':'ltr'} lang={lang}>
    {announcement.active && <div className="bg-[#234f45] text-[#f8f0df] text-center px-4 py-2 text-xs md:text-[13px]" data-testid="announcement-banner"><span>{lang==='ar'?announcement.text_ar:announcement.text_en}</span></div>}
    <header className="topbar">
      <div className="page-wrap h-[72px] flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3 no-underline text-inherit" data-testid="link-brand">
          <span className="brand-mark"><Gamepad2 size={19}/></span><span className="leading-tight"><span className="block font-extrabold tracking-[-.04em] text-[17px]">GLASSA <span className="text-[#b88742]">GAMES</span></span><span className="block text-[10px] tracking-[.14em] text-muted-foreground">GAMES, WELL CHOSEN</span></span>
        </Link>
        <nav className="top-desktop-links flex items-center gap-7 text-sm font-semibold text-muted-foreground">
          {nav.map(item=><Link key={item.href} href={item.href} className={`no-underline transition hover:text-foreground ${location===item.href?'text-[#234f45]':''}`} data-testid={`nav-${item.href.slice(1)||'store'}`}>{item.label}</Link>)}
          <Link href="/account" className="no-underline transition hover:text-foreground" data-testid="nav-account">{text(lang,'حسابي','Account')}</Link>
        </nav>
        <div className="flex items-center gap-1">
          <Link href="/cart" className="icon-btn relative no-underline" aria-label={text(lang,'السلة','Cart')} data-testid="button-cart"><ShoppingCart size={19}/>{cart.length>0&&<span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] rounded-full bg-[#c69248] text-white text-[10px] grid place-items-center">{cart.reduce((sum,line)=>sum+line.quantity,0)}</span>}</Link>
          <Link href="/orders" className="icon-btn relative no-underline" aria-label={text(lang,'الإشعارات','Notifications')} data-testid="button-notifications"><Bell size={18}/><i className="absolute top-2 end-2 w-1.5 h-1.5 rounded-full bg-[#c69248]"/></Link>
          <button className="btn btn-quiet !min-h-[40px] !px-3 !text-xs" onClick={()=>setLang(rtl?'en':'ar')} data-testid="button-language"><Languages size={15}/>{rtl?'EN':'عربي'}</button>
          {!authLoading&&(user?<button type="button" className="btn btn-primary !min-h-[40px] !px-3 !text-xs hidden sm:inline-flex" onClick={()=>void signOutUser().catch(error=>notify(error instanceof Error?error.message:'Sign out failed'))} data-testid="button-signout-header"><LogIn size={15}/>{text(lang,'خروج','Sign out')}</button>:<Link href="/login" className="btn btn-primary !min-h-[40px] !px-3 !text-xs no-underline hidden sm:inline-flex" data-testid="link-login-header"><LogIn size={15}/>{text(lang,'دخول','Sign in')}</Link>)}
        </div>
      </div>
    </header>
    {children}
    <footer className="border-t border-border mt-20 py-9">
      <div className="page-wrap flex flex-col sm:flex-row gap-4 justify-between text-xs text-muted-foreground">
        <div className="flex gap-2 items-center"><span className="brand-mark !w-7 !h-7 !rounded-lg"><Gamepad2 size={15}/></span><strong className="text-foreground">Glassa Games</strong><span>· {text(lang,'ألعاب مختارة بعناية','A considered collection of games')}</span></div>
        <div className="flex gap-5"><Link href="/admin" className="no-underline text-inherit" data-testid="link-owner-portal">{text(lang,'بوابة المالك','Owner portal')}</Link><Link href="/staff" className="no-underline text-inherit" data-testid="link-staff-portal">{text(lang,'مساحة الفريق','Team workspace')}</Link><span>© 2025 Glassa Games</span></div>
      </div>
    </footer>
    <nav className="mobile-nav">
      {[{href:'/',icon:Gamepad2,label:text(lang,'المتجر','Store')},{href:'/favorites',icon:Heart,label:text(lang,'المفضلة','Saved')},{href:'/cart',icon:ShoppingCart,label:text(lang,'السلة','Cart')},{href:'/orders',icon:PackageCheck,label:text(lang,'الطلبات','Orders')},{href:'/account',icon:UserRound,label:text(lang,'حسابي','Account')}].map(item=>{const Icon=item.icon;return <Link key={item.href} href={item.href} aria-current={location===item.href?'page':undefined} data-testid={`mobile-${item.href.slice(1)||'store'}`}><Icon size={18}/><span>{item.label}</span></Link>})}
    </nav>
    {toast&&<div role="status" className="fixed bottom-24 md:bottom-7 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-[#203b38] text-white px-5 py-3 shadow-xl text-sm flex items-center gap-2 fade-up" data-testid="status-toast"><CheckCircle2 size={17}/>{toast}</div>}
  </div>;
}

function CatalogPage() {
  const {lang,games,favorites,setFavorites,cart,setCart,popups} = useStore();
  const [search,setSearch] = useState(''); const [platform,setPlatform] = useState('all'); const [sort,setSort] = useState('featured');
  const shown = useMemo(()=>games.filter(g=>!g.hidden && `${g.title_ar} ${g.title_en}`.toLowerCase().includes(search.toLowerCase()) && (platform==='all'||g.platform===platform)).sort((a,b)=>sort==='price-low'?(a.offerPrice??a.price)-(b.offerPrice??b.price):sort==='price-high'?(b.offerPrice??b.price)-(a.offerPrice??a.price):Number(b.badgeMostRequested)-Number(a.badgeMostRequested)),[games,platform,search,sort]);
  const toggleFavorite = (id:string)=>setFavorites(favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id]);
  const addCart = (id:string)=>{setCart(cart.some(x=>x.gameId===id)?cart: [...cart,{gameId:id,quantity:1}]);};
  const featured = games.find(g=>g.badgeMostRequested&&!g.hidden)??games[0];
  return <main className="page-wrap pt-7 md:pt-10">
    <div className="hero-panel p-6 md:p-11 min-h-[300px] md:min-h-[346px] flex items-center">
      <div className="relative z-10 max-w-[590px] fade-up">
        <div className="flex gap-2 mb-5"><span className="pill !bg-white/10 !text-[#edcf91] !border-white/10"><Sparkles size={14}/>{text(lang,'مختارات هذا الشهر','Curated this month')}</span><span className="text-[11px] self-center text-white/60">VOL. 04 — 2025</span></div>
        <h1 className="serif whitespace-pre-line text-[35px] leading-[1.12] md:text-[54px] md:leading-[1.07] font-extrabold max-w-[600px] mb-4">{text(lang,'اللعبة المناسبة،\nفي وقتها.','The right game,\nright on time.')}</h1>
        <p className="text-sm md:text-base text-[#e5e5d7]/80 max-w-[430px] leading-7 mb-7">{text(lang,'ألعاب نحبها، نختبرها، ونجهّزها لك. اختر لعبتك واستلمها من المتجر بكل وضوح.','Games we love, tested and ready for you. Choose your next favorite and collect it from our store.')}</p>
        <div className="flex flex-wrap gap-3"><a href="#catalog" className="btn btn-gold no-underline" data-testid="link-explore-catalog">{text(lang,'اكتشف المجموعة','Explore the collection')}<ArrowLeft size={16}/></a><span className="text-xs self-center text-white/65 flex items-center gap-2"><ShieldCheck size={15}/>{text(lang,'تسليم حضوري · رابط بعد الاعتماد','In-person pickup · link after approval')}</span></div>
      </div>
      <div className="hidden lg:block absolute end-[6%] top-[25px] w-[280px] h-[290px] rotate-[4deg] rounded-[20px] border border-[#e3c98c]/30 bg-[#f1e5c6]/[.08] p-3 shadow-2xl">
        <div className="feature-img h-full rounded-[13px]" style={{backgroundImage:`linear-gradient(180deg,rgba(13,29,28,.04) 24%,rgba(11,28,27,.82)),url(${heroArt})`}}><div className="game-art-label !text-[24px]">{featured?gameTitle(featured,lang):'Selected play'}</div><span className="absolute top-4 start-4 z-10 uppercase text-[9px] tracking-[.19em] text-white/80">GLASSA SELECTS</span></div>
      </div>
    </div>
    {popups.filter(x=>x.active).length>0&&<div className="mt-5 flex items-center gap-3 rounded-xl border border-[#ead9b7] bg-[#fbf5e9] px-4 py-3 text-sm text-[#634b2d]" data-testid="popup-promo"><Tag size={17}/><strong>{popups.find(x=>x.active)?.title}</strong><span className="hidden sm:inline text-[#836d4d]">{popups.find(x=>x.active)?.body}</span></div>}
    <section id="catalog" className="pt-10 md:pt-14">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div><div className="text-[11px] tracking-[.18em] text-[#9a7139] font-bold mb-2">{text(lang,'المجموعة','THE COLLECTION')}</div><h2 className="serif text-3xl md:text-[40px] font-extrabold">{text(lang,'اختيارات تستحق وقتك','Worth your time')}</h2><p className="text-sm text-muted-foreground mt-2">{text(lang,'مكتبة صغيرة بعناية، تكبر بما يستحق.','A thoughtful collection, growing with every good discovery.')}</p></div>
        <span className="text-xs text-muted-foreground">{text(lang,`${shown.length} ألعاب متاحة`,`${shown.length} games available`)}</span>
      </div>
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1"><Search size={17} className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground ${lang==='ar'?'right-4':'left-4'}`}/><input className="input !ps-11" value={search} onChange={e=>setSearch(e.target.value)} placeholder={text(lang,'ابحث عن لعبة...','Search games...')} data-testid="input-game-search"/></div>
        <label className="relative md:w-[190px]"><Filter size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none"/><select className="input !ps-9 appearance-none" value={platform} onChange={e=>setPlatform(e.target.value)} aria-label={text(lang,'تصفية حسب المنصة','Filter by platform')} data-testid="select-platform"><option value="all">{text(lang,'كل المنصات','All platforms')}</option><option>PC</option><option>Android</option><option>PC + Android</option></select><ChevronDown size={15} className="absolute top-1/2 -translate-y-1/2 end-3 pointer-events-none text-muted-foreground"/></label>
        <label className="relative md:w-[175px]"><ArrowDownUp size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none"/><select className="input !ps-9 appearance-none" value={sort} onChange={e=>setSort(e.target.value)} aria-label={text(lang,'ترتيب','Sort')} data-testid="select-sort"><option value="featured">{text(lang,'الأكثر طلباً','Featured')}</option><option value="price-low">{text(lang,'السعر: الأقل','Price: low first')}</option><option value="price-high">{text(lang,'السعر: الأعلى','Price: high first')}</option></select><ChevronDown size={15} className="absolute top-1/2 -translate-y-1/2 end-3 pointer-events-none text-muted-foreground"/></label>
      </div>
      {shown.length===0?<EmptyState icon={<Search size={25}/>} title={text(lang,'لا توجد نتائج','No games found')} body={text(lang,'جرّب تغيير البحث أو المنصة.','Try changing your search or platform filter.')} action={()=>{setSearch('');setPlatform('all')}} actionLabel={text(lang,'مسح الفلاتر','Clear filters')}/>:<div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 stagger">{shown.map(game=><GameCard key={game.id} game={game} favorite={favorites.includes(game.id)} onFavorite={()=>toggleFavorite(game.id)} onAdd={()=>addCart(game.id)}/>)}</div>}
    </section>
    <section className="mt-14 mb-5 rounded-2xl bg-[#eee8da] border border-[#e0d8c6] p-5 md:p-7 flex flex-col md:flex-row md:items-center justify-between gap-5">
      <div className="flex gap-4 items-start"><span className="w-11 h-11 rounded-xl bg-[#dcd3bd] grid place-items-center text-[#355d4d]"><CircleHelp size={21}/></span><div><h3 className="font-bold">{text(lang,'لم تجد لعبتك؟','Didn’t find your game?')}</h3><p className="text-sm text-muted-foreground mt-1">{text(lang,'أرسل لنا طلبك، وسنراجع توفرها قريباً.','Send a request and we’ll check availability for you.')}</p></div></div>
      <RequestForm compact/>
    </section>
  </main>;
}

function GameCard({ game,favorite,onFavorite,onAdd }: { game:Game;favorite:boolean;onFavorite:()=>void;onAdd:()=>void }) {
  const {lang,notify}=useStore();
  return <article className="surface overflow-hidden group" data-testid={`card-game-${game.id}`}>
    <div className="relative">
      <Link href={`/game/${game.id}`} className="block no-underline text-inherit" data-testid={`link-game-${game.id}`}>
      <div className={`game-art h-[190px] sm:h-[220px] ${game.id==='stray'?'art-2':game.id==='rdr2'?'art-3':game.id==='stardew'?'art-4':''}`}>
        <div className="absolute z-[2] top-3 start-3 flex gap-1.5">{game.badgeMostRequested&&<span className="rounded-full px-2.5 py-1 bg-[#f0d493] text-[#3e3729] text-[10px] font-bold">{text(lang,'الأكثر طلباً','MOST WANTED')}</span>}{game.badgeUpdated&&<span className="rounded-full px-2.5 py-1 bg-[#f5f2e8]/90 text-[#355d4d] text-[10px] font-bold">{text(lang,'محدّثة','UPDATED')}</span>}</div>
        <div className="game-art-label text-[21px] md:text-[24px]">{gameTitle(game,lang)}</div>
      </div>
      </Link>
      <button className={`icon-btn absolute z-[3] top-2 end-2 !w-9 !h-9 bg-black/20 text-white hover:bg-black/40 ${favorite?'active':''}`} onClick={()=>{onFavorite();notify(text(lang,favorite?'أزيلت من المفضلة':'أضيفت إلى المفضلة',favorite?'Removed from saved':'Added to saved'));}} aria-label={text(lang,'تبديل المفضلة','Toggle favorite')} data-testid={`button-favorite-${game.id}`}><Heart size={17} fill={favorite?'currentColor':'none'}/></button>
    </div>
    <div className="p-4 md:p-5">
      <div className="flex items-center justify-between gap-2 mb-2"><span className="text-[11px] font-bold tracking-wide text-[#527263]">{game.platform}</span><span className="text-[11px] text-muted-foreground">{game.size}</span></div>
      <p className="text-xs text-muted-foreground line-clamp-2 leading-5 min-h-10 mb-4">{gameDesc(game,lang)}</p>
      <div className="flex items-center justify-between gap-2"><div>{game.offerPrice&&<span className="text-xs text-muted-foreground line-through block">{formatPrice(game.price,lang)}</span>}<strong className="text-lg tracking-tight">{formatPrice(game.offerPrice??game.price,lang)}</strong></div><button className="btn btn-primary !min-h-[40px] !px-3 text-xs" onClick={()=>{onAdd();notify(text(lang,'أضيفت اللعبة إلى السلة','Added to cart'));}} data-testid={`button-add-cart-${game.id}`}><ShoppingBag size={15}/>{text(lang,'أضف','Add')}</button></div>
    </div>
  </article>;
}

function GamePage() {
  const {lang,games,cart,setCart,favorites,setFavorites,notify}=useStore();
  const [,params]=useRoute('/game/:id'); const game=games.find(g=>g.id===params?.id);
  if(!game)return <main className="page-wrap py-20"><EmptyState icon={<Gamepad2 size={26}/>} title={text(lang,'اللعبة غير متاحة','Game not found')} body={text(lang,'قد تكون اللعبة أزيلت من المجموعة.','This game may have left the collection.')} actionLabel={text(lang,'العودة للمتجر','Back to store')} href="/"/></main>;
  const price=game.offerPrice??game.price;
  const add=()=>{setCart(cart.some(x=>x.gameId===game.id)?cart:[...cart,{gameId:game.id,quantity:1}]);notify(text(lang,'أضيفت اللعبة إلى السلة','Added to cart'));};
  return <main className="page-wrap py-8 md:py-12">
    <Link href="/" className="inline-flex gap-2 items-center text-sm text-muted-foreground no-underline mb-6" data-testid="link-back-catalog"><ArrowRight size={16}/>{text(lang,'العودة إلى المجموعة','Back to collection')}</Link>
    <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-7 lg:gap-12">
      <div className="game-art rounded-2xl min-h-[320px] md:min-h-[510px] shadow-lg">{game.id==='stray'&&<i/>}<div className="absolute top-5 start-5 z-[2] pill !bg-white/90">{game.platform}</div><div className="game-art-label !text-[36px] md:!text-[52px]">{gameTitle(game,lang)}</div></div>
      <div className="py-2 md:py-5">
        <div className="flex gap-2 mb-4">{game.badgeMostRequested&&<span className="pill">{text(lang,'الأكثر طلباً','Most requested')}</span>}{game.badgeUpdated&&<span className="pill !bg-[#f5eedf] !text-[#886637]">{text(lang,'نسخة محدّثة','Updated build')}</span>}</div>
        <h1 className="serif text-4xl md:text-5xl font-extrabold leading-tight">{gameTitle(game,lang)}</h1>
        <p className="text-muted-foreground leading-7 mt-4">{gameDesc(game,lang)}</p>
        <div className="flex items-end gap-3 mt-6">{game.offerPrice&&<span className="text-sm text-muted-foreground line-through mb-1">{formatPrice(game.price,lang)}</span>}<span className="text-3xl font-bold">{formatPrice(price,lang)}</span><span className="text-xs text-muted-foreground mb-1">{text(lang,'شراء حضوري','In-person purchase')}</span></div>
        <div className="flex gap-3 mt-6"><button className="btn btn-primary flex-1 md:flex-none" onClick={add} data-testid="button-add-game-detail"><ShoppingBag size={17}/>{text(lang,'أضف إلى السلة','Add to basket')}</button><button className={`btn btn-quiet !px-4 ${favorites.includes(game.id)?'!text-[#a74138]':''}`} onClick={()=>{setFavorites(favorites.includes(game.id)?favorites.filter(id=>id!==game.id):[...favorites,game.id]);notify(text(lang,'تم تحديث المفضلة','Saved games updated'));}} data-testid="button-game-favorite"><Heart size={17} fill={favorites.includes(game.id)?'currentColor':'none'}/>{text(lang,'حفظ','Save')}</button></div>
        <div className="surface p-5 mt-7">
          <h2 className="font-bold mb-4 flex gap-2 items-center"><BadgeCheck className="text-[#45745f]" size={19}/>{text(lang,'تفاصيل النسخة','Edition details')}</h2>
          <div className="grid grid-cols-2 gap-y-4 text-sm"><Detail label={text(lang,'حجم التنزيل','Download size')} value={game.size}/><Detail label={text(lang,'المنصة','Platform')} value={game.platform}/><Detail label={text(lang,'نسبة التوافق','Compatibility')} value={`${game.worksPercent}%`}/><Detail label={text(lang,'المتطلبات','System requirements')} value={game.sysReq}/></div>
        </div>
        <div className="mt-5 flex gap-3 text-xs text-muted-foreground leading-5"><ShieldCheck size={17} className="shrink-0 text-[#527263] mt-0.5"/><span>{text(lang,'الشراء يتم في المتجر حضورياً. بعد تأكيد الطلب واعتماده، يظهر رابط التنزيل الخاص في صفحة الطلبات.','Purchases are completed in person. Once your order is confirmed and approved, private download access appears in your orders.')}</span></div>
      </div>
    </div>
    <section className="mt-16"><div className="flex justify-between items-end mb-5"><div><span className="text-[11px] tracking-[.18em] text-[#9a7139] font-bold">{text(lang,'قبل أن تبدأ','GOOD TO KNOW')}</span><h2 className="serif text-2xl font-extrabold mt-2">{text(lang,'دعم وتوافق','Compatibility, at a glance')}</h2></div><span className="text-sm font-bold text-[#527263]">{game.worksPercent}% {text(lang,'توافق مجرّب','tested')}</span></div><div className="h-2 bg-[#e4e0d5] rounded-full overflow-hidden"><div className="h-full bg-[#41745f] rounded-full" style={{width:`${game.worksPercent}%`}}/></div><p className="text-sm text-muted-foreground mt-3">{text(lang,'المتطلبات المقترحة: ','Suggested requirements: ')}{game.sysReq}</p></section>
  </main>;
}
function Detail({label,value}:{label:string;value:string}) { return <div><div className="text-[11px] text-muted-foreground mb-1">{label}</div><div className="font-semibold text-sm">{value}</div></div>; }

function CartPage() {
  const {lang,games,cart,setCart,user,profile,isOwner,notify}=useStore();
  const [couponInput,setCouponInput]=useState('');const [coupon,setCoupon]=useState<Coupon|null>(null);
  const [name,setName]=useState('');const [phone,setPhone]=useState('');const [note,setNote]=useState('');
  const [submitted,setSubmitted]=useState(false);const [submitting,setSubmitting]=useState(false);const [,setLocation]=useLocation();
  const lines=cart.map(line=>({line,game:games.find(g=>g.id===line.gameId)})).filter((x):x is {line:CartLine;game:Game}=>!!x.game);
  const subtotal=lines.reduce((sum,{line,game})=>sum+(game.offerPrice??game.price)*line.quantity,0);
  const discount=coupon?subtotal*coupon.percent/100:0;
  const total=Math.max(0,subtotal-discount);
  const updateQty=(id:string,delta:number)=>setCart(cart.map(x=>x.gameId===id?{...x,quantity:delta<0?0:1}:x).filter(x=>x.quantity>0));
  const applyCoupon=async()=>{try{setCoupon(await validateCoupon(couponInput));notify(text(lang,'تم تطبيق القسيمة','Coupon applied'));}catch(error){setCoupon(null);notify(error instanceof Error?error.message:text(lang,'رمز القسيمة غير صالح أو منتهٍ','That coupon code is invalid or expired'));}};
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!name.trim()||!phone.trim()||!lines.length)return;if(!user){setLocation('/login');return;}if(!isOwner&&!profile?.emailVerified){setLocation('/verify');return;}setSubmitting(true);try{await createOrder({gameIds:lines.map(({game})=>game.id),customerName:name,phone,note,coupon});setCart([]);setSubmitted(true);notify(text(lang,'تم تسجيل طلبك','Your order was submitted'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر إرسال الطلب','Could not submit your order'));}finally{setSubmitting(false);}};
  if(submitted)return <main className="page-wrap py-16"><div className="max-w-[680px] mx-auto surface p-7 md:p-12 text-center fade-up"><div className="w-16 h-16 rounded-2xl bg-[#e3f2e9] text-[#28604c] grid place-items-center mx-auto mb-5"><CheckCircle2 size={30}/></div><p className="text-xs tracking-[.18em] text-[#9a7139] font-bold mb-2">{text(lang,'تم تسجيل الطلب','REQUEST RECEIVED')}</p><h1 className="serif text-3xl md:text-4xl font-extrabold">{text(lang,'طلبك بانتظار المراجعة','Your order is in review')}</h1><p className="text-sm text-muted-foreground mt-4 leading-6">{text(lang,'لا يتم الدفع عبر الموقع. تواصل مع المتجر لإتمام الاستلام، وسيظهر رابط التنزيل بعد اعتماد الطلب.','No payment is collected online. Coordinate pickup with the store; download access becomes available after approval.')}</p><Link href="/orders" className="btn btn-primary no-underline mt-7" data-testid="link-view-orders">{text(lang,'تابع طلباتك','Track your order')}<ArrowLeft size={16}/></Link></div></main>;
  return <main className="page-wrap py-8 md:py-12">
    <div className="mb-8"><div className="text-[11px] tracking-[.18em] text-[#9a7139] font-bold mb-2">{text(lang,'خطوة واحدة إلى مغامرتك','ONE STEP CLOSER')}</div><h1 className="serif text-4xl md:text-5xl font-extrabold">{text(lang,'سلة المشتريات','Your basket')}</h1></div>
    {!lines.length?<EmptyState icon={<ShoppingCart size={25}/>} title={text(lang,'سلتك بانتظار اكتشافك','Your basket is waiting')} body={text(lang,'أضف لعبة تحبها، ثم أرسل طلب الاستلام.','Add a game you love, then send your pickup request.')} actionLabel={text(lang,'تصفح الألعاب','Browse games')} href="/"/>:
      <div className="grid lg:grid-cols-[1.15fr_.85fr] gap-7">
        <section className="surface p-5 md:p-7"><h2 className="font-bold text-lg mb-5">{text(lang,'ألعابك','Your games')} <span className="text-muted-foreground font-normal text-sm">({lines.length})</span></h2><div className="space-y-4">{lines.map(({line,game})=><div className="flex gap-4 py-4 border-t border-border first:border-t-0 first:pt-0" key={game.id} data-testid={`cart-item-${game.id}`}><div className={`game-art w-[82px] h-[92px] rounded-xl shrink-0 ${game.id==='stray'?'art-2':''}`}><div className="game-art-label !left-2 !right-2 !bottom-2 !text-[11px]">{gameTitle(game,lang)}</div></div><div className="flex-1 min-w-0"><div className="flex justify-between gap-2"><div><h3 className="font-bold">{gameTitle(game,lang)}</h3><div className="text-xs text-muted-foreground mt-1">{game.platform} · {game.size}</div></div><strong className="text-sm">{formatPrice((game.offerPrice??game.price)*line.quantity,lang)}</strong></div><div className="flex justify-between items-center mt-4"><div className="inline-flex border border-border rounded-lg overflow-hidden"><button className="w-9 h-8 grid place-items-center hover:bg-secondary" onClick={()=>updateQty(game.id,-1)} aria-label="Decrease quantity" data-testid={`button-quantity-minus-${game.id}`}><Minus size={14}/></button><span className="w-9 grid place-items-center text-xs border-x border-border" data-testid={`text-quantity-${game.id}`}>{line.quantity}</span><button className="w-9 h-8 grid place-items-center hover:bg-secondary" onClick={()=>updateQty(game.id,1)} aria-label="Increase quantity" data-testid={`button-quantity-plus-${game.id}`}><Plus size={14}/></button></div><button className="text-xs text-muted-foreground hover:text-destructive flex gap-1 items-center bg-transparent border-0 cursor-pointer" onClick={()=>setCart(cart.filter(x=>x.gameId!==game.id))} data-testid={`button-remove-${game.id}`}><Trash2 size={14}/>{text(lang,'إزالة','Remove')}</button></div></div></div>)}</div><Link href="/" className="inline-flex gap-2 items-center mt-5 text-sm text-[#355d4d] font-bold no-underline" data-testid="link-continue-shopping"><ArrowRight size={16}/>{text(lang,'متابعة التسوق','Continue shopping')}</Link></section>
        <div className="space-y-5"><section className="surface p-5 md:p-7"><h2 className="font-bold mb-4">{text(lang,'ملخص الطلب','Order summary')}</h2><div className="flex gap-2"><input className="input !h-11 uppercase" placeholder={text(lang,'رمز القسيمة','Coupon code')} value={couponInput} onChange={e=>setCouponInput(e.target.value)} data-testid="input-coupon"/><button type="button" className="btn btn-quiet !min-h-11 !px-4" onClick={()=>void applyCoupon()} data-testid="button-apply-coupon">{text(lang,'تطبيق','Apply')}</button></div>{coupon&&<div className="text-xs text-[#28604c] mt-2 flex gap-1"><Check size={14}/>{coupon.code} · {coupon.percent}% {text(lang,'خصم','off')}</div>}<div className="line my-5"/><div className="flex justify-between text-sm mb-3"><span className="text-muted-foreground">{text(lang,'المجموع الفرعي','Subtotal')}</span><span>{formatPrice(subtotal,lang)}</span></div>{discount>0&&<div className="flex justify-between text-sm mb-3 text-[#28604c]"><span>{text(lang,'الخصم','Discount')}</span><span>−{formatPrice(discount,lang)}</span></div>}<div className="flex justify-between font-bold text-lg pt-3 border-t border-border"><span>{text(lang,'الإجمالي','Total')}</span><span>{formatPrice(total,lang)}</span></div><p className="mt-4 rounded-xl bg-[#f4f0e5] p-3 text-xs text-[#746649] leading-5 flex gap-2"><LockKeyhole size={15} className="shrink-0 mt-0.5"/>{text(lang,'لا يوجد دفع إلكتروني. الدفع والاستلام في المتجر بعد تأكيد الطلب.','No online payment. Pay and collect in person after your request is confirmed.')}</p></section>
         <form className="surface p-5 md:p-7" onSubmit={submit}><h2 className="font-bold mb-4">{text(lang,'بيانات الاستلام','Pickup details')}</h2>{!user&&<p className="text-xs text-[#86612a] mb-4">{text(lang,'سجّل الدخول وأكّد بريدك قبل إرسال الطلب.','Sign in and verify your email before placing an order.')}</p>}{user&&!isOwner&&!profile?.emailVerified&&<p className="text-xs text-[#86612a] mb-4">{text(lang,'تحقق من بريدك الإلكتروني قبل إرسال الطلب.','Verify your email before placing an order.')}</p>}<label className="label" htmlFor="customer-name">{text(lang,'الاسم','Name')}</label><input id="customer-name" className="input mb-4" required value={name} onChange={e=>setName(e.target.value)} placeholder={text(lang,'اسمك الكامل','Your full name')} data-testid="input-customer-name"/><label className="label" htmlFor="customer-phone">{text(lang,'رقم التواصل','Phone number')}</label><input id="customer-phone" className="input mb-4" required value={phone} onChange={e=>setPhone(e.target.value)} placeholder="05X XXX XXXX" data-testid="input-customer-phone"/><label className="label" htmlFor="customer-note">{text(lang,'ملاحظة للمتجر','Note for the store')} <span className="text-muted-foreground font-normal">({text(lang,'اختياري','optional')})</span></label><textarea id="customer-note" className="input !h-[82px] py-3 resize-y mb-5" value={note} onChange={e=>setNote(e.target.value)} placeholder={text(lang,'وقت مناسب أو تفاصيل أخرى','A preferred time or anything else')} data-testid="input-customer-note"/><button className="btn btn-primary w-full" type="submit" disabled={submitting} data-testid="button-submit-order"><ShoppingBag size={17}/>{submitting?text(lang,'جار الإرسال…','Submitting…'):text(lang,'إرسال طلب الاستلام','Send pickup request')}</button><p className="text-center text-[11px] text-muted-foreground mt-3">{text(lang,'طلبك سيظهر كـ «قيد المراجعة» حتى يتم تأكيده من المتجر.','Your request remains pending until the store confirms it.')}</p></form></div>
      </div>}
  </main>;
}

function FavoritesPage() {
  const {lang,games,favorites,setFavorites,cart,setCart,notify}=useStore();
  const saved=games.filter(g=>favorites.includes(g.id)&&!g.hidden);
  return <main className="page-wrap py-9 md:py-12"><PageIntro eyebrow={text(lang,'مجموعتك الشخصية','YOUR SHORTLIST')} title={text(lang,'ألعاب حفظتها','Games you saved')} subtitle={text(lang,'مكان صغير للألعاب التي تستحق العودة إليها.','A small place for the games worth coming back to.')}/>
    {saved.length===0?<EmptyState icon={<Heart size={24}/>} title={text(lang,'لم تحفظ أي لعبة بعد','Nothing saved yet')} body={text(lang,'اضغط علامة القلب على لعبة لتجدها هنا لاحقاً.','Tap the heart on a game to keep it close.')} actionLabel={text(lang,'تصفح المجموعة','Explore games')} href="/"/>:<div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 stagger">{saved.map(game=><GameCard key={game.id} game={game} favorite onFavorite={()=>setFavorites(favorites.filter(id=>id!==game.id))} onAdd={()=>{setCart(cart.some(l=>l.gameId===game.id)?cart:[...cart,{gameId:game.id,quantity:1}]);notify(text(lang,'أضيفت اللعبة إلى السلة','Added to cart'));}}/>)}</div>}
  </main>;
}

function OrdersPage() {
  const {lang,orders,games}=useStore();
  return <main className="page-wrap py-9 md:py-12"><PageIntro eyebrow={text(lang,'مشترياتك','YOUR PURCHASES')} title={text(lang,'طلباتك، بكل وضوح','Your orders, clearly')} subtitle={text(lang,'تابع تأكيد الاستلام وحالة كل طلب.','Follow pickup confirmation and the status of every request.')}/>
    {orders.length===0?<EmptyState icon={<PackageCheck size={25}/>} title={text(lang,'لا توجد طلبات بعد','No orders yet')} body={text(lang,'ستظهر طلباتك هنا بعد إرسال أول طلب استلام.','Your orders will appear here after your first pickup request.')} actionLabel={text(lang,'تصفح الألعاب','Browse games')} href="/"/>:<div className="space-y-4 max-w-[920px]">{orders.map(order=><OrderCard key={order.id} order={order}/>)}</div>}
    <div className="mt-8 max-w-[920px] rounded-xl bg-[#f2eee3] p-4 text-xs text-muted-foreground flex gap-3"><ShieldCheck size={17} className="text-[#527263] shrink-0"/><span>{text(lang,'روابط التنزيل لا تظهر إلا بعد اعتماد الطلب من المتجر. هذه معاينة واجهة؛ ربط الحساب والطلبات والتنزيلات الآمنة يتم من خلال خدمات المتجر.','Download access is intended to appear only after store approval. This is a UI preview; account, order, and secure download services are connected separately.')}</span></div>
  </main>;
}

function OrderCard({order}:{order:Order}) {
  const {lang,games}=useStore();
  const statusText=order.status==='pending'?text(lang,'قيد المراجعة','Pending review'):order.status==='paid'?text(lang,'تم التأكيد','Approved'):text(lang,'مرفوض','Rejected');
  return <article className="surface p-5 md:p-6" data-testid={`card-order-${order.id}`}>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-xl bg-[#eee9dc] grid place-items-center text-[#466858]"><ShoppingBag size={18}/></span><div><div className="flex items-center gap-2"><strong className="font-mono text-sm">{order.id}</strong><span className={`status status-${order.status}`} data-testid={`status-order-${order.id}`}>{order.status==='paid'?<CheckCircle2 size={13}/>:order.status==='rejected'?<XCircle size={13}/>:<Clock3 size={13} />}{statusText}</span></div><div className="text-xs text-muted-foreground mt-1">{order.createdAt} · {formatPrice(order.total,lang)}</div></div></div>
      {order.status==='paid'&&<Link href="/paid" className="btn btn-primary !min-h-[39px] !text-xs no-underline" data-testid={`link-download-${order.id}`}><Download size={15}/>{text(lang,'عرض الوصول','View access')}</Link>}
    </div>
    <div className="line my-4"/>
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">{order.items.map(item=>{const game=games.find(g=>g.id===item.gameId);return game?<span key={item.gameId} className="text-muted-foreground">{gameTitle(game,lang)} <b className="text-foreground">×{item.quantity}</b></span>:null;})}</div>
    {order.status==='pending'&&<p className="text-xs text-[#86612a] mt-4 flex gap-2 items-center"><Clock3 size={14}/>{text(lang,'نراجع طلبك. تواصل مع المتجر لتأكيد الاستلام.','We’re reviewing your request. Contact the store to arrange pickup.')}</p>}
    {order.status==='rejected'&&<p className="text-xs text-[#9c3c35] mt-4 flex gap-2 items-center"><XCircle size={14}/>{order.rejectReason||text(lang,'يرجى التواصل مع المتجر للمزيد من التفاصيل.','Please contact the store for more details.')}</p>}
    {order.status==='paid'&&<div className="mt-4 p-3 rounded-xl bg-[#eef4ef] border border-[#d9e9dc] text-xs text-[#3e6854] flex items-center gap-2"><LockKeyhole size={14}/>{text(lang,'تم اعتماد الطلب. يمكنك مراجعة صفحة الوصول لتنزيل ألعابك.','Approved. Visit the access page to retrieve your games.')}</div>}
  </article>;
}

function PaidPage() {
  const {lang,orders,games,notify}=useStore();
  const paid=orders.filter(o=>o.status==='paid');
  return <main className="page-wrap py-9 md:py-12"><PageIntro eyebrow={text(lang,'وصول خاص','PRIVATE ACCESS')} title={text(lang,'ألعابك المعتمدة','Your approved games')} subtitle={text(lang,'تظهر الألعاب هنا بعد اعتماد الطلب من فريق المتجر.','Games appear here after the store team approves your order.')}/>
    <div className="max-w-[860px] rounded-xl border border-[#dfd5bc] bg-[#f6f0e2] px-4 py-3 text-xs text-[#735c35] flex items-start gap-2 mb-6"><LockKeyhole size={15} className="shrink-0 mt-0.5"/>{text(lang,'هذه نسخة واجهة فقط. لا يتم إنشاء أو حماية روابط التنزيل من المتصفح؛ يجب ربط صلاحيات الوصول بخدمات آمنة.','Interface preview only. Download links are not generated or secured in the browser; access must be connected to trusted services.')}</div>
    {!paid.length?<EmptyState icon={<LockKeyhole size={25}/>} title={text(lang,'لا يوجد وصول بعد','No access yet')} body={text(lang,'سيظهر رابط لعبتك هنا بعد اعتماد طلبك.','Your game access will appear here once your order is approved.')} actionLabel={text(lang,'متابعة الطلبات','View orders')} href="/orders"/>:<div className="space-y-4 max-w-[860px]">{paid.map(order=><section key={order.id} className="surface p-5 md:p-6" data-testid={`access-order-${order.id}`}><div className="flex justify-between items-center gap-4"><div><div className="text-xs text-muted-foreground mb-1">{order.id} · {order.createdAt}</div><h2 className="font-bold">{text(lang,'وصول معتمد','Approved access')}</h2></div><span className="pill"><BadgeCheck size={14}/>{text(lang,'تم الاعتماد','Approved')}</span></div><div className="line my-4"/><div className="space-y-3">{order.items.map(item=>{const game=games.find(g=>g.id===item.gameId);return game?<div className="flex items-center justify-between gap-3" key={game.id}><div className="flex gap-3 items-center"><div className="w-10 h-12 rounded-lg game-art"/><div><strong className="text-sm">{gameTitle(game,lang)}</strong><div className="text-[11px] text-muted-foreground mt-1">{game.platform} · {game.size}</div></div></div><button className="btn btn-quiet !min-h-[38px] !text-xs" onClick={()=>notify(text(lang,'روابط التنزيل ستظهر بعد ربط خدمة الوصول الآمن.','Download URLs will appear once secure access is connected.'))} data-testid={`button-download-${order.id}-${game.id}`}><Download size={15}/>{text(lang,'استرجاع الرابط','Retrieve link')}</button></div>:null;})}</div>{order.code&&<div className="mt-4 p-3 rounded-xl bg-[#f4f0e5] text-xs text-muted-foreground">{text(lang,'رمز الطلب','Order reference')}: <code className="font-mono font-bold text-foreground" data-testid={`text-access-code-${order.id}`}>{order.code}</code><span className="block mt-1">{text(lang,'مثال مرئي فقط — رابط التنزيل الخاص سيُضاف عند ربط الخدمة.','Visual sample only — the private download URL will be supplied by the connected service.')}</span></div>}</section>)}</div>}
  </main>;
}

function AccountPage() {
  const {lang,user,profile,isOwner,staffGrant,authLoading,notify}=useStore();
  const verified=isOwner||Boolean(profile?.emailVerified);
  return <main className="page-wrap py-9 md:py-12"><PageIntro eyebrow={text(lang,'مساحتك','YOUR SPACE')} title={text(lang,'حساب Glassa','Your Glassa account')} subtitle={text(lang,'تابع طلباتك واحفظ الألعاب التي تريد العودة إليها.','Keep track of orders and save games you want to revisit.')}/>
    <div className="grid md:grid-cols-2 gap-5 max-w-[900px]"><section className="surface p-6 md:p-8"><div className="w-12 h-12 rounded-2xl bg-[#e8eee7] grid place-items-center text-[#355d4d] mb-4"><UserRound size={22}/></div>{authLoading?<p className="text-sm text-muted-foreground">{text(lang,'جار تحميل الحساب…','Loading account…')}</p>:user?<><h2 className="serif font-bold text-2xl">{profile?.name||user.displayName||text(lang,'أهلاً بك','Welcome')}</h2><p className="text-sm text-muted-foreground mt-2">{user.email}</p><span className={`status mt-4 inline-flex ${verified?'status-paid':'status-pending'}`}>{verified?text(lang,'البريد مؤكد','Email verified'):text(lang,'البريد غير مؤكد','Email not verified')}</span><div className="flex flex-wrap gap-3 mt-6"><Link href="/orders" className="btn btn-primary no-underline">{text(lang,'طلباتي','My orders')}</Link>{!verified&&<Link href="/verify" className="btn btn-quiet no-underline">{text(lang,'تأكيد البريد','Verify email')}</Link>}<button type="button" onClick={()=>void signOutUser().then(()=>notify(text(lang,'تم تسجيل الخروج','Signed out')))} className="btn btn-quiet">{text(lang,'تسجيل الخروج','Sign out')}</button></div></>:<><h2 className="serif font-bold text-2xl">{text(lang,'أهلاً بك في Glassa','Welcome to Glassa')}</h2><p className="text-sm text-muted-foreground leading-6 mt-2">{text(lang,'سجّل الدخول لمتابعة طلبات الاستلام ومزامنة ألعابك المفضلة.','Sign in to follow pickup requests and keep your saved games in sync.')}</p><div className="flex flex-wrap gap-3 mt-6"><Link href="/login" className="btn btn-primary no-underline" data-testid="link-account-login">{text(lang,'تسجيل الدخول','Sign in')}<ArrowLeft size={15}/></Link><Link href="/signup" className="btn btn-quiet no-underline" data-testid="link-account-signup">{text(lang,'إنشاء حساب','Create account')}</Link></div></>}</section>
    <section className="surface p-6 md:p-8 bg-[#f1ece0]"><span className="pill mb-4"><ShieldCheck size={14}/>{text(lang,'المالك والفريق','Owner & team')}</span><h2 className="serif font-bold text-2xl">{text(lang,'مساحة عمل المتجر','Store workspace')}</h2><p className="text-sm text-muted-foreground leading-6 mt-2">{text(lang,'يدخل المالك من نموذج الدخول المعتاد. أعضاء الفريق يرون الأدوات المصرح بها فقط.','The owner uses the same sign-in form. Team members only see tools granted to them.')}</p><div className="flex gap-3 mt-6">{isOwner?<Link href="/admin" className="btn btn-primary no-underline">{text(lang,'لوحة المالك','Owner dashboard')}</Link>:staffGrant?.active?<Link href="/staff" className="btn btn-primary no-underline">{text(lang,'مساحة الفريق','Team workspace')}</Link>:<Link href="/login" className="btn btn-primary no-underline" data-testid="link-owner-login">{text(lang,'دخول موحد','Standard sign in')}</Link>}</div>{!user&&<p className="text-[11px] text-muted-foreground mt-4">{text(lang,'استخدم نموذج الدخول المعتاد للمالك وأعضاء الفريق.','Owners and staff use the standard sign-in form.')}</p>}</section></div>
  </main>;
}

function LoginPage() { return <AuthPage mode="login"/>; }
function SignupPage() { return <AuthPage mode="signup"/>; }
function AuthPage({mode}:{mode:'login'|'signup'}) {
  const {lang,notify}=useStore();const [name,setName]=useState('');const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [visible,setVisible]=useState(false);const [busy,setBusy]=useState(false);const [,setLocation]=useLocation();
  const signup=mode==='signup';
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);try{if(signup){try{await signUp({name,email,password});}catch(error){if(!auth.currentUser)throw error;notify(error instanceof Error?error.message:text(lang,'تعذر إرسال رسالة التحقق.','Could not send the verification email.'));}setLocation('/verify');}else{const signed=await signIn(email,password);const currentProfile=await getUserProfile(signed.uid);if(!isOwnerUser(signed)&&!signed.emailVerified&&!currentProfile?.emailVerified)setLocation('/verify');else setLocation('/account');}}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذر تسجيل الدخول.','Could not sign in.'));}finally{setBusy(false);}};
  const forgot=async()=>{const address=email.trim()||window.prompt(text(lang,'أدخل بريدك الإلكتروني','Enter your email address'))||'';if(!address)return;try{await resetPassword(address);notify(text(lang,'أرسلنا رابط إعادة تعيين كلمة المرور.','Password reset email sent.'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذر إرسال رابط إعادة التعيين.','Could not send the reset email.'));}};
  return <main className="page-wrap py-8 md:py-12">
    <div className="max-w-[960px] mx-auto grid md:grid-cols-[.92fr_1.08fr] overflow-hidden rounded-[24px] border border-border bg-card shadow-[0_18px_50px_rgba(41,48,39,.08)]">
      <div className="hidden md:flex flex-col justify-between p-9 lg:p-12 bg-[#203b38] text-[#f7f0e2] relative overflow-hidden"><div className="absolute inset-0 opacity-50" style={{background:'radial-gradient(ellipse at 90% 8%,rgba(211,171,99,.32),transparent 35%),radial-gradient(ellipse at 10% 90%,rgba(90,145,111,.3),transparent 35%)'}}/><div className="relative"><span className="pill !bg-white/10 !text-[#edcf91]"><Gamepad2 size={14}/> GLASSA GAMES</span><h1 className="serif text-4xl lg:text-[46px] font-extrabold leading-[1.08] mt-9 whitespace-pre-line">{text(lang,'مساحة لك،\nوللعب القادم.','A place for you,\nand your next game.')}</h1><p className="text-sm text-white/65 mt-4 leading-6 max-w-[310px]">{text(lang,'حساب واحد لترتيب طلباتك، ومتابعة كل لعبة اخترتها.','One account to follow your orders and keep each chosen game close.')}</p></div><div className="relative text-xs text-white/55 flex gap-2"><ShieldCheck size={15}/>{text(lang,'تجربة حساب آمنة عبر خدمات المصادقة','Secure account services connected separately')}</div></div>
      <div className="p-6 md:p-9 lg:p-12"><Link href="/" className="inline-flex items-center gap-2 no-underline text-muted-foreground text-xs mb-7" data-testid="link-auth-back"><ArrowRight size={15}/>{text(lang,'العودة للمتجر','Back to store')}</Link><div className="md:hidden flex items-center gap-2 text-xs font-extrabold mb-6"><span className="brand-mark"><Gamepad2 size={16}/></span>GLASSA GAMES</div>
        <div className="text-[11px] tracking-[.18em] text-[#9a7139] font-bold mb-2">{text(lang,signup?'بداية جديدة':'مرحباً بعودتك',signup?'A NEW CHAPTER':'GOOD TO SEE YOU')}</div><h2 className="serif text-3xl font-extrabold">{text(lang,signup?'أنشئ حسابك':'سجّل الدخول',signup?'Create your account':'Sign in')}</h2><p className="text-sm text-muted-foreground mt-2 mb-6">{text(lang,signup?'أنشئ حساباً لمتابعة طلباتك وألعابك المحفوظة.':'تابع طلباتك وألعابك المحفوظة.','Keep your orders and saved games together.')}</p>
         <form onSubmit={submit}>{signup&&<><label className="label" htmlFor="auth-name">{text(lang,'الاسم','Name')}</label><input id="auth-name" required className="input mb-4" value={name} onChange={e=>setName(e.target.value)} placeholder={text(lang,'اسمك','Your name')} data-testid="input-auth-name"/></>}<label className="label" htmlFor="auth-email">{text(lang,'البريد الإلكتروني','Email address')}</label><div className="relative mb-4"><Mail size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground"/><input id="auth-email" required type="email" className="input !ps-10" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" data-testid="input-auth-email"/></div><label className="label" htmlFor="auth-password">{text(lang,'كلمة المرور','Password')}</label><div className="relative mb-2"><LockKeyhole size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground"/><input id="auth-password" required type={visible?'text':'password'} minLength={6} className="input !ps-10 !pe-12" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" data-testid="input-auth-password"/><button type="button" onClick={()=>setVisible(!visible)} className="absolute top-1/2 -translate-y-1/2 end-2 icon-btn !w-9 !h-9" aria-label={visible?'Hide password':'Show password'} data-testid="button-toggle-password">{visible?<EyeOff size={16}/>:<Eye size={16}/>}</button></div>{!signup&&<button type="button" onClick={()=>void forgot()} className="text-xs font-bold text-[#355d4d] bg-transparent border-0 cursor-pointer mb-4" data-testid="button-forgot-password">{text(lang,'نسيت كلمة المرور؟','Forgot password?')}</button>}<button className="btn btn-primary w-full" type="submit" disabled={busy} data-testid="button-auth-submit">{busy?text(lang,'جارٍ المعالجة…','Please wait…'):text(lang,signup?'إنشاء الحساب':'دخول',signup?'Create account':'Sign in')}<ArrowLeft size={15}/></button></form>
        <p className="text-xs text-center text-muted-foreground mt-5">{signup?text(lang,'لديك حساب؟ ','Already registered? '):text(lang,'ليس لديك حساب؟ ','New to Glassa? ')}<Link href={signup?'/login':'/signup'} className="text-[#355d4d] font-bold no-underline" data-testid="link-auth-switch">{text(lang,signup?'سجّل الدخول':'أنشئ حساباً',signup?'Sign in':'Create an account')}</Link></p>
        <div className="mt-6 border-t border-border pt-4 text-[11px] text-muted-foreground leading-5 flex gap-2"><ShieldCheck size={14} className="shrink-0 mt-0.5"/>{text(lang,'المالك يستخدم نموذج الدخول نفسه. المصادقة وتأكيد البريد تُربط بخدمات Firebase، ولا تُنفذ في هذه المعاينة.','The owner uses this same login form. Firebase authentication and email verification are not active in this preview.')}</div>
      </div>
    </div>
  </main>;
}

function VerifyPage() {
  const {lang,notify,user,profile,isOwner}=useStore();const [,setLocation]=useLocation();const [busy,setBusy]=useState(false);
  const resend=async()=>{setBusy(true);try{await sendVerificationEmail();notify(text(lang,'أرسلنا رسالة تحقق جديدة.','A new verification email was sent.'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذر إرسال رسالة التحقق.','Could not send the verification email.'));}finally{setBusy(false);}};
  const check=async()=>{setBusy(true);try{const verified=await refreshEmailVerification();if(verified||isOwner){notify(text(lang,'تم تأكيد البريد الإلكتروني.','Email verified.'));setLocation('/account');}else notify(text(lang,'لم نتلقَّ التأكيد بعد. افتح الرابط في بريدك ثم حاول مجدداً.','Verification is not confirmed yet. Open the email link, then try again.'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذر التحقق من البريد.','Could not refresh verification status.'));}finally{setBusy(false);}};
  if(!user)return <main className="page-wrap py-12"><section className="surface max-w-[620px] mx-auto p-8 text-center"><h1 className="serif text-3xl font-extrabold">{text(lang,'سجّل الدخول أولاً','Sign in first')}</h1><Link href="/login" className="btn btn-primary no-underline mt-5">{text(lang,'تسجيل الدخول','Sign in')}</Link></section></main>;
  if(isOwner||profile?.emailVerified)return <main className="page-wrap py-12"><section className="surface max-w-[620px] mx-auto p-8 text-center"><h1 className="serif text-3xl font-extrabold">{text(lang,'تم تأكيد البريد','Email verified')}</h1><Link href="/account" className="btn btn-primary no-underline mt-5">{text(lang,'متابعة','Continue')}</Link></section></main>;
  return <main className="page-wrap py-12 md:py-20"><section className="surface max-w-[620px] mx-auto p-7 md:p-12 text-center"><div className="w-16 h-16 rounded-2xl bg-[#edf2ec] grid place-items-center text-[#426d59] mx-auto mb-5"><Mail size={27}/></div><div className="text-[11px] tracking-[.18em] text-[#9a7139] font-bold">{text(lang,'خطوة أخيرة','ONE LAST STEP')}</div><h1 className="serif text-3xl md:text-4xl font-extrabold mt-2">{text(lang,'تحقق من بريدك','Check your inbox')}</h1><p className="text-sm text-muted-foreground mt-3 leading-6">{text(lang,`أرسلنا رابط تأكيد إلى ${user.email ?? ''}. افتحه ثم ارجع إلى هذه الصفحة.`,`We sent a verification link to ${user.email ?? ''}. Open it, then return here.`)}</p><div className="grid sm:grid-cols-2 gap-3 mt-6"><button type="button" onClick={()=>void resend()} disabled={busy} className="btn btn-quiet" data-testid="button-resend-verification"><Mail size={16}/>{text(lang,'إعادة إرسال الرابط','Resend verification link')}</button><button type="button" onClick={()=>void check()} disabled={busy} className="btn btn-primary" data-testid="button-check-verification"><Check size={16}/>{text(lang,'تم التحقق','I verified')}</button></div><p className="text-[11px] text-muted-foreground mt-4">{text(lang,'تأكيد البريد مطلوب قبل إرسال الطلبات.','Email verification is required before placing orders.')}</p><Link href="/login" className="inline-flex gap-2 items-center mt-6 text-sm font-bold text-[#355d4d] no-underline" data-testid="link-verify-login"><ArrowRight size={15}/>{text(lang,'العودة إلى الدخول','Back to sign in')}</Link></section></main>;
}

function RequestForm({compact=false}:{compact?:boolean}) {
  const {lang,user,notify}=useStore();const [title,setTitle]=useState('');const [platform,setPlatform]=useState('PC');const [,setLocation]=useLocation();const [busy,setBusy]=useState(false);
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!title.trim())return;if(!user){setLocation('/login');return;}setBusy(true);try{const value=platform==='Android'?'android':platform==='PC + Android'?'both':'pc';await submitGameRequest(title,'',value);setTitle('');notify(text(lang,'وصل طلبك إلى فريق المتجر','Your request is with the store team'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر إرسال الطلب','Could not submit your request'));}finally{setBusy(false);}};
  return <form className={`flex gap-2 ${compact?'w-full md:w-auto':''}`} onSubmit={submit}><input className={`input min-w-0 flex-1 ${compact?'md:w-[190px]':''}`} value={title} onChange={e=>setTitle(e.target.value)} placeholder={text(lang,'اسم اللعبة','Game title')} aria-label={text(lang,'اسم اللعبة المطلوبة','Requested game')} data-testid="input-game-request"/><select className="input !w-[125px] shrink-0" value={platform} onChange={e=>setPlatform(e.target.value)} aria-label={text(lang,'المنصة','Platform')} data-testid="select-request-platform"><option>PC</option><option>Android</option><option>PC + Android</option></select><button className="btn btn-primary !px-4 shrink-0" disabled={busy} type="submit" data-testid="button-submit-request"><Plus size={16}/><span className={compact?'hidden sm:inline':''}>{busy?text(lang,'جار الإرسال…','Sending…'):text(lang,'أرسل الطلب','Request')}</span></button></form>;
}

type AdminTab = 'overview'|'orders'|'games'|'coupons'|'promos'|'requests';
function toFirebaseOrder(order:Order,games:Game[]):FirebaseOrder {
  const itemIds=order.itemIds??order.items.map(item=>item.gameId);
  return {
    id:order.id,uid:order.uid??'',email:order.email??'',customerName:order.customerName,
    phone:order.phone,note:order.note,
    items:itemIds.map(gameId=>{const game=games.find(item=>item.id===gameId);return {gameId,title:game?gameTitle(game,'en'):gameId,price:game?.offerPrice??game?.price??0};}),
    itemIds,subtotal:order.total,couponCode:order.couponCode??'',discountPercent:order.discountPercent??0,
    total:order.total,status:order.status,rejectReason:order.rejectReason??'',rejectionSeen:false,
  };
}
async function saveOrderDecision(order:Order,status:'paid'|'rejected',reason:string,games:Game[],lang:Lang,grant:FirebaseStaffGrant|null) {
  const source=toFirebaseOrder(order,games);
  if(status==='paid')return markOrderPaid(source,lang,grant);
  await rejectOrder(source,reason,grant);
  return null;
}
function AdminPage() {
  const {lang,games,orders,requests,staff,notify,isOwner,user,authLoading,staffGrant}=useStore();
  const [tab,setTab]=useState<AdminTab>('overview');
  const tabs: {id:AdminTab;label:string;icon:typeof LayoutDashboard}[]=[
    {id:'overview',label:text(lang,'نظرة عامة','Overview'),icon:LayoutDashboard},
    {id:'orders',label:text(lang,'الطلبات','Orders'),icon:PackageCheck},
    {id:'games',label:text(lang,'الألعاب','Games'),icon:Gamepad2},
    {id:'coupons',label:text(lang,'القسائم','Coupons'),icon:Tag},
    {id:'promos',label:text(lang,'الواجهة','Storefront'),icon:Bell},
    {id:'requests',label:text(lang,'الطلبات الجديدة','Requests'),icon:CircleHelp},
  ];
  const decideOrder=(order:Order,status:'paid'|'rejected')=>{
    const response=status==='rejected'?window.prompt(text(lang,'سبب الرفض','Reason for rejection')):undefined;
    if(status==='rejected'&&response===null)return;
    const reason=status==='rejected'?(response?.trim()||text(lang,'يرجى التواصل مع المتجر لمزيد من التفاصيل.','Please contact the store for details.')):'';
    void saveOrderDecision(order,status,reason,games,lang,staffGrant).then(result=>{
      notify(status==='paid'?(result?.emailSent?text(lang,'تم اعتماد الطلب وإرسال الرمز بالبريد','Order approved and code emailed'):text(lang,'تم اعتماد الطلب، لكن تعذّر إرسال البريد','Order approved, but the email could not be sent')):text(lang,'تم رفض الطلب','Order rejected'));
    }).catch(error=>notify(error instanceof Error?error.message:text(lang,'تعذّر تحديث الطلب','Could not update the order')));
  };
  const approveRequests=async(id:string)=>{try{await markRequestDone(id,staffGrant);}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر تحديث الطلب','Could not update the request'));}};
  if(authLoading)return <main className="page-wrap py-16 text-center text-sm text-muted-foreground">{text(lang,'جار تحميل الحساب…','Loading account…')}</main>;
  if(!user||!isOwner)return <main className="page-wrap py-16"><EmptyState icon={<LockKeyhole size={25}/>} title={text(lang,'لوحة المالك محمية','Owner dashboard is protected')} body={text(lang,'سجّل الدخول بحساب المالك للوصول إلى إدارة المتجر.','Sign in with the owner account to manage the store.')} actionLabel={text(lang,'تسجيل الدخول','Sign in')} href="/login"/></main>;
  return <main className="page-wrap py-7 md:py-10">
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-7">
      <div><div className="flex items-center gap-2 text-[11px] tracking-[.16em] text-[#9a7139] font-bold mb-2"><LockKeyhole size={13}/>{text(lang,'بوابة المالك','OWNER CONSOLE')}</div><h1 className="serif text-3xl md:text-4xl font-extrabold">{text(lang,'إدارة Glassa','Glassa operations')}</h1><p className="text-sm text-muted-foreground mt-2">{text(lang,'إدارة مباشرة للكتالوج والطلبات وصلاحيات الفريق.','Manage the catalog, orders, and staff access.')}</p></div>
      <Link href="/admin/staff" className="btn btn-quiet no-underline self-start md:self-auto" data-testid="link-staff-management"><Users size={16}/>{text(lang,'إدارة الفريق','Manage team')}</Link>
    </div>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-7">
      <Metric label={text(lang,'طلبات قيد المراجعة','Pending orders')} value={orders.filter(o=>o.status==='pending').length.toString()} icon={<Clock3 size={18}/>} detail={text(lang,'بانتظار قرارك','Awaiting your review')}/>
      <Metric label={text(lang,'ألعاب ظاهرة','Visible games')} value={games.filter(g=>!g.hidden).length.toString()} icon={<Gamepad2 size={18}/>} detail={text(lang,'في المجموعة الحالية','In the collection')}/>
      <Metric label={text(lang,'طلبات ألعاب جديدة','New game requests')} value={requests.filter(r=>r.status==='new').length.toString()} icon={<CircleHelp size={18}/>} detail={text(lang,'من العملاء','From customers')}/>
      <Metric label={text(lang,'أعضاء الفريق','Team members')} value={staff.filter(s=>s.active).length.toString()} icon={<Users size={18}/>} detail={text(lang,'بصلاحيات محددة','With assigned access')}/>
    </div>
    <div className="flex gap-2 overflow-x-auto pb-2 mb-5">{tabs.map(item=>{const Icon=item.icon;return <button key={item.id} onClick={()=>setTab(item.id)} className={`btn !min-h-[40px] !px-3 !text-xs whitespace-nowrap ${tab===item.id?'btn-primary':'btn-quiet'}`} data-testid={`tab-admin-${item.id}`}><Icon size={15}/>{item.label}</button>})}</div>
    {tab==='overview'&&<div className="grid lg:grid-cols-[1.2fr_.8fr] gap-5"><section className="surface p-5 md:p-7"><div className="flex items-center justify-between mb-5"><div><span className="text-[11px] tracking-[.16em] text-[#9a7139] font-bold">{text(lang,'يتطلب انتباهاً','NEEDS ATTENTION')}</span><h2 className="font-bold text-lg mt-1">{text(lang,'طلبات حديثة','Recent orders')}</h2></div><button className="text-xs font-bold text-[#355d4d] border-0 bg-transparent cursor-pointer" onClick={()=>setTab('orders')} data-testid="button-view-all-orders">{text(lang,'عرض الكل','View all')} <ArrowLeft size={13} className="inline"/></button></div>{orders.slice(0,3).map(order=><OrderRow key={order.id} order={order} onApprove={()=>decideOrder(order,'paid')} onReject={()=>decideOrder(order,'rejected')}/>)}</section><section className="surface p-5 md:p-7"><span className="text-[11px] tracking-[.16em] text-[#9a7139] font-bold">{text(lang,'نبض المتجر','STORE PULSE')}</span><h2 className="font-bold text-lg mt-1 mb-5">{text(lang,'آخر النشاطات','Recent activity')}</h2><div className="space-y-4">{requests.slice(0,3).map(r=><div className="flex justify-between gap-3 text-sm border-b border-border pb-3 last:border-0" key={r.id}><div><strong>{r.title}</strong><div className="text-xs text-muted-foreground mt-1">{r.customer} · {r.platform}</div></div><span className={`status ${r.status==='new'?'status-pending':'status-paid'}`}>{r.status==='new'?text(lang,'جديد','New'):text(lang,'مراجع','Reviewed')}</span></div>)}{requests.length===0&&<p className="text-sm text-muted-foreground">{text(lang,'لا توجد طلبات ألعاب.','No game requests.')}</p>}</div><button className="btn btn-quiet mt-4 !min-h-[38px] !text-xs" onClick={()=>setTab('requests')} data-testid="button-open-requests">{text(lang,'مراجعة الطلبات','Review requests')}<ArrowLeft size={14}/></button></section></div>}
    {tab==='orders'&&<section className="surface p-5 md:p-7"><AdminHeading title={text(lang,'مراجعة الطلبات','Review orders')} note={text(lang,'اعتمد الاستلام لتفعيل حالة الطلب، أو ارفضه مع توضيح السبب.','Approve pickup or reject with a reason.')}/>{orders.length===0?<InlineEmpty text={text(lang,'لا توجد طلبات للمراجعة.','No orders to review.')}/>:orders.map(order=><OrderRow key={order.id} order={order} onApprove={()=>decideOrder(order,'paid')} onReject={()=>decideOrder(order,'rejected')}/>)}</section>}
    {tab==='games'&&<GamesManager/>}
    {tab==='coupons'&&<CouponsManager/>}
    {tab==='promos'&&<PromoManager/>}
    {tab==='requests'&&<RequestsManager onReview={approveRequests}/>}
    <div className="mt-6 text-[11px] text-muted-foreground flex gap-2 items-start"><ShieldCheck size={14} className="shrink-0 mt-0.5"/>{text(lang,'يتم حفظ تغييرات الإدارة في المتجر مباشرة.','Management changes are saved to the live store.')}</div>
  </main>;
}

function Metric({label,value,icon,detail}:{label:string;value:string;icon:ReactNode;detail:string}) {
  return <div className="surface p-4 md:p-5"><div className="flex items-center justify-between text-[#527263]"><span className="text-xs font-bold text-muted-foreground">{label}</span>{icon}</div><div className="serif text-3xl md:text-4xl font-extrabold mt-4">{value}</div><div className="text-[11px] text-muted-foreground mt-1">{detail}</div></div>;
}
function AdminHeading({title,note}:{title:string;note:string}){return <div className="mb-5"><h2 className="font-bold text-lg">{title}</h2><p className="text-xs text-muted-foreground mt-1">{note}</p></div>}
function InlineEmpty({text:message}:{text:string}){return <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2"><PackageCheck size={23}/>{message}</div>}
function OrderRow({order,onApprove,onReject}:{order:Order;onApprove:()=>void;onReject:()=>void}) {
  const {lang,games}=useStore();
  const gameNames=order.items.map(i=>games.find(g=>g.id===i.gameId)).filter(Boolean).map(g=>gameTitle(g!,lang)).join(' · ');
  return <div className="py-4 border-t border-border first:border-t-0 flex flex-col md:flex-row md:items-center justify-between gap-3" data-testid={`admin-order-${order.id}`}><div className="min-w-0"><div className="flex items-center gap-2 flex-wrap"><strong className="font-mono text-sm">{order.id}</strong><span className={`status status-${order.status}`}>{order.status==='pending'?text(lang,'قيد المراجعة','Pending'):order.status==='paid'?text(lang,'معتمد','Approved'):text(lang,'مرفوض','Rejected')}</span><span className="text-[11px] text-muted-foreground">{order.createdAt}</span></div><div className="font-semibold text-sm mt-1">{order.customerName}<span className="font-normal text-muted-foreground"> · {order.phone}</span></div><div className="text-xs text-muted-foreground mt-1 truncate">{gameNames} · {formatPrice(order.total,lang)}</div>{order.rejectReason&&<div className="text-xs text-[#9c3c35] mt-1">{order.rejectReason}</div>}</div><div className="flex gap-2 shrink-0">{order.status==='pending'?<><button className="btn btn-primary !min-h-[38px] !px-3 !text-xs" onClick={onApprove} data-testid={`button-approve-${order.id}`}><Check size={14}/>{text(lang,'اعتماد','Approve')}</button><button className="btn btn-quiet !min-h-[38px] !px-3 !text-xs !text-[#9c3c35]" onClick={onReject} data-testid={`button-reject-${order.id}`}><X size={14}/>{text(lang,'رفض','Reject')}</button></>:order.status==='paid'?<span className="text-xs text-[#28604c] flex items-center gap-1"><BadgeCheck size={14}/>{text(lang,'تم إنشاء رمز وصول مرئي','Access reference ready')}</span>:null}</div></div>;
}

function GamesManager() {
  const {lang,games,staffGrant,notify}=useStore();
  type Draft = Omit<GameDraft,"offerEndsAt"> & { offerEndsAt: string };
  const emptyDraft: Draft = {title_ar:"",title_en:"",desc_ar:"",desc_en:"",platform:"pc",price:0,offerPrice:null,offerEndsAt:"",size:"",worksPercent:100,sysReq:"",coverUrl:"",screenshots:[],hidden:false,badgeMostRequested:false,badgeUpdated:false,downloadUrl:""};
  const [draft,setDraft]=useState<Draft>(emptyDraft);const [editing,setEditing]=useState<string|null>(null);const [busy,setBusy]=useState(false);
  const updateDraft=<K extends keyof Draft>(key:K,value:Draft[K])=>setDraft(current=>({...current,[key]:value}));
  const save=async(e:FormEvent)=>{e.preventDefault();if(!draft.downloadUrl.trim()){notify(text(lang,'أضف رابط التنزيل قبل حفظ اللعبة.','Add the download URL before saving.'));return;}setBusy(true);try{const payload:GameDraft={...draft,platform:draft.platform,offerPrice:draft.offerPrice?Number(draft.offerPrice):null,offerEndsAt:draft.offerEndsAt?new Date(`${draft.offerEndsAt}T23:59:59`):null,price:Number(draft.price)};if(editing)await updateGame(editing,payload,staffGrant);else await saveGame(payload,staffGrant);setDraft(emptyDraft);setEditing(null);notify(text(lang,editing?'تم تحديث اللعبة':'تمت إضافة اللعبة',editing?'Game updated':'Game added'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر حفظ اللعبة','Could not save the game'));}finally{setBusy(false);}};
  const edit=async(game:Game)=>{setEditing(game.id);setDraft({title_ar:game.title_ar,title_en:game.title_en,desc_ar:game.desc_ar,desc_en:game.desc_en,platform:game.platform==="Android"?"android":game.platform==="PC + Android"?"both":"pc",price:game.price,offerPrice:game.offerPrice??null,offerEndsAt:game.offerEndsAt??"",size:game.size,worksPercent:game.worksPercent,sysReq:game.sysReq,coverUrl:game.coverUrl,screenshots:game.screenshots,hidden:game.hidden,badgeMostRequested:game.badgeMostRequested,badgeUpdated:game.badgeUpdated,downloadUrl:""});try{updateDraft("downloadUrl",await getManagedDownloadUrl(game.id,staffGrant));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر تحميل رابط اللعبة','Could not load the game link'));}};
  const toggleVisibility=async(game:Game)=>{try{await setGameVisibility(game.id,!game.hidden,staffGrant);notify(text(lang,'تم تحديث ظهور اللعبة','Game visibility updated'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر تحديث اللعبة','Could not update the game'));}};
  const remove=async(game:Game)=>{if(!window.confirm(text(lang,'حذف اللعبة وروابطها نهائياً؟','Permanently delete this game and its download link?')))return;try{await deleteGame(game.id,staffGrant);notify(text(lang,'تم حذف اللعبة','Game deleted'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر حذف اللعبة','Could not delete the game'));}};
  const upload=async(file?:File)=>{if(!file)return;setBusy(true);try{updateDraft("coverUrl",await uploadGameImage(file));notify(text(lang,'تم رفع صورة الغلاف','Cover uploaded'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر رفع الصورة','Could not upload the image'));}finally{setBusy(false);}};
  return <section className="surface p-5 md:p-7"><AdminHeading title={text(lang,'كتالوج الألعاب','Game catalog')} note={text(lang,'أضف الألعاب وعدّل بياناتها وروابط تنزيلها الخاصة.','Create games and edit their details and private download links.')}/><form onSubmit={save} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6 p-4 md:p-5 rounded-xl bg-[#f4f0e5]">
    <input className="input" value={draft.title_ar} onChange={e=>updateDraft("title_ar",e.target.value)} placeholder="اسم اللعبة بالعربية" required data-testid="input-game-title-ar"/>
    <input className="input" value={draft.title_en} onChange={e=>updateDraft("title_en",e.target.value)} placeholder="Game title (English)" required data-testid="input-game-title-en"/>
    <input className="input" type="number" min="0.01" step=".01" value={draft.price||""} onChange={e=>updateDraft("price",Number(e.target.value))} placeholder={text(lang,'السعر (ر.س)','Price (SAR)')} required data-testid="input-game-price"/>
    <select className="input" value={draft.platform} onChange={e=>updateDraft("platform",e.target.value as Draft["platform"])} data-testid="select-game-platform"><option value="pc">PC</option><option value="android">Android</option><option value="both">PC + Android</option></select>
    <input className="input" value={draft.size} onChange={e=>updateDraft("size",e.target.value)} placeholder={text(lang,'حجم اللعبة','Game size')} required/>
    <input className="input" value={draft.sysReq} onChange={e=>updateDraft("sysReq",e.target.value)} placeholder={text(lang,'متطلبات التشغيل','System requirements')} required/>
    <input className="input" value={draft.desc_ar} onChange={e=>updateDraft("desc_ar",e.target.value)} placeholder="وصف اللعبة بالعربية" required/>
    <input className="input" value={draft.desc_en} onChange={e=>updateDraft("desc_en",e.target.value)} placeholder="Game description (English)" required/>
    <input className="input" type="number" min="0" max="100" value={draft.worksPercent} onChange={e=>updateDraft("worksPercent",Number(e.target.value))} placeholder={text(lang,'نسبة التوافق %','Compatibility %')} required/>
    <input className="input" type="number" min="0" step=".01" value={draft.offerPrice??""} onChange={e=>updateDraft("offerPrice",e.target.value?Number(e.target.value):null)} placeholder={text(lang,'سعر العرض (اختياري)','Sale price (optional)')}/>
    <input className="input" type="date" value={draft.offerEndsAt} onChange={e=>updateDraft("offerEndsAt",e.target.value)} aria-label={text(lang,'انتهاء العرض','Offer expiry')}/>
    <input className="input" value={draft.coverUrl} onChange={e=>updateDraft("coverUrl",e.target.value)} placeholder={text(lang,'رابط صورة الغلاف','Cover image URL')}/>
    <label className="input flex items-center gap-2 cursor-pointer text-xs"><Download size={15}/>{text(lang,'رفع صورة غلاف','Upload cover')}<input className="sr-only" type="file" accept="image/*" onChange={e=>void upload(e.target.files?.[0])}/></label>
    <input className="input sm:col-span-2" type="url" value={draft.downloadUrl} onChange={e=>updateDraft("downloadUrl",e.target.value)} placeholder={text(lang,'رابط التنزيل الخاص','Private download URL')} required/>
    <div className="flex flex-wrap gap-x-4 gap-y-2 items-center"><label className="text-xs flex gap-2 items-center"><input type="checkbox" checked={draft.hidden} onChange={e=>updateDraft("hidden",e.target.checked)}/>{text(lang,'مخفية','Hidden')}</label><label className="text-xs flex gap-2 items-center"><input type="checkbox" checked={draft.badgeMostRequested} onChange={e=>updateDraft("badgeMostRequested",e.target.checked)}/>{text(lang,'الأكثر طلباً','Featured')}</label><label className="text-xs flex gap-2 items-center"><input type="checkbox" checked={draft.badgeUpdated} onChange={e=>updateDraft("badgeUpdated",e.target.checked)}/>{text(lang,'محدّثة','Updated')}</label></div>
    <div className="flex gap-2"><button className="btn btn-primary !min-h-10 flex-1" disabled={busy} type="submit" data-testid="button-create-game">{editing?<Check size={15}/>:<Plus size={15}/>} {busy?text(lang,'جار الحفظ…','Saving…'):text(lang,editing?'حفظ التعديلات':'إضافة لعبة',editing?'Save changes':'Add game')}</button>{editing&&<button type="button" className="btn btn-quiet !min-h-10" onClick={()=>{setEditing(null);setDraft(emptyDraft)}}>{text(lang,'إلغاء','Cancel')}</button>}</div>
  </form><div className="divide-y divide-border">{games.map(game=><div className="py-3 flex items-center justify-between gap-3" key={game.id} data-testid={`admin-game-${game.id}`}><div className="min-w-0"><div className="font-semibold text-sm truncate">{gameTitle(game,lang)}</div><div className="text-xs text-muted-foreground mt-1">{game.platform} · {formatPrice(game.offerPrice??game.price,lang)} · {game.size}</div></div><div className="flex gap-2 shrink-0"><button className="btn btn-quiet !min-h-[36px] !px-3 !text-xs" onClick={()=>void edit(game)} data-testid={`button-edit-game-${game.id}`}>{text(lang,'تعديل','Edit')}</button><button className="btn btn-quiet !min-h-[36px] !px-3 !text-xs" onClick={()=>void toggleVisibility(game)} data-testid={`button-toggle-game-${game.id}`}>{game.hidden?<Eye size={14}/>:<EyeOff size={14}/ >}{game.hidden?text(lang,'إظهار','Show'):text(lang,'إخفاء','Hide')}</button><button className="icon-btn !w-9 !h-9 text-muted-foreground hover:!text-destructive" onClick={()=>void remove(game)} aria-label={text(lang,'حذف اللعبة','Delete game')} data-testid={`button-delete-game-${game.id}`}><Trash2 size={16}/></button></div></div>)}</div></section>;
}

function CouponsManager() {
  const {lang,coupons,staffGrant,refreshCoupons,notify}=useStore();const [code,setCode]=useState('');const [amount,setAmount]=useState('');const [mode,setMode]=useState<'once'|'open'>('open');const [expires,setExpires]=useState('');const [busy,setBusy]=useState(false);
  const create=async(e:FormEvent)=>{e.preventDefault();if(!code.trim()||Number(amount)<=0)return;setBusy(true);try{await saveCoupon({code:code.trim().toUpperCase(),percent:Number(amount),mode,expiresAt:expires?new Date(`${expires}T23:59:59`):null,active:true},staffGrant);await refreshCoupons();setCode('');setAmount('');notify(text(lang,'تمت إضافة القسيمة','Coupon added'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر حفظ القسيمة','Could not save coupon'));}finally{setBusy(false);}};
  const toggle=async(coupon:Coupon)=>{try{await saveCoupon({code:coupon.code,percent:coupon.percent,mode:coupon.mode,expiresAt:coupon.expiresAt?new Date(coupon.expiresAt):null,active:!coupon.active},staffGrant);await refreshCoupons();}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر تحديث القسيمة','Could not update coupon'));}};
  const remove=async(code:string)=>{if(!window.confirm(text(lang,'حذف هذه القسيمة نهائياً؟','Delete this coupon permanently?')))return;try{await removeCoupon(code,staffGrant);await refreshCoupons();notify(text(lang,'تم حذف القسيمة','Coupon deleted'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر حذف القسيمة','Could not delete coupon'));}};
  return <section className="surface p-5 md:p-7"><AdminHeading title={text(lang,'قسائم المتجر','Store coupons')} note={text(lang,'إدارة الخصومات وحدود استخدام كل قسيمة.','Manage discounts and usage limits for each coupon.')}/><form onSubmit={create} className="grid sm:grid-cols-2 lg:grid-cols-[1fr_120px_175px_165px_auto] gap-2 mb-5 p-4 rounded-xl bg-[#f4f0e5]"><input className="input !h-10 uppercase" value={code} onChange={e=>setCode(e.target.value)} placeholder={text(lang,'رمز القسيمة','Coupon code')} required data-testid="input-new-coupon-code"/><input className="input !h-10" type="number" min="1" max="100" value={amount} onChange={e=>setAmount(e.target.value)} placeholder={text(lang,'خصم %','Discount %')} required data-testid="input-new-coupon-value"/><select className="input !h-10" value={mode} onChange={e=>setMode(e.target.value as 'once'|'open')} data-testid="select-coupon-mode"><option value="open">{text(lang,'استخدام متكرر','Reusable')}</option><option value="once">{text(lang,'مرة واحدة لكل حساب','Once per account')}</option></select><input className="input !h-10" type="date" value={expires} onChange={e=>setExpires(e.target.value)} aria-label={text(lang,'تاريخ الانتهاء','Expiry date')}/><button className="btn btn-primary !min-h-10 !px-3 !text-xs" disabled={busy} type="submit" data-testid="button-create-coupon"><Plus size={15}/>{text(lang,'إنشاء','Create')}</button></form><div className="divide-y divide-border">{coupons.map(c=><div className="py-3 flex items-center justify-between gap-4" key={c.code} data-testid={`coupon-row-${c.code}`}><div className="flex items-center gap-3"><span className="w-9 h-9 rounded-lg bg-[#f1e7d1] grid place-items-center text-[#926b31]"><Tag size={16}/></span><div><strong className="font-mono">{c.code}</strong><div className="text-xs text-muted-foreground mt-1">{c.percent}% · {c.mode==='once'?text(lang,'مرة واحدة لكل حساب','Once per account'):text(lang,'استخدام متكرر','Reusable')} · {c.expiresAt||text(lang,'بلا انتهاء','No expiry')}</div></div></div><div className="flex gap-2"><button className={`btn !min-h-[36px] !px-3 !text-xs ${c.active?'btn-quiet':'btn-primary'}`} onClick={()=>void toggle(c)} data-testid={`button-toggle-coupon-${c.code}`}>{c.active?text(lang,'مفعّلة','Active'):text(lang,'غير مفعّلة','Inactive')}</button><button className="icon-btn !w-9 !h-9 text-muted-foreground hover:!text-destructive" onClick={()=>void remove(c.code)} aria-label={text(lang,'حذف القسيمة','Delete coupon')}><Trash2 size={15}/></button></div></div>)}</div></section>;
}

function PromoManager() {
  const {lang,popups,announcement,staffGrant,isOwner,notify}=useStore();
  const canSettings=isOwner||hasStaffPermission(staffGrant,'settings.manage');const canPopups=isOwner||hasStaffPermission(staffGrant,'popups.manage');
  const [ar,setAr]=useState(announcement.text_ar);const [en,setEn]=useState(announcement.text_en);const [active,setActive]=useState(announcement.active);
  const [titleAr,setTitleAr]=useState('');const [titleEn,setTitleEn]=useState('');const [bodyAr,setBodyAr]=useState('');const [bodyEn,setBodyEn]=useState('');
  useEffect(()=>{setAr(announcement.text_ar);setEn(announcement.text_en);setActive(announcement.active);},[announcement.text_ar,announcement.text_en,announcement.active]);
  const saveNotice=async(e:FormEvent)=>{e.preventDefault();try{await saveAnnouncement({text_ar:ar.trim(),text_en:en.trim(),active},staffGrant);notify(text(lang,'تم حفظ الإعلان','Announcement saved'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر حفظ الإعلان','Could not save the announcement'));}};
  const addPopup=async(e:FormEvent)=>{e.preventDefault();if(!titleAr.trim()||!titleEn.trim())return;try{await savePopup({title_ar:titleAr.trim(),title_en:titleEn.trim(),body_ar:bodyAr.trim(),body_en:bodyEn.trim(),imageUrl:'',active:true},staffGrant);setTitleAr('');setTitleEn('');setBodyAr('');setBodyEn('');notify(text(lang,'تمت إضافة النافذة','Popup added'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر إضافة النافذة','Could not add popup'));}};
  const togglePopup=async(p:PopupItem)=>{try{await setPopupActive(p.id,!p.active,staffGrant);}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر تحديث النافذة','Could not update popup'));}};
  const deletePromo=async(id:string)=>{try{await removePopup(id,staffGrant);}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر حذف النافذة','Could not delete popup'));}};
  return <div className="grid lg:grid-cols-2 gap-5">{canSettings&&<section className="surface p-5 md:p-7"><AdminHeading title={text(lang,'إعلان المتجر','Store announcement')} note={text(lang,'رسالة موجزة تظهر أعلى واجهة المتجر.','A short message at the top of the storefront.')}/><form onSubmit={saveNotice}><label className="label">{text(lang,'النص بالعربية','Arabic message')}</label><input className="input mb-4" value={ar} onChange={e=>setAr(e.target.value)} required data-testid="input-announcement-ar"/><label className="label">{text(lang,'النص بالإنجليزية','English message')}</label><input className="input mb-4" value={en} onChange={e=>setEn(e.target.value)} required data-testid="input-announcement-en"/><div className="flex justify-between items-center"><label className="text-sm flex items-center gap-2"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} data-testid="checkbox-announcement-active"/>{text(lang,'إظهار الإعلان','Show announcement')}</label><button className="btn btn-primary !min-h-[39px] !text-xs" type="submit" data-testid="button-save-announcement"><Check size={15}/>{text(lang,'حفظ','Save')}</button></div></form></section>}
  {canPopups&&<section className="surface p-5 md:p-7"><AdminHeading title={text(lang,'النوافذ الترويجية','Promotional popups')} note={text(lang,'رسائل ثنائية اللغة تظهر في واجهة المتجر.','Bilingual campaign messages shown in the storefront.')}/><form className="space-y-2 mb-5" onSubmit={addPopup}><input className="input" value={titleAr} onChange={e=>setTitleAr(e.target.value)} placeholder={text(lang,'العنوان بالعربية','Arabic title')} required data-testid="input-popup-title-ar"/><input className="input" value={titleEn} onChange={e=>setTitleEn(e.target.value)} placeholder="English title" required/><input className="input" value={bodyAr} onChange={e=>setBodyAr(e.target.value)} placeholder={text(lang,'النص بالعربية','Arabic message')}/><div className="flex gap-2"><input className="input" value={bodyEn} onChange={e=>setBodyEn(e.target.value)} placeholder="English message"/><button className="btn btn-primary !px-3" type="submit"><Plus size={16}/></button></div></form><div className="space-y-2">{popups.map(p=><div className="p-3 rounded-xl border border-border flex items-center justify-between gap-3" key={p.id} data-testid={`popup-row-${p.id}`}><div><strong className="text-sm">{p.title}</strong><p className="text-xs text-muted-foreground mt-1">{p.body}</p></div><div className="flex gap-1"><button className="icon-btn !w-9 !h-9" onClick={()=>void togglePopup(p)} aria-label={text(lang,'تبديل ظهور الرسالة','Toggle promo')}>{p.active?<Eye size={16}/>:<EyeOff size={16}/>}</button><button className="icon-btn !w-9 !h-9 text-muted-foreground hover:!text-destructive" onClick={()=>void deletePromo(p.id)} aria-label={text(lang,'حذف الرسالة','Delete promo')}><Trash2 size={16}/></button></div></div>)}</div></section>}</div>;
}

function RequestsManager({onReview}:{onReview:(id:string)=>void}) {
  const {lang,staffGrant,isOwner,notify}=useStore();
  const manage=async(action:()=>Promise<void>,success:string)=>{try{await action();notify(text(lang,success,success));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر تحديث الطلب','Could not update the request'));}};
  return <section className="surface p-5 md:p-7"><AdminHeading title={text(lang,'طلبات العملاء','Customer requests')} note={text(lang,'ألعاب يتمنى العملاء رؤيتها في المجموعة.','Games customers would like to see in the collection.')}/>{isOwner||hasStaffPermission(staffGrant,'requests.manage')?<div className="mb-5 p-4 rounded-xl bg-[#f4f0e5]"><RequestForm/></div>:null}<div className="divide-y divide-border">{requests.length===0?<InlineEmpty text={text(lang,'لا توجد طلبات ألعاب حتى الآن.','No game requests so far.')}/>:requests.map(r=><div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" key={r.id} data-testid={`request-row-${r.id}`}><div><div className="flex items-center gap-2"><strong>{r.title}</strong><span className="pill !text-[10px]">{r.platform}</span><span className={`status ${r.status==='new'?'status-pending':'status-paid'}`}>{r.status==='new'?text(lang,'جديد','New'):text(lang,'تمت المراجعة','Reviewed')}</span></div><div className="text-xs text-muted-foreground mt-1">{r.customer} · {r.id}</div></div><div className="flex gap-2"><button className="btn btn-quiet !min-h-[36px] !px-3 !text-xs" onClick={()=>onReview(r.id)} disabled={r.status==='reviewed'} data-testid={`button-review-request-${r.id}`}><Check size={14}/>{text(lang,'تمت المراجعة','Mark reviewed')}</button><button className="icon-btn !w-9 !h-9 text-muted-foreground hover:!text-destructive" onClick={()=>void manage(()=>removeGameRequest(r.id,staffGrant),text(lang,'تم حذف الطلب','Request deleted'))} aria-label={text(lang,'حذف الطلب','Delete request')} data-testid={`button-delete-request-${r.id}`}><Trash2 size={16}/></button></div></div>)}</div></section>;
}

const permissionOptions: {id:Permission;ar:string;en:string}[]=[
  {id:'orders.view',ar:'عرض الطلبات',en:'View orders'},
  {id:'orders.process',ar:'اعتماد أو رفض الطلبات',en:'Approve or reject orders'},
  {id:'games.manage',ar:'إدارة الألعاب وروابطها',en:'Manage games and links'},
  {id:'coupons.manage',ar:'إدارة القسائم',en:'Manage coupons'},
  {id:'popups.manage',ar:'إدارة النوافذ الترويجية',en:'Manage promotional popups'},
  {id:'settings.manage',ar:'إدارة الإعلان العام',en:'Manage store announcement'},
  {id:'requests.manage',ar:'مراجعة طلبات الألعاب',en:'Review game requests'},
];
function permissionName(permission:Permission,lang:Lang) { const item=permissionOptions.find(p=>p.id===permission);return item?text(lang,item.ar,item.en):permission; }
function StaffManagementPage() {
  const {lang,staff,refreshStaff,isOwner,authLoading,notify}=useStore();const [email,setEmail]=useState('');const [permissions,setPermissions]=useState<Permission[]>([]);const [busy,setBusy]=useState(false);
  const togglePermission=(p:Permission)=>setPermissions(permissions.includes(p)?permissions.filter(x=>x!==p):[...permissions,p]);
  const permissionMap=(selected:Permission[])=>({...EMPTY_STAFF_PERMISSIONS,...Object.fromEntries(selected.map(permission=>[permission,true]))}) as FirebaseStaffGrant['permissions'];
  const add=async(e:FormEvent)=>{e.preventDefault();if(!permissions.length){notify(text(lang,'اختر صلاحية واحدة على الأقل','Choose at least one permission'));return;}setBusy(true);try{await saveStaffGrant(email,permissionMap(permissions));await refreshStaff();setEmail('');setPermissions([]);notify(text(lang,'تم حفظ صلاحيات عضو الفريق','Staff access saved'));}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر حفظ الصلاحيات','Could not save staff access'));}finally{setBusy(false);}};
  const toggleActive=async(member:StaffGrant)=>{try{if(member.active)await deactivateStaff(member.email);else await saveStaffGrant(member.email,permissionMap(member.permissions));await refreshStaff();}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر تحديث الصلاحيات','Could not update staff access'));}};
  const remove=async(email:string)=>{if(!window.confirm(text(lang,'إزالة هذا العضو من قائمة الفريق؟','Remove this person from staff?')))return;try{await deleteStaff(email);await refreshStaff();}catch(error){notify(error instanceof Error?error.message:text(lang,'تعذّر حذف العضو','Could not remove staff'));}};
  if(authLoading)return <main className="page-wrap py-16 text-center text-sm text-muted-foreground">{text(lang,'جار تحميل الحساب…','Loading account…')}</main>;
  if(!isOwner)return <main className="page-wrap py-16"><EmptyState icon={<LockKeyhole size={25}/>} title={text(lang,'هذه الصفحة للمالك فقط','Owner access only')} body={text(lang,'سجّل الدخول بحساب المالك لإدارة صلاحيات الفريق.','Sign in as the owner to manage staff access.')} actionLabel={text(lang,'تسجيل الدخول','Sign in')} href="/login"/></main>;
  return <main className="page-wrap py-7 md:py-10">
    <Link href="/admin" className="inline-flex gap-2 items-center text-sm text-muted-foreground no-underline mb-5" data-testid="link-back-admin"><ArrowRight size={15}/>{text(lang,'لوحة المالك','Owner operations')}</Link>
    <div className="flex items-center gap-3 mb-7"><span className="w-12 h-12 rounded-2xl bg-[#e8eee7] text-[#355d4d] grid place-items-center"><Users size={22}/></span><div><div className="text-[11px] tracking-[.16em] text-[#9a7139] font-bold">{text(lang,'الوصول المحدود','SCOPED ACCESS')}</div><h1 className="serif text-3xl md:text-4xl font-extrabold">{text(lang,'إدارة أعضاء الفريق','Team access')}</h1></div></div>
    <div className="grid lg:grid-cols-[.86fr_1.14fr] gap-5">
      <section className="surface p-5 md:p-7"><AdminHeading title={text(lang,'إضافة عضو','Add a team member')} note={text(lang,'أدخل البريد المسجّل في المتجر، ثم امنح أقل صلاحيات لازمة.','Use their registered store email and grant only the access they need.')}/>
        <form onSubmit={add}><label className="label" htmlFor="staff-email">{text(lang,'البريد الإلكتروني المسجّل','Registered email')}</label><input id="staff-email" type="email" required className="input mb-5" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" data-testid="input-staff-email"/><fieldset className="border-0 p-0 m-0"><legend className="label mb-2">{text(lang,'الصلاحيات الفردية','Individual permissions')}</legend><div className="space-y-2">{permissionOptions.map(p=><label key={p.id} className="flex items-start gap-3 p-3 rounded-xl border border-border hover:bg-[#f6f3eb] cursor-pointer"><input type="checkbox" className="mt-1 accent-[#234f45] w-4 h-4" checked={permissions.includes(p.id)} onChange={()=>togglePermission(p.id)} data-testid={`checkbox-permission-${p.id}`}/><span><strong className="text-sm block">{text(lang,p.ar,p.en)}</strong><span className="text-[11px] text-muted-foreground">{permissionDescription(p.id,lang)}</span></span></label>)}</div></fieldset><button type="submit" className="btn btn-primary w-full mt-5" data-testid="button-add-staff"><Users size={16}/>{text(lang,'إضافة عضو الفريق','Add team member')}</button></form>
        <div className="rounded-xl bg-[#f5f0e4] p-3 text-[11px] text-[#756346] leading-5 mt-4 flex gap-2"><ShieldCheck size={15} className="shrink-0 mt-0.5"/>{text(lang,'معاينة محلية فقط. التحقق من الحساب المسجّل وإنفاذ الصلاحيات يجب أن يتم على الخادم.','Local preview only. Registered-account checks and permission enforcement must happen in trusted services.')}</div>
      </section>
      <section className="surface p-5 md:p-7"><AdminHeading title={text(lang,'الفريق الحالي','Current team')} note={text(lang,'راجع أو حدّث ما يمكن لكل عضو الوصول إليه.','Review or adjust what each member can access.')}/>
        {staff.length===0?<InlineEmpty text={text(lang,'لم تتم إضافة أعضاء بعد.','No team members yet.')}/>:<div className="space-y-3">{staff.map((member,index)=><article className="rounded-xl border border-border p-4" key={member.email} data-testid={`staff-member-${index}`}><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="w-8 h-8 rounded-lg bg-[#ecefe9] grid place-items-center text-[#466858]"><UserRound size={15}/></span><strong className="text-sm">{member.email}</strong></div><div className="flex gap-1.5 flex-wrap mt-3">{member.permissions.map(p=><span className="pill !text-[10px] !py-1" key={p}>{permissionName(p,lang)}</span>)}</div></div><span className={`status ${member.active?'status-paid':'status-rejected'}`}>{member.active?text(lang,'نشط','Active'):text(lang,'موقوف','Paused')}</span></div><div className="flex justify-end gap-2 mt-4 border-t border-border pt-3"><button className="btn btn-quiet !min-h-[36px] !px-3 !text-xs" onClick={()=>void toggleActive(member)} data-testid={`button-toggle-staff-${index}`}>{member.active?text(lang,'إيقاف الوصول','Pause access'):text(lang,'تفعيل الوصول','Restore access')}</button><button className="btn !min-h-[36px] !px-3 !text-xs text-[#9c3c35] bg-transparent border border-border" onClick={()=>void remove(member.email)} data-testid={`button-remove-staff-${index}`}><Trash2 size={14}/>{text(lang,'إزالة','Remove')}</button></div></article>)}</div>}
      </section>
    </div>
  </main>;
}
function permissionDescription(permission:Permission,lang:Lang) {
  const descriptions:Record<Permission,[string,string]>={'orders.view':['عرض بيانات الطلبات دون تعديلها.','Read order details without changing them.'],'orders.process':['اعتماد الطلبات أو رفضها وإرسال رمز الوصول.','Approve orders or reject them and issue access codes.'],'games.manage':['إضافة الألعاب وتعديلها وإدارة روابط التنزيل.','Add and edit games and manage download links.'],'coupons.manage':['إنشاء القسائم وتفعيلها وحذفها.','Create, activate, and delete coupons.'],'popups.manage':['إضافة النوافذ الترويجية وإدارتها.','Create and manage promotional popups.'],'settings.manage':['تعديل الإعلان الذي يظهر أعلى المتجر.','Edit the announcement shown at the top of the store.'],'requests.manage':['مراجعة طلبات الألعاب وحذفها.','Review and delete game requests.']};
  return text(lang,...descriptions[permission]);
}

function StaffWorkspacePage() {
  const {lang,staff,orders,setOrders,requests,setRequests,games,setGames,coupons,setCoupons,popups,setPopups,announcement,setAnnouncement,notify}=useStore();
  // Demo identity only. Firebase will provide the verified user and server-granted permissions.
  const demoEmail='sara@glassagames.com';const grant=staff.find(s=>s.email===demoEmail&&s.active);const permissions=grant?.permissions??[];
  const can=(p:Permission)=>permissions.includes(p);
  const decide=(order:Order,status:'paid'|'rejected')=>{const response=status==='rejected'?window.prompt(text(lang,'سبب الرفض (اختياري)','Rejection reason (optional)')):undefined;if(status==='rejected'&&response===null)return;const reason=status==='rejected'?(response?.trim()||text(lang,'يرجى التواصل مع المتجر لمزيد من التفاصيل.','Please contact the store for details.')):undefined;setOrders(orders.map(o=>o.id===order.id?{...o,status,rejectReason:reason,code:status==='paid'?(o.code??`GLS-${Math.random().toString(36).slice(2,6).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`):undefined}:o));notify(text(lang,'تم تحديث الطلب في المعاينة','Order updated in preview'));};
  const review=(id:string)=>setRequests(requests.map(r=>r.id===id?{...r,status:'reviewed'}:r));
  const sections=[can('orders'),can('games'),can('coupons'),can('popups'),can('requests')].filter(Boolean).length;
  return <main className="page-wrap py-7 md:py-10">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-7"><div><div className="flex items-center gap-2 text-[11px] tracking-[.16em] text-[#9a7139] font-bold mb-2"><ShieldCheck size={14}/>{text(lang,'مساحة عمل الفريق','TEAM WORKSPACE')}</div><h1 className="serif text-3xl md:text-4xl font-extrabold">{text(lang,'مرحباً بفريق Glassa','Welcome, Glassa team')}</h1><p className="text-sm text-muted-foreground mt-2">{text(lang,'الأدوات المعروضة تتبع الصلاحيات الممنوحة لحسابك.','Tools shown here follow the permissions assigned to your account.')}</p></div><span className="pill !py-2" data-testid="text-staff-identity"><UserRound size={14}/>{demoEmail}</span></div>
    {!grant?<div className="surface max-w-[750px] p-7 md:p-10"><EmptyState icon={<LockKeyhole size={25}/>} title={text(lang,'لا توجد صلاحيات فعّالة','No active access')} body={text(lang,'لا يوجد منح صلاحية لهذا الحساب في بيانات المعاينة. اطلب من المالك تحديث إعدادات الفريق.','There is no active grant for this account in the preview. Ask the owner to update team access.')} actionLabel={text(lang,'العودة للمتجر','Back to store')} href="/"/></div>:<>
      <div className="surface p-4 md:p-5 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3"><div><div className="text-xs text-muted-foreground mb-2">{text(lang,'صلاحياتك الحالية','YOUR CURRENT PERMISSIONS')}</div><div className="flex flex-wrap gap-2">{permissions.map(p=><span className="pill" key={p}>{permissionName(p,lang)}</span>)}</div></div><span className="text-xs text-muted-foreground">{sections} {text(lang,'مساحات متاحة','areas available')}</span></div>
      {!sections&&<EmptyState icon={<LockKeyhole size={24}/>} title={text(lang,'لم تُمنح صلاحيات بعد','No tools assigned')} body={text(lang,'تواصل مع المالك لطلب الصلاحيات المناسبة لدورك.','Ask the owner to grant the permissions needed for your role.')}/>}
      {can('orders')&&<section className="surface p-5 md:p-7 mb-5"><AdminHeading title={text(lang,'مراجعة الطلبات','Order review')} note={text(lang,'يمكنك اعتماد أو رفض الطلبات بصلاحية مخصصة.','Your grant allows approving or rejecting orders.')}/>{orders.length?orders.map(order=><OrderRow key={order.id} order={order} onApprove={()=>decide(order,'paid')} onReject={()=>decide(order,'rejected')}/>):<InlineEmpty text={text(lang,'لا توجد طلبات.','No orders right now.')}/>}</section>}
      {can('games')&&<div className="mb-5"><GamesManager/></div>}
      {can('coupons')&&<div className="mb-5"><CouponsManager/></div>}
      {can('popups')&&<div className="mb-5"><PromoManager/></div>}
      {can('requests')&&<div className="mb-5"><RequestsManager onReview={review}/></div>}
      <div className="mt-4 text-[11px] text-muted-foreground flex items-center gap-2"><ShieldCheck size={14}/>{text(lang,'معاينة صلاحيات فقط؛ يجب التحقق من المنح الفعلية على الخادم لكل إجراء.','Permission preview only; every operation must enforce real grants server-side.')}</div>
    </>}
  </main>;
}

function PageIntro({eyebrow,title,subtitle}:{eyebrow:string;title:string;subtitle:string}) {
  return <div className="mb-8 md:mb-10"><div className="text-[11px] tracking-[.18em] text-[#9a7139] font-bold mb-2">{eyebrow}</div><h1 className="serif text-3xl md:text-5xl font-extrabold">{title}</h1><p className="text-sm text-muted-foreground mt-2">{subtitle}</p></div>;
}
function EmptyState({icon,title,body,action,actionLabel,href}:{icon:ReactNode;title:string;body:string;action?:()=>void;actionLabel?:string;href?:string}) {
  const {lang}=useStore();
  return <div className="surface max-w-[640px] mx-auto py-12 px-6 text-center" data-testid="empty-state"><span className="w-14 h-14 rounded-2xl bg-[#edf0e8] text-[#466858] grid place-items-center mx-auto mb-4">{icon}</span><h2 className="serif text-2xl font-extrabold">{title}</h2><p className="text-sm text-muted-foreground max-w-[370px] mx-auto mt-2 leading-6">{body}</p>{actionLabel&&href?<Link href={href} className="btn btn-primary no-underline mt-5" data-testid="link-empty-action">{actionLabel}<ArrowLeft size={15}/></Link>:actionLabel&&action?<button className="btn btn-quiet mt-5" onClick={action} data-testid="button-empty-action">{actionLabel}</button>:null}<div className="mt-6 text-[10px] text-muted-foreground">{text(lang,'GLASSA GAMES · اختيارات مدروسة','GLASSA GAMES · A considered collection')}</div></div>;
}
function NotFoundPage() {
  const {lang}=useStore();
  return <main className="page-wrap py-16"><EmptyState icon={<CircleHelp size={25}/>} title={text(lang,'هذه الصفحة غير موجودة','This page isn’t here')} body={text(lang,'يبدو أن الرابط تغيّر. لنعد إلى الألعاب المختارة.','This link may have changed. Let’s return to the collection.')} actionLabel={text(lang,'العودة للمتجر','Back to store')} href="/"/></main>;
}

export default App;

