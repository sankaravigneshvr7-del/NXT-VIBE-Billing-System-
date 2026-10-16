import React, { useState, useEffect, useMemo } from 'react';
import {
  motion,
  AnimatePresence,
  MotionConfig,
  useMotionValue,
  animate,
} from 'framer-motion';
import api from '../api/client';
import { useProducts, useStaffNames, useTreatsHistory, useTreatsSummary, useInvalidators } from '../api/queries';
import {
  Coffee, Users, CheckCircle, Trash2, AlertTriangle, Plus, Minus,
  Search, IndianRupee, Shield, X, Loader2, Package,
} from 'lucide-react';
import { format } from 'date-fns';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(amount || 0);

const stockOf = (p) => p.boxes_in_stock * p.units_per_box + p.loose_units_in_stock;

const AVATAR_GRADIENTS = [
  'from-amber-400 to-orange-600',
  'from-emerald-400 to-teal-600',
  'from-sky-400 to-indigo-600',
  'from-fuchsia-400 to-purple-600',
  'from-rose-400 to-red-600',
  'from-lime-400 to-green-600',
];
const gradientFor = (name = '') =>
  AVATAR_GRADIENTS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_GRADIENTS.length];

function Avatar({ name, size = 'w-9 h-9 text-sm' }) {
  return (
    <div className={`${size} rounded-full bg-gradient-to-br ${gradientFor(name)} flex items-center justify-center font-black text-white shadow-lg shrink-0`}>
      {(name || '?').charAt(0).toUpperCase()}
    </div>
  );
}

// Counts smoothly to the new value
function AnimatedNumber({ value, currency = false }) {
  const mv = useMotionValue(value);
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.7, ease: 'easeOut' });
    const unsub = mv.on('change', (v) => setDisplay(v));
    return () => {
      controls.stop();
      unsub();
    };
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{currency ? formatCurrency(display) : Math.round(display)}</>;
}

const rise = {
  hidden: { opacity: 0, y: 18 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 260, damping: 24, delay: i * 0.06 },
  }),
};

const REASONS = [
  { value: 'Staff Treat', icon: Coffee },
  { value: 'Damage/Wastage', icon: AlertTriangle },
  { value: 'Owner Consumption', icon: Shield },
  { value: 'Sampling/Promo', icon: Package },
];

const cardBase =
  'bg-gradient-to-br from-white/[0.05] to-white/[0.01] border border-white/[0.07] rounded-3xl backdrop-blur-xl';
const inputBase =
  'w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-gold-500/60 focus:shadow-[0_0_0_4px_rgba(212,175,55,0.08)] transition-all';
const labelBase = 'text-xs font-semibold text-gray-400 tracking-wide';

