import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { Link, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useLowStock, useServerPing } from '../api/queries';
import {
  LayoutDashboard, Package, ShoppingCart, Coffee, LogOut, Menu, X, User,
  Search, Bell, Maximize2, Minimize2, ChevronsLeft, ChevronsRight,
  AlertTriangle, CornerDownLeft, Check,
} from 'lucide-react';
import logoImage from '../assets/logo.jpg';

/* ------------------------------------------------------------------ */
/*  Config & helpers                                                   */
/* ------------------------------------------------------------------ */
const COLLAPSE_KEY = 'nxt_sidebar_collapsed';

const NAV_ITEMS = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, sub: 'Business overview' },
  { name: 'Inventory', path: '/inventory', icon: Package, sub: 'Stock and products' },
  { name: 'Point of Sale', path: '/pos', icon: ShoppingCart, sub: 'Billing and orders' },
  { name: 'Staff Treats', path: '/treats', icon: Coffee, sub: 'Internal consumption' },
];

function useIsDesktop() {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)');
    const h = (e) => setV(e.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return v;
}

function useClickOutside(ref, onOut, active) {
  useEffect(() => {
    if (!active) return;
    const h = (e) => ref.current && !ref.current.contains(e.target) && onOut();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onOut, active]);
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hidden xl:block text-right leading-tight">
      <p className="text-sm font-bold text-white tabular-nums">
        {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
      </p>
      <p className="text-[11px] text-gray-500">{now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}</p>
    </div>
  );
}

const iconBtn =
  'relative w-10 h-10 rounded-xl bg-white/[0.04] hover:bg-white/10 border border-white/[0.06] hover:border-gold-500/30 flex items-center justify-center text-gray-400 hover:text-gold-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500';