function StatusPill({ status }) {
  const pending = status === 'pending';
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border w-fit ${
        pending
          ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
          : 'bg-green-500/10 text-green-400 border-green-500/20'
      }`}
    >
      <span className="relative flex w-1.5 h-1.5">
        {pending && <span className="absolute inset-0 rounded-full bg-yellow-400 animate-ping opacity-70" />}
        <span className={`relative rounded-full w-1.5 h-1.5 ${pending ? 'bg-yellow-400' : 'bg-green-400'}`} />
      </span>
      {pending ? 'Unsettled' : 'Settled'}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export default function Treats() {
  const [view, setView] = useState('log'); // 'log' | 'history' | 'summary'
  const [isAdmin, setIsAdmin] = useState(false);

  // Data
  const productsQuery = useProducts();
  const staffQuery = useStaffNames();
  const historyQuery = useTreatsHistory();
  const summaryQuery = useTreatsSummary();
  const invalidators = useInvalidators();
  const products = productsQuery.data?.products ?? [];
  const staffNames = staffQuery.data ?? [];
  const treatsHistory = historyQuery.data ?? [];
  const loadingHistory = historyQuery.isLoading;
  const summary = summaryQuery.data?.summary ?? [];
  const overallTotal = summaryQuery.data?.overall_total ?? 0;

  // Form
  const [formData, setFormData] = useState({ staff_name: '', product_id: '', units: 1, reason: 'Staff Treat' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [justLogged, setJustLogged] = useState(false);

  // History filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [historySearch, setHistorySearch] = useState('');

  // Feedback UI
  const [toast, setToast] = useState(null); // { type, msg }
  const [confirm, setConfirm] = useState(null); // { title, message, confirmLabel, tone, onConfirm }
  const [confirmBusy, setConfirmBusy] = useState(false);

  const notify = (type, msg) => setToast({ type, msg, id: Date.now() });

  /* ---------------- Admin detection ---------------- */
  // Summary succeeds -> admin; 403 -> not admin
  const summaryError = summaryQuery.error;
  useEffect(() => {
    if (summaryQuery.isSuccess) setIsAdmin(true);
    else if (summaryQuery.isError && summaryError?.response?.status === 403) setIsAdmin(false);
  }, [summaryQuery.isSuccess, summaryQuery.isError, summaryError]);

  useEffect(() => {
    // Quick role check from the JWT payload (base64url-safe)
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(b64));
        if (payload.role === 'admin') setIsAdmin(true);
      }
    } catch (e) { /* ignore */ }
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Esc closes the confirm dialog
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e) => e.key === 'Escape' && !confirmBusy && setConfirm(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, confirmBusy]);

  /* ---------------- Derived ---------------- */
  const selectedProduct = useMemo(
    () => products.find((p) => String(p.id) === String(formData.product_id)),
    [products, formData.product_id]
  );
  const selectedStock = selectedProduct ? stockOf(selectedProduct) : null;
  const unitsNum = parseInt(formData.units, 10) || 0;
  const overStock = selectedStock !== null && unitsNum > selectedStock;

  const staffSuggestions = useMemo(() => {
    const q = formData.staff_name.trim().toLowerCase();
    return staffNames
      .filter((n) => n.toLowerCase() !== q && (!q || n.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [staffNames, formData.staff_name]);

  const historyStats = useMemo(() => {
    const pending = treatsHistory.filter((l) => l.status === 'pending').length;
    const units = treatsHistory.reduce((s, l) => s + (Number(l.units_consumed) || 0), 0);
    return { total: treatsHistory.length, pending, settled: treatsHistory.length - pending, units };
  }, [treatsHistory]);

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return treatsHistory.filter((l) => {
      if (statusFilter === 'pending' && l.status !== 'pending') return false;
      if (statusFilter === 'settled' && l.status === 'pending') return false;
      if (!q) return true;
      return (
        l.staff_name?.toLowerCase().includes(q) ||
        l.product_name?.toLowerCase().includes(q) ||
        l.reason?.toLowerCase().includes(q)
      );
    });
  }, [treatsHistory, statusFilter, historySearch]);

  const sortedSummary = useMemo(
    () => [...summary].sort((a, b) => (b.total_owed || 0) - (a.total_owed || 0)),
    [summary]
  );

  /* ---------------- Actions ---------------- */
  const setUnits = (delta) => {
    const next = Math.max(1, unitsNum + delta);
    setFormData((f) => ({ ...f, units: next }));
  };

  const handleLogTreat = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.product_id || !formData.staff_name.trim()) {
      setError('Please select a product and enter a staff name.');
      return;
    }
    if (unitsNum < 1) {
      setError('Quantity must be at least 1.');
      return;
    }
    if (overStock) {
      setError(`Only ${selectedStock} in stock for ${selectedProduct.name}.`);
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/treats/', {
        staff_name: formData.staff_name.trim(),
        reason: formData.reason,
        items: [{ product_id: parseInt(formData.product_id, 10), units: unitsNum }],
      });
      notify('success', 'Treat logged. Inventory updated.');
      setJustLogged(true);
      setTimeout(() => setJustLogged(false), 1600);
      setFormData((f) => ({ ...f, product_id: '', units: 1 }));

      await invalidators.afterTreatChange();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to log treat.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const askConfirm = (cfg) => setConfirm(cfg);

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.onConfirm();
    } finally {
      setConfirmBusy(false);
      setConfirm(null);
    }
  };

  const handleSettle = (staffName) =>
    askConfirm({
      title: `Settle dues for ${staffName}?`,
      message: 'All pending items for this person will be marked as settled.',
      confirmLabel: 'Mark as settled',
      tone: 'success',
      onConfirm: async () => {
        try {
          await api.post('/treats/settle', { staff_name: staffName });
          notify('success', `${staffName}'s dues are settled.`);
          await invalidators.afterTreatChange();
        } catch (err) {
          notify('error', err.response?.data?.error || 'Failed to settle dues.');
        }
      },
    });

  const handleDelete = (id) =>
    askConfirm({
      title: 'Delete this log?',
      message: 'The record is removed and the items go back into inventory.',
      confirmLabel: 'Delete and restore stock',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/treats/${id}`);
          notify('success', 'Log deleted. Stock restored.');
          await invalidators.afterTreatChange();
        } catch (err) {
          notify('error', err.response?.data?.error || 'Failed to delete log.');
        }
      },
    });

  /* ---------------- Tabs config ---------------- */
  const tabs = [
    ['log', 'Log Treat'],
    ['history', 'History'],
    ...(isAdmin ? [['summary', 'Dues']] : []),
  ];

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-[100dvh] bg-[#050505] text-white px-4 py-6 sm:p-6 lg:p-10 font-sans selection:bg-gold-500/30 overflow-y-auto relative">
        {/* Ambient background */}
        <div aria-hidden className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <motion.div
            className="absolute -top-[10%] -right-[5%] w-[45%] h-[45%] bg-gold-600/[0.07] rounded-full blur-[120px]"
            animate={{ x: [0, -50, 0], y: [0, 40, 0] }}
            transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute bottom-[-15%] -left-[10%] w-[40%] h-[40%] bg-amber-700/[0.05] rounded-full blur-[130px]"
            animate={{ x: [0, 60, 0], y: [0, -30, 0] }}
            transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(ellipse at top right, black, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(ellipse at top right, black, transparent 70%)',
            }}
          />
        </div>

        {/* Toast */}
        <div className="fixed top-4 inset-x-0 z-[90] flex justify-center px-4 pointer-events-none">
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: -30, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                className={`pointer-events-auto relative overflow-hidden flex items-center gap-3 pl-4 pr-3 py-3 rounded-2xl border backdrop-blur-xl shadow-2xl text-sm font-semibold max-w-md ${
                  toast.type === 'error'
                    ? 'bg-red-950/80 border-red-500/30 text-red-300'
                    : 'bg-emerald-950/80 border-emerald-500/30 text-emerald-300'
                }`}
              >
                {toast.type === 'error' ? <AlertTriangle className="w-5 h-5 shrink-0" /> : <CheckCircle className="w-5 h-5 shrink-0" />}
                <span>{toast.msg}</span>
                <button onClick={() => setToast(null)} aria-label="Dismiss" className="p-1 opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>
                <motion.span
                  className={`absolute bottom-0 left-0 h-[2px] ${toast.type === 'error' ? 'bg-red-400' : 'bg-emerald-400'}`}
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: 3.5, ease: 'linear' }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="max-w-6xl mx-auto relative z-10 space-y-6 sm:space-y-8">
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-4">
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-gold-400/25 to-amber-600/5 border border-gold-500/25 flex items-center justify-center shrink-0">
                <Coffee className="w-6 h-6 text-gold-400" />
                {/* steam */}
                {[0, 1].map((i) => (
                  <motion.span
                    key={i}
                    aria-hidden
                    className="absolute -top-1 w-[2px] h-3 rounded-full bg-gold-400/60"
                    style={{ left: `${40 + i * 18}%` }}
                    animate={{ y: [0, -8], opacity: [0, 0.8, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.9, ease: 'easeOut' }}
                  />
                ))}
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-white">Staff Consumption</h1>
                <p className="text-gray-500 mt-0.5 text-sm">Internal stock usage, wastage and staff dues</p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative flex bg-black/50 p-1 rounded-xl border border-white/10 w-full md:w-auto backdrop-blur"
            >
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`relative flex-1 md:flex-none md:min-w-[110px] px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2 justify-center ${
                    view === key ? 'text-gold-400' : 'text-gray-500 hover:text-white'
                  }`}
                >
                  {view === key && (
                    <motion.span
                      layoutId="treatsPill"
                      className="absolute inset-0 bg-white/10 rounded-lg shadow-sm"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  {key === 'summary' && <Shield className="w-3.5 h-3.5 relative" />}
                  <span className="relative">{label}</span>
                  {key === 'summary' && summary.length > 0 && (
                    <span className="relative min-w-[18px] h-[18px] px-1 rounded-full bg-gold-500 text-black text-[10px] font-black flex items-center justify-center">
                      {summary.length}
                    </span>
                  )}
                </button>
              ))}
            </motion.div>
          </div>

          <AnimatePresence mode="wait">
            {/* ======================= LOG ======================= */}
            {view === 'log' && (
              <motion.div
                key="log"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.2 }}
                className="grid lg:grid-cols-5 gap-6"
              >
                {/* Form */}
                <div className={`${cardBase} lg:col-span-3 p-5 sm:p-8 relative overflow-hidden`}>
                  <div className="absolute -right-10 -top-10 w-44 h-44 bg-gold-500/10 rounded-full blur-3xl pointer-events-none" />

                  {/* Success burst */}
                  <AnimatePresence>
                    {justLogged && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-20 bg-[#050505]/85 backdrop-blur-sm flex flex-col items-center justify-center"
                      >
                        <svg width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden>
                          <motion.circle cx="42" cy="42" r="36" stroke="#D4AF37" strokeWidth="3" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5 }} />
                          <motion.path d="M26 43l11 11 21-24" stroke="#D4AF37" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.45 }} />
                        </svg>
                        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }} className="mt-4 font-black text-lg">Logged</motion.p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <motion.h2 variants={rise} initial="hidden" animate="show" custom={0} className="text-xl sm:text-2xl font-bold text-white mb-1">
                    Record internal usage
                  </motion.h2>
                  <motion.p variants={rise} initial="hidden" animate="show" custom={1} className="text-sm text-gray-500 mb-6">
                    Items are deducted from inventory straight away.
                  </motion.p>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                        animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
                        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                        className="overflow-hidden"
                      >
                        <motion.div
                          animate={{ x: [0, -8, 8, -5, 5, 0] }}
                          transition={{ duration: 0.4 }}
                          className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-3"
                        >
                          <AlertTriangle className="w-5 h-5 flex-shrink-0" /> {error}
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <form onSubmit={handleLogTreat} className="space-y-6 relative z-10">
                    {/* Staff */}
                    <motion.div variants={rise} initial="hidden" animate="show" custom={2} className="space-y-2">
                      <label htmlFor="staff" className={labelBase}>Staff name</label>
                      <input
                        id="staff"
                        type="text"
                        required
                        autoComplete="off"
                        value={formData.staff_name}
                        onChange={(e) => setFormData({ ...formData, staff_name: e.target.value })}
                        className={inputBase}
                        placeholder="Type a name or pick below"
                      />
                      <AnimatePresence initial={false}>
                        {staffSuggestions.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="flex flex-wrap gap-2 overflow-hidden pt-1"
                          >
                            {staffSuggestions.map((n) => (
                              <motion.button
                                key={n}
                                type="button"
                                layout
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                whileTap={{ scale: 0.94 }}
                                onClick={() => setFormData({ ...formData, staff_name: n })}
                                className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-white/5 hover:bg-gold-500/15 border border-white/10 hover:border-gold-500/30 text-xs font-semibold text-gray-300 hover:text-gold-400 transition-colors"
                              >
                                <Avatar name={n} size="w-6 h-6 text-[10px]" /> {n}
                              </motion.button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>

                    {/* Product */}
                    <motion.div variants={rise} initial="hidden" animate="show" custom={3} className="space-y-2">
                      <label htmlFor="product" className={labelBase}>Product</label>
                      <div className="relative">
                        <select
                          id="product"
                          required
                          value={formData.product_id}
                          onChange={(e) => setFormData({ ...formData, product_id: e.target.value })}
                          className={`${inputBase} appearance-none pr-10`}
                        >
                          <option value="" disabled>Select an item</option>
                          {products.map((p) => {
                            const s = stockOf(p);
                            return (
                              <option key={p.id} value={p.id} disabled={s <= 0}>
                                {p.name} (Stock: {s})
                              </option>
                            );
                          })}
                        </select>
                        <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path d="M5.5 7.5l4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </div>

                      {/* Live stock gauge */}
                      <AnimatePresence initial={false}>
                        {selectedProduct && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-2 p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                              <div className="flex justify-between text-xs mb-2">
                                <span className="text-gray-400">In stock</span>
                                <span className={`font-bold tabular-nums ${overStock ? 'text-red-400' : 'text-white'}`}>
                                  {selectedStock} units
                                  {unitsNum > 0 && !overStock && <span className="text-gray-500 font-medium"> → {selectedStock - unitsNum} after</span>}
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden relative">
                                <motion.div
                                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-500 to-amber-300"
                                  animate={{ width: `${selectedStock > 0 ? Math.max(0, Math.min(100, ((selectedStock - Math.min(unitsNum, selectedStock)) / selectedStock) * 100)) : 0}%` }}
                                  transition={{ type: 'spring', stiffness: 180, damping: 22 }}
                                />
                                {overStock && <div className="absolute inset-0 bg-red-500/70" />}
                              </div>
                              {overStock && <p className="text-[11px] text-red-400 mt-2">Quantity is higher than the stock available.</p>}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>

                    {/* Quantity */}
                    <motion.div variants={rise} initial="hidden" animate="show" custom={4} className="space-y-2">
                      <label htmlFor="qty" className={labelBase}>Quantity</label>
                      <div className="flex items-stretch gap-2">
                        <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => setUnits(-1)} aria-label="Decrease quantity" className="w-12 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-gray-300 transition-colors">
                          <Minus className="w-4 h-4" />
                        </motion.button>
                        <input
                          id="qty"
                          type="number"
                          inputMode="numeric"
                          min="1"
                          required
                          value={formData.units}
                          onChange={(e) => setFormData({ ...formData, units: e.target.value })}
                          className={`${inputBase} text-center text-lg font-bold tabular-nums`}
                        />
                        <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => setUnits(1)} aria-label="Increase quantity" className="w-12 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-gray-300 transition-colors">
                          <Plus className="w-4 h-4" />
                        </motion.button>
                      </div>
                    </motion.div>

                    {/* Reason */}
                    <motion.div variants={rise} initial="hidden" animate="show" custom={5} className="space-y-2">
                      <span className={labelBase}>Reason</span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Reason">
                        {REASONS.map(({ value, icon: Icon }) => {
                          const active = formData.reason === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              onClick={() => setFormData({ ...formData, reason: value })}
                              className={`relative flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border text-[11px] sm:text-xs font-bold text-center leading-tight transition-colors ${
                                active ? 'text-gold-400 border-gold-500/40' : 'text-gray-500 border-white/10 hover:text-gray-300 hover:bg-white/5'
                              }`}
                            >
                              {active && (
                                <motion.span layoutId="reasonPill" className="absolute inset-0 rounded-xl bg-gold-500/10" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
                              )}
                              <Icon className="w-4 h-4 relative" />
                              <span className="relative">{value}</span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>

                    <motion.div variants={rise} initial="hidden" animate="show" custom={6}>
                      <button
                        type="submit"
                        disabled={isSubmitting || overStock}
                        className="relative overflow-hidden w-full mt-2 bg-gradient-to-r from-gold-400 to-amber-500 text-black py-4 rounded-xl font-black text-base sm:text-lg hover:shadow-[0_0_28px_rgba(212,175,55,0.4)] active:scale-[0.99] transition-all disabled:opacity-40 disabled:pointer-events-none flex justify-center items-center gap-2"
                      >
                        <motion.span
                          aria-hidden
                          className="absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                          initial={{ x: '-150%' }}
                          animate={{ x: '450%' }}
                          transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 3, ease: 'easeInOut' }}
                        />
                        <span className="relative flex items-center gap-2">
                          {isSubmitting ? (
                            <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
                          ) : (
                            <><Plus className="w-5 h-5" /> Deduct from inventory</>
                          )}
                        </span>
                      </button>
                    </motion.div>
                  </form>
                </div>

                {/* Recent activity */}
                <motion.aside variants={rise} initial="hidden" animate="show" custom={3} className={`${cardBase} lg:col-span-2 p-5 sm:p-6 self-start`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-white">Recent activity</h3>
                    <button onClick={() => setView('history')} className="text-xs font-semibold text-gold-400 hover:text-gold-300">View all</button>
                  </div>
                  <ul className="space-y-2.5">
                    <AnimatePresence initial={false} mode="popLayout">
                      {treatsHistory.slice(0, 5).map((log) => (
                        <motion.li
                          key={log.id}
                          layout
                          initial={{ opacity: 0, x: 30, scale: 0.95 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          exit={{ opacity: 0, x: -30 }}
                          transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                          className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.05]"
                        >
                          <Avatar name={log.staff_name} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-white truncate">{log.staff_name}</p>
                            <p className="text-xs text-gray-500 truncate">{log.units_consumed} × {log.product_name}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[11px] text-gray-500">{format(new Date(log.created_at), 'dd MMM, HH:mm')}</p>
                            <span className={`text-[10px] font-bold ${log.status === 'pending' ? 'text-yellow-400' : 'text-green-400'}`}>
                              {log.status === 'pending' ? 'Unsettled' : 'Settled'}
                            </span>
                          </div>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                  {!loadingHistory && treatsHistory.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                      <Coffee className="w-9 h-9 mx-auto mb-2 opacity-25" />
                      <p className="text-sm font-semibold">Nothing logged yet</p>
                      <p className="text-xs text-gray-600 mt-1">New entries will show up here.</p>
                    </div>
                  )}
                </motion.aside>
              </motion.div>
            )}

            {/* ======================= HISTORY ======================= */}
            {view === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
              >
                {/* Stat tiles */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  {[
                    ['Total logs', historyStats.total, 'text-white'],
                    ['Unsettled', historyStats.pending, 'text-yellow-400'],
                    ['Settled', historyStats.settled, 'text-green-400'],
                    ['Units used', historyStats.units, 'text-gold-400'],
                  ].map(([label, val, color], i) => (
                    <motion.div key={label} variants={rise} initial="hidden" animate="show" custom={i} className={`${cardBase} p-4 sm:p-5`}>
                      <p className="text-xs text-gray-500 font-semibold">{label}</p>
                      <p className={`text-2xl sm:text-3xl font-black mt-1 tabular-nums ${color}`}>
                        <AnimatedNumber value={val} />
                      </p>
                    </motion.div>
                  ))}
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex bg-black/50 p-1 rounded-xl border border-white/10 sm:w-auto">
                    {[
                      ['all', 'All'],
                      ['pending', 'Unsettled'],
                      ['settled', 'Settled'],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setStatusFilter(key)}
                        className={`relative flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${statusFilter === key ? 'text-gold-400' : 'text-gray-500 hover:text-white'}`}
                      >
                        {statusFilter === key && (
                          <motion.span layoutId="filterPill" className="absolute inset-0 bg-white/10 rounded-lg" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
                        )}
                        <span className="relative">{label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Search staff, product or reason"
                      className={`${inputBase} pl-10 py-2.5 text-sm`}
                    />
                  </div>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden space-y-2.5">
                  {loadingHistory &&
                    [0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-white/[0.04] animate-pulse" />)}
                  <AnimatePresence initial={false}>
                    {filteredHistory.map((log, i) => (
                      <motion.div
                        key={log.id}
                        layout
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -40 }}
                        transition={{ delay: Math.min(i, 8) * 0.03 }}
                        className={`${cardBase} p-4`}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar name={log.staff_name} />
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-white truncate">{log.staff_name}</p>
                            <p className="text-xs text-gray-500">{format(new Date(log.created_at), 'dd MMM, HH:mm')}</p>
                          </div>
                          <StatusPill status={log.status} />
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <p className="text-gray-300 truncate">{log.product_name}</p>
                            <p className="text-xs text-gray-500">{log.reason}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 font-black tabular-nums">× {log.units_consumed}</span>
                            {isAdmin && (
                              <button onClick={() => handleDelete(log.id)} aria-label="Delete log" className="w-9 h-9 flex items-center justify-center bg-white/5 active:bg-red-500/20 text-red-400 rounded-lg border border-white/5"><Trash2 className="w-4 h-4" /></button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                {/* Desktop table */}
                <div className={`hidden md:block ${cardBase} overflow-hidden`}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left whitespace-nowrap">
                      <thead className="bg-black/40 border-b border-white/10">
                        <tr className="text-xs uppercase tracking-widest text-gray-500">
                          <th className="py-4 px-6 font-bold">Date &amp; time</th>
                          <th className="py-4 px-6 font-bold">Staff</th>
                          <th className="py-4 px-6 font-bold">Product</th>
                          <th className="py-4 px-6 font-bold text-center">Qty</th>
                          <th className="py-4 px-6 font-bold">Reason</th>
                          <th className="py-4 px-6 font-bold">Status</th>
                          {isAdmin && <th className="py-4 px-6 font-bold text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {loadingHistory &&
                          [0, 1, 2, 3].map((i) => (
                            <tr key={i}><td colSpan={isAdmin ? 7 : 6} className="py-4 px-6"><div className="h-8 rounded-lg bg-white/[0.04] animate-pulse" /></td></tr>
                          ))}
                        {!loadingHistory && filteredHistory.length === 0 && (
                          <tr>
                            <td colSpan={isAdmin ? 7 : 6} className="py-14 text-center text-gray-500">
                              <Coffee className="w-9 h-9 mx-auto mb-2 opacity-25" />
                              <p className="font-semibold">{treatsHistory.length === 0 ? 'No consumption records yet' : 'No records match your filters'}</p>
                            </td>
                          </tr>
                        )}
                        {filteredHistory.map((log, i) => (
                          <motion.tr
                            key={log.id}
                            initial={{ opacity: 0, x: -14 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: Math.min(i, 12) * 0.025 }}
                            className="group hover:bg-white/[0.03] transition-colors text-sm"
                          >
                            <td className="py-3.5 px-6 text-gray-400">{format(new Date(log.created_at), 'dd MMM, HH:mm')}</td>
                            <td className="py-3.5 px-6">
                              <div className="flex items-center gap-3 font-bold text-white"><Avatar name={log.staff_name} size="w-8 h-8 text-xs" /> {log.staff_name}</div>
                            </td>
                            <td className="py-3.5 px-6 text-gray-300">{log.product_name}</td>
                            <td className="py-3.5 px-6 text-center font-black text-white tabular-nums">{log.units_consumed}</td>
                            <td className="py-3.5 px-6 text-gray-400">{log.reason}</td>
                            <td className="py-3.5 px-6"><StatusPill status={log.status} /></td>
                            {isAdmin && (
                              <td className="py-3.5 px-6 text-right">
                                <button onClick={() => handleDelete(log.id)} aria-label="Delete log" className="p-2 bg-white/5 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors border border-white/5 sm:opacity-60 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button>
                              </td>
                            )}
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ======================= SUMMARY ======================= */}
            {view === 'summary' && isAdmin && (
              <motion.div
                key="summary"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <div className="relative overflow-hidden bg-gradient-to-r from-gold-500/15 via-gold-500/5 to-transparent border border-gold-500/20 rounded-3xl p-5 sm:p-7 flex items-center justify-between gap-4">
                  <motion.div
                    aria-hidden
                    className="absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-gold-400/10 to-transparent"
                    initial={{ x: '-100%' }}
                    animate={{ x: '400%' }}
                    transition={{ duration: 2, delay: 0.3, ease: 'easeOut' }}
                  />
                  <div className="relative min-w-0">
                    <p className="text-gold-400 text-sm font-semibold mb-1">Total pending value</p>
                    <h2 className="text-3xl sm:text-5xl font-black text-white tabular-nums truncate">
                      <AnimatedNumber value={overallTotal} currency />
                    </h2>
                    <p className="text-xs text-gray-500 mt-2">
                      {summary.length} {summary.length === 1 ? 'person has' : 'people have'} unsettled items
                    </p>
                  </div>
                  <motion.div
                    animate={{ rotate: [0, -6, 6, 0] }}
                    transition={{ duration: 4, repeat: Infinity, repeatDelay: 3 }}
                    className="relative w-14 h-14 sm:w-16 sm:h-16 bg-gold-500/20 rounded-2xl flex items-center justify-center text-gold-400 border border-gold-500/30 shrink-0"
                  >
                    <IndianRupee className="w-7 h-7 sm:w-8 sm:h-8" />
                  </motion.div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {sortedSummary.length === 0 ? (
                    <motion.div variants={rise} initial="hidden" animate="show" className="col-span-full py-14 text-center text-gray-500 bg-white/[0.02] border border-white/5 rounded-3xl">
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
                        <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500/60" />
                      </motion.div>
                      <p className="font-semibold">All staff dues are settled</p>
                    </motion.div>
                  ) : (
                    <AnimatePresence>
                      {sortedSummary.map((staff, i) => {
                        const share = overallTotal > 0 ? Math.min(100, ((staff.total_owed || 0) / overallTotal) * 100) : 0;
                        return (
                          <motion.div
                            key={staff._id}
                            layout
                            variants={rise}
                            initial="hidden"
                            animate="show"
                            exit={{ opacity: 0, scale: 0.9 }}
                            custom={i}
                            whileHover={{ y: -4 }}
                            className={`${cardBase} p-5 sm:p-6 flex flex-col justify-between hover:border-gold-500/30 hover:shadow-[0_14px_40px_-14px_rgba(212,175,55,0.3)] transition-[border-color,box-shadow] duration-300`}
                          >
                            <div>
                              <div className="flex items-center gap-3 mb-5">
                                <Avatar name={staff._id} size="w-11 h-11 text-base" />
                                <div className="min-w-0">
                                  <h3 className="font-bold text-lg text-white truncate">{staff._id}</h3>
                                  <p className="text-xs text-gray-500">{Math.round(share)}% of total dues</p>
                                </div>
                              </div>

                              <div className="flex items-end justify-between mb-3">
                                <div>
                                  <p className="text-xs text-gray-500">Amount due</p>
                                  <p className="text-2xl font-black text-red-400 tabular-nums"><AnimatedNumber value={staff.total_owed || 0} currency /></p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs text-gray-500">Items</p>
                                  <p className="text-lg font-black text-white tabular-nums">{staff.total_items}</p>
                                </div>
                              </div>

                              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-6">
                                <motion.div
                                  className="h-full rounded-full bg-gradient-to-r from-red-500 to-orange-400"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.max(3, share)}%` }}
                                  transition={{ duration: 0.9, delay: 0.2 + i * 0.06, ease: 'easeOut' }}
                                />
                              </div>
                            </div>

                            <button
                              onClick={() => handleSettle(staff._id)}
                              className="w-full py-3 bg-white/5 hover:bg-green-500/15 hover:text-green-400 hover:border-green-500/30 active:scale-[0.98] border border-white/10 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-sm"
                            >
                              <CheckCircle className="w-4 h-4" /> Mark as settled
                            </button>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Confirm dialog (replaces window.confirm) */}
        <AnimatePresence>
          {confirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !confirmBusy && setConfirm(null)}
              className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
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
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 border ${confirm.tone === 'danger' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>
                  {confirm.tone === 'danger' ? <Trash2 className="w-6 h-6" /> : <CheckCircle className="w-6 h-6" />}
                </div>
                <h3 className="text-lg font-black text-white">{confirm.title}</h3>
                <p className="text-sm text-gray-400 mt-1.5">{confirm.message}</p>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setConfirm(null)} disabled={confirmBusy} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 font-bold text-sm transition-colors disabled:opacity-50">
                    Cancel
                  </button>
                  <button
                    onClick={runConfirm}
                    disabled={confirmBusy}
                    className={`flex-1 py-3 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-60 ${
                      confirm.tone === 'danger' ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-gradient-to-r from-gold-400 to-amber-500 text-black'
                    }`}
                  >
                    {confirmBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : confirm.confirmLabel}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}