/* ------------------------------------------------------------------ */
/*  Layout                                                             */
/* ------------------------------------------------------------------ */
export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const isDesktop = useIsDesktop();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const compact = isDesktop && collapsed;

  const [hovered, setHovered] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const queryClient = useQueryClient();

  const mainRef = useRef(null);
  const notifRef = useRef(null);
  const profileRef = useRef(null);

  const current = NAV_ITEMS.find((i) => location.pathname.startsWith(i.path)) || { name: 'NXT VIBE', sub: '', path: location.pathname };

  /* ---------------- Actions ---------------- */
  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      const n = !c;
      try { localStorage.setItem(COLLAPSE_KEY, n ? '1' : '0'); } catch { /* ignore */ }
      return n;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }, []);

  const doLogout = () => {
    localStorage.removeItem('token');
    queryClient.clear();
    navigate('/');
  };

  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  useClickOutside(notifRef, () => setNotifOpen(false), notifOpen);
  useClickOutside(profileRef, () => setProfileOpen(false), profileOpen);

  /* ---------------- Live data: low stock + server ping ---------------- */
  const { data: lowStock = [] } = useLowStock();
  const ping = useServerPing();
  const server = ping.isSuccess ? { state: 'ok', ms: ping.data } : ping.isError ? { state: 'down', ms: null } : { state: 'pending', ms: null };

  // Close menus and scroll to top after navigating
  useEffect(() => {
    setIsSidebarOpen(false);
    setNotifOpen(false);
    setProfileOpen(false);
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  /* ---------------- Command palette items ---------------- */
  const commands = useMemo(
    () => [
      ...NAV_ITEMS.map((i, idx) => ({ id: i.path, label: `Go to ${i.name}`, hint: `Alt+${idx + 1}`, icon: i.icon, group: 'Navigate', run: () => navigate(i.path) })),
      { id: 'collapse', label: collapsed ? 'Expand sidebar' : 'Collapse sidebar', hint: 'Alt+B', icon: collapsed ? ChevronsRight : ChevronsLeft, group: 'Actions', run: toggleCollapse },
      { id: 'fs', label: isFullscreen ? 'Exit full screen' : 'Enter full screen', hint: '', icon: isFullscreen ? Minimize2 : Maximize2, group: 'Actions', run: toggleFullscreen },
      { id: 'logout', label: 'Sign out', hint: '', icon: LogOut, group: 'Actions', run: () => setLogoutOpen(true) },
    ],
    [collapsed, isFullscreen, navigate, toggleCollapse, toggleFullscreen]
  );

  /* ---------------- Global shortcuts ---------------- */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.altKey && /^Digit[1-4]$/.test(e.code)) {
        e.preventDefault();
        navigate(NAV_ITEMS[Number(e.code.slice(-1)) - 1].path);
      }
      if (e.altKey && e.code === 'KeyB') {
        e.preventDefault();
        toggleCollapse();
      }
      if (e.key === 'Escape') {
        if (logoutOpen) setLogoutOpen(false);
        else if (paletteOpen) setPaletteOpen(false);
        else if (notifOpen) setNotifOpen(false);
        else if (profileOpen) setProfileOpen(false);
        else if (isSidebarOpen) setIsSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, toggleCollapse, logoutOpen, paletteOpen, notifOpen, profileOpen, isSidebarOpen]);

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-[100dvh] bg-black font-sans overflow-hidden">
        {/* Route-change progress line */}
        <motion.div
          key={location.pathname}
          aria-hidden
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: 1, opacity: [1, 1, 0] }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="fixed top-0 inset-x-0 h-[2px] z-[70] origin-left bg-gradient-to-r from-gold-600 via-gold-300 to-amber-200 shadow-[0_0_12px_rgba(212,175,55,0.8)]"
        />

        {/* Mobile overlay */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-40 lg:hidden backdrop-blur-sm"
              onClick={() => setIsSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* ===================== SIDEBAR ===================== */}
        <motion.aside
          initial={false}
          animate={{ x: isDesktop ? 0 : isSidebarOpen ? 0 : '-100%', width: compact ? 84 : 288 }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          drag={!isDesktop && isSidebarOpen ? 'x' : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={{ left: 0.5, right: 0 }}
          dragSnapToOrigin
          onDragEnd={(_, info) => {
            if (info.offset.x < -80 || info.velocity.x < -400) setIsSidebarOpen(false);
          }}
          className="fixed lg:static inset-y-0 left-0 z-50 bg-dark-900 border-r border-gold-700/30 flex flex-col shrink-0"
        >
          {/* subtle inner glow */}
          <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute -top-24 -left-24 w-64 h-64 rounded-full bg-gold-500/[0.07] blur-3xl" />
            <div className="absolute bottom-0 inset-x-0 h-40 bg-gradient-to-t from-gold-500/[0.04] to-transparent" />
          </div>

          {/* Brand */}
          <div className={`relative flex items-center h-20 border-b border-white/5 ${compact ? 'justify-center px-2' : 'justify-between px-6'}`}>
            <Link to="/dashboard" className="flex items-center gap-3 min-w-0 group">
              <motion.div whileHover={{ rotate: [0, -6, 6, 0] }} transition={{ duration: 0.6 }} className="relative shrink-0">
                <span aria-hidden className="absolute -inset-1.5 rounded-xl bg-gold-500/30 blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
                <img src={logoImage} alt="Logo" className="relative w-11 h-11 rounded-xl object-contain bg-black/50 border border-gold-500/30 p-0.5" />
              </motion.div>
              <AnimatePresence initial={false}>
                {!compact && (
                  <motion.span
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.15 }}
                    className="text-xl font-serif font-bold text-transparent bg-clip-text bg-gold-gradient tracking-wider whitespace-nowrap"
                  >
                    NXT VIBE
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
            <button onClick={() => setIsSidebarOpen(false)} aria-label="Close menu" className="lg:hidden text-gray-400 hover:text-white p-1">
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Nav */}
          <nav
            onMouseLeave={() => setHovered(null)}
            className={`relative flex-1 py-6 space-y-1.5 ${compact ? 'px-3 overflow-visible' : 'px-4 overflow-y-auto overflow-x-hidden'}`}
          >
            {!compact && <p className="px-3 mb-2 text-[10px] font-bold tracking-[0.2em] text-gray-600 uppercase">Menu</p>}
            {NAV_ITEMS.map((item, idx) => {
              const isActive = location.pathname.startsWith(item.path);
              const Icon = item.icon;
              const badge = item.path === '/inventory' ? lowStock.length : 0;
              return (
                <motion.div
                  key={item.path}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + idx * 0.06, type: 'spring', stiffness: 260, damping: 24 }}
                  className="relative group/item"
                  onMouseEnter={() => setHovered(item.path)}
                >
                  <Link
                    to={item.path}
                    aria-current={isActive ? 'page' : undefined}
                    className={`relative flex items-center rounded-xl py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 ${compact ? 'justify-center px-0' : 'gap-3 px-4'} ${isActive ? 'text-gold-400' : 'text-gray-400 hover:text-white'}`}
                  >
                    {hovered === item.path && !isActive && (
                      <motion.span layoutId="navHover" className="absolute inset-0 rounded-xl bg-white/[0.05]" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />
                    )}
                    {isActive && (
                      <motion.span
                        layoutId="navActive"
                        className="absolute inset-0 rounded-xl bg-gold-500/10 border border-gold-500/20 shadow-[inset_0_0_20px_rgba(212,175,55,0.06)]"
                        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                      />
                    )}
                    {isActive && (
                      <motion.span layoutId="navBar" className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-gold-400 shadow-[0_0_10px_rgba(212,175,55,0.9)]" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
                    )}

                    <motion.span whileHover={{ scale: 1.15, rotate: -6 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }} className="relative z-10">
                      <Icon className={`w-5 h-5 ${isActive ? 'text-gold-400' : 'text-gray-500 group-hover/item:text-gold-300'} transition-colors`} />
                      {compact && badge > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-dark-900" />}
                    </motion.span>

                    {!compact && (
                      <>
                        <span className="relative z-10 font-medium flex-1 whitespace-nowrap">{item.name}</span>
                        {badge > 0 && (
                          <motion.span
                            key={badge}
                            initial={{ scale: 0.5 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 14 }}
                            className="relative z-10 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25 text-[11px] font-black flex items-center justify-center"
                          >
                            {badge}
                          </motion.span>
                        )}
                      </>
                    )}
                  </Link>

                  {/* Tooltip when collapsed */}
                  {compact && (
                    <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-4 z-50 px-3 py-1.5 rounded-lg bg-black border border-white/10 text-xs font-semibold text-white whitespace-nowrap opacity-0 -translate-x-1 group-hover/item:opacity-100 group-hover/item:translate-x-0 transition-all duration-150 shadow-xl">
                      {item.name}
                      {badge > 0 && <span className="ml-2 text-red-400">{badge} low</span>}
                    </span>
                  )}
                </motion.div>
              );
            })}
          </nav>

          {/* Footer */}
          <div className={`relative border-t border-white/5 space-y-2 ${compact ? 'p-3' : 'p-4'}`}>
            {/* Server status */}
            <div
              title={server.state === 'ok' ? `Server online · ${server.ms} ms` : server.state === 'down' ? 'Server offline' : 'Connecting…'}
              className={`flex items-center rounded-xl bg-white/[0.03] border border-white/[0.05] ${compact ? 'justify-center py-3' : 'gap-3 px-4 py-2.5'}`}
            >
              <span className="relative flex w-2 h-2 shrink-0">
                {server.state === 'ok' && <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-70" />}
                <span className={`relative w-2 h-2 rounded-full ${server.state === 'ok' ? 'bg-emerald-400' : server.state === 'down' ? 'bg-red-400' : 'bg-gray-500'}`} />
              </span>
              {!compact && (
                <div className="min-w-0 leading-tight">
                  <p className="text-xs font-semibold text-gray-300">
                    {server.state === 'ok' ? 'Server online' : server.state === 'down' ? 'Server offline' : 'Connecting…'}
                  </p>
                  {server.ms !== null && <p className="text-[10px] text-gray-500 tabular-nums">{server.ms} ms</p>}
                </div>
              )}
            </div>

            <button
              onClick={() => setLogoutOpen(true)}
              title="Sign out"
              className={`flex items-center w-full rounded-xl text-red-400 hover:bg-red-500/10 transition-colors py-3 ${compact ? 'justify-center' : 'gap-3 px-4'}`}
            >
              <LogOut className="w-5 h-5" />
              {!compact && <span className="font-medium">Sign Out</span>}
            </button>

            <button
              onClick={toggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden lg:flex items-center justify-center w-full py-2 rounded-xl text-gray-600 hover:text-gold-400 hover:bg-white/[0.04] transition-colors"
            >
              {collapsed ? <ChevronsRight className="w-4 h-4" /> : <><ChevronsLeft className="w-4 h-4" /><span className="ml-2 text-[11px] font-semibold">Collapse</span></>}
            </button>
          </div>
        </motion.aside>

        {/* ===================== MAIN ===================== */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          {/* Ambient glow */}
          <motion.div
            aria-hidden
            className="absolute top-0 right-0 w-[800px] h-[800px] bg-gold-600/[0.06] rounded-full blur-[150px] pointer-events-none -translate-y-1/2 translate-x-1/3"
            animate={{ x: [0, -40, 0], y: [0, 30, 0] }}
            transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Header */}
          <header className="h-20 bg-dark-900/60 backdrop-blur-xl border-b border-gold-700/20 flex items-center gap-3 px-4 sm:px-8 z-30 sticky top-0">
            <button onClick={() => setIsSidebarOpen(true)} aria-label="Open menu" className="lg:hidden text-gray-300 hover:text-white p-2 -ml-2">
              <Menu className="w-6 h-6" />
            </button>

            {/* Title */}
            <div className="min-w-0 overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={current.path}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18 }}
                >
                  <p className="hidden sm:block text-[10px] tracking-[0.2em] uppercase text-gray-600">NXT VIBE <span className="text-gold-600">/</span> {current.sub}</p>
                  <h1 className="text-base sm:text-lg font-black text-white truncate">{current.name}</h1>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {/* Command palette trigger */}
              <button
                onClick={() => setPaletteOpen(true)}
                aria-label="Open command palette"
                className="hidden md:flex items-center gap-3 pl-3 pr-2 h-10 w-56 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] hover:border-gold-500/30 text-sm text-gray-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
              >
                <Search className="w-4 h-4" />
                <span className="flex-1 text-left">Search or jump to…</span>
                <kbd className="text-[10px] border border-white/10 rounded px-1.5 py-0.5">Ctrl K</kbd>
              </button>
              <button onClick={() => setPaletteOpen(true)} aria-label="Open command palette" className={`md:hidden ${iconBtn}`}>
                <Search className="w-5 h-5" />
              </button>

              <LiveClock />

              <button onClick={toggleFullscreen} aria-label="Toggle full screen" title="Full screen (great for POS)" className={`hidden sm:flex ${iconBtn}`}>
                {isFullscreen ? <Minimize2 className="w-[18px] h-[18px]" /> : <Maximize2 className="w-[18px] h-[18px]" />}
              </button>

              {/* Notifications */}
              <div ref={notifRef} className="relative">
                <button onClick={() => { setNotifOpen((o) => !o); setProfileOpen(false); }} aria-label="Low stock alerts" aria-expanded={notifOpen} className={iconBtn}>
                  <motion.span animate={lowStock.length ? { rotate: [0, -14, 12, -8, 6, 0] } : {}} transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 5 }} className="origin-top">
                    <Bell className="w-5 h-5" />
                  </motion.span>
                  {lowStock.length > 0 && (
                    <motion.span
                      key={lowStock.length}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 14 }}
                      className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center ring-2 ring-dark-900"
                    >
                      {lowStock.length > 9 ? '9+' : lowStock.length}
                    </motion.span>
                  )}
                </button>

                <AnimatePresence>
                  {notifOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.97 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      className="absolute right-0 mt-3 w-[min(92vw,22rem)] bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden origin-top-right z-50"
                    >
                      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                        <p className="font-bold text-sm text-white">Low stock alerts</p>
                        <span className="text-[11px] text-gray-500">{lowStock.length} item{lowStock.length === 1 ? '' : 's'}</span>
                      </div>
                      <div className="max-h-72 overflow-y-auto">
                        {lowStock.length === 0 ? (
                          <div className="py-10 text-center text-gray-500">
                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }} className="w-11 h-11 mx-auto mb-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                              <Check className="w-5 h-5" />
                            </motion.div>
                            <p className="text-sm font-semibold">All stocked up</p>
                          </div>
                        ) : (
                          lowStock.slice(0, 6).map((p, i) => (
                            <motion.button
                              key={p.id}
                              initial={{ opacity: 0, x: 12 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.04 }}
                              onClick={() => navigate('/inventory')}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors text-left"
                            >
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 ${p.units <= 0 ? 'bg-gray-500/10 border-gray-500/20 text-gray-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                                <AlertTriangle className="w-4 h-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-white truncate">{p.name}</p>
                                <p className="text-xs text-gray-500">{p.units <= 0 ? 'Out of stock' : `${p.units} left`} · alert at {p.threshold}</p>
                              </div>
                            </motion.button>
                          ))
                        )}
                      </div>
                      {lowStock.length > 0 && (
                        <button onClick={() => navigate('/inventory')} className="w-full py-3 text-xs font-bold text-gold-400 hover:bg-gold-500/10 border-t border-white/5 transition-colors">
                          {lowStock.length > 6 ? `View all ${lowStock.length} in Inventory` : 'Open Inventory'}
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Profile */}
              <div ref={profileRef} className="relative">
                <button onClick={() => { setProfileOpen((o) => !o); setNotifOpen(false); }} aria-label="Account menu" aria-expanded={profileOpen} className="flex items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded-full">
                  <div className="text-right hidden sm:block">
                    <p className="text-sm font-bold text-white leading-tight">Business Admin</p>
                    <p className="text-xs text-gold-500">Premium Account</p>
                  </div>
                  <span className="relative w-10 h-10 rounded-full p-[1.5px] overflow-hidden block">
                    <span aria-hidden className="absolute -inset-full animate-[spin_6s_linear_infinite]" style={{ background: 'conic-gradient(from 0deg, transparent, rgba(212,175,55,1), transparent 60%)' }} />
                    <span className="relative w-full h-full rounded-full bg-dark-800 flex items-center justify-center">
                      <User className="w-5 h-5 text-gold-400" />
                    </span>
                  </span>
                </button>

                <AnimatePresence>
                  {profileOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.97 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      className="absolute right-0 mt-3 w-60 bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden origin-top-right z-50"
                    >
                      <div className="px-4 py-3 border-b border-white/5">
                        <p className="text-sm font-bold text-white">Business Admin</p>
                        <p className="text-xs text-gold-500">Premium Account</p>
                      </div>
                      <div className="p-2">
                        <button onClick={() => { setProfileOpen(false); setPaletteOpen(true); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-300 hover:bg-white/[0.05] transition-colors">
                          <Search className="w-4 h-4 text-gray-500" /> Command palette
                          <kbd className="ml-auto text-[10px] border border-white/10 rounded px-1.5 py-0.5 text-gray-500">Ctrl K</kbd>
                        </button>
                        <button onClick={() => { setProfileOpen(false); setLogoutOpen(true); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                          <LogOut className="w-4 h-4" /> Sign out
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </header>

          {/* Page content with route transitions */}
          <main ref={mainRef} className="flex-1 overflow-y-auto p-4 sm:p-8 z-10">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                <Suspense fallback={<div className="py-24 flex justify-center"><div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-[#D4AF37] animate-spin" /></div>}>
                  {outlet}
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        {/* ===================== COMMAND PALETTE ===================== */}
        <AnimatePresence>
          {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
        </AnimatePresence>

        {/* ===================== SIGN-OUT CONFIRM ===================== */}
        <AnimatePresence>
          {logoutOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLogoutOpen(false)}
              className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
            >
              <motion.div
                role="alertdialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, y: 50, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 50, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                className="w-full sm:max-w-sm bg-[#0a0a0a] border border-white/10 rounded-t-[2rem] sm:rounded-3xl p-6 shadow-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]"
              >
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 border bg-red-500/10 border-red-500/20 text-red-400">
                  <LogOut className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-white">Sign out?</h3>
                <p className="text-sm text-gray-400 mt-1.5">You'll need to log in again to access the dashboard.</p>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setLogoutOpen(false)} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 font-bold text-sm text-white transition-colors">Stay</button>
                  <button onClick={doLogout} className="flex-1 py-3 rounded-xl font-bold text-sm bg-red-500 hover:bg-red-600 text-white transition-colors">Sign out</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

/* ------------------------------------------------------------------ */
/*  Command palette (Ctrl/Cmd + K)                                     */
/* ------------------------------------------------------------------ */
function CommandPalette({ commands, onClose }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => setIndex(0), [query]);

  const run = (cmd) => {
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[index]);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[95] bg-black/75 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: -20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="w-full max-w-lg bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 border-b border-white/5">
          <Search className="w-5 h-5 text-gold-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a page or action…"
            className="flex-1 bg-transparent py-4 text-white placeholder-gray-600 focus:outline-none text-sm sm:text-base"
          />
          <kbd className="text-[10px] text-gray-500 border border-white/10 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="py-10 text-center text-sm text-gray-500">No matches for "{query}"</li>}
          {results.map((cmd, i) => {
            const Icon = cmd.icon;
            const active = i === index;
            const showGroup = i === 0 || results[i - 1].group !== cmd.group;
            return (
              <React.Fragment key={cmd.id}>
                {showGroup && <li className="px-3 pt-3 pb-1 text-[10px] font-bold tracking-[0.2em] uppercase text-gray-600">{cmd.group}</li>}
                <li>
                  <button
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => run(cmd)}
                    className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-colors ${active ? 'text-white' : 'text-gray-400'}`}
                  >
                    {active && <motion.span layoutId="paletteActive" className="absolute inset-0 rounded-xl bg-gold-500/10 border border-gold-500/20" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                    <Icon className={`relative w-4 h-4 ${active ? 'text-gold-400' : 'text-gray-500'}`} />
                    <span className="relative flex-1">{cmd.label}</span>
                    {cmd.hint && <kbd className="relative text-[10px] text-gray-500 border border-white/10 rounded px-1.5 py-0.5">{cmd.hint}</kbd>}
                    {active && <CornerDownLeft className="relative w-3.5 h-3.5 text-gold-400" />}
                  </button>
                </li>
              </React.Fragment>
            );
          })}
        </ul>

        <div className="hidden sm:flex items-center gap-4 px-4 py-2.5 border-t border-white/5 text-[11px] text-gray-600">
          <span><kbd className="border border-white/10 rounded px-1">↑</kbd> <kbd className="border border-white/10 rounded px-1">↓</kbd> navigate</span>
          <span><kbd className="border border-white/10 rounded px-1">↵</kbd> select</span>
          <span className="ml-auto">Alt+1–4 jumps to a page</span>
        </div>
      </motion.div>
    </motion.div>
  );
}