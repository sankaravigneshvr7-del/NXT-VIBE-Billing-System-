import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  motion,
  AnimatePresence,
  MotionConfig,
  useMotionValue,
  animate,
} from 'framer-motion';
import api from '../api/client';
import { useProducts, useInvalidators } from '../api/queries';
import {
  Package, Search, Plus, Edit, Trash2, AlertTriangle,
  X, Box, Layers, IndianRupee, Check, Loader2, CheckCircle,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(amount || 0);

const totalUnitsOf = (p) => p.boxes_in_stock * p.units_per_box + p.loose_units_in_stock;

function AnimatedNumber({ value, currency = false }) {
  const mv = useMotionValue(value);
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.8, ease: 'easeOut' });
    const unsub = mv.on('change', (v) => setDisplay(v));
    return () => {
      controls.stop();
      unsub();
    };
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{currency ? formatCurrency(display) : Math.round(display).toLocaleString('en-IN')}</>;
}

const rise = {
  hidden: { opacity: 0, y: 18 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 260, damping: 24, delay: i * 0.06 },
  }),
};

const cardBase =
  'bg-gradient-to-br from-white/[0.05] to-white/[0.01] border border-white/[0.07] rounded-3xl backdrop-blur-xl';
const inputBase =
  'w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-gold-500/60 focus:shadow-[0_0_0_4px_rgba(212,175,55,0.08)] transition-all';
const labelBase = 'text-xs font-semibold text-gray-400 tracking-wide';

function stockState(p) {
  const units = totalUnitsOf(p);
  if (units <= 0) return 'out';
  if (units <= p.low_stock_unit_threshold) return 'low';
  return 'ok';
}

function StockBadge({ state }) {
  const map = {
    out: ['Out of stock', 'bg-gray-500/15 text-gray-300 border-gray-500/30', 'bg-gray-400'],
    low: ['Low stock', 'bg-red-500/10 text-red-400 border-red-500/20', 'bg-red-400'],
    ok: ['In stock', 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', 'bg-emerald-400'],
  };
  const [label, cls, dot] = map[state];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border w-fit ${cls}`}>
      <span className="relative flex w-1.5 h-1.5">
        {state === 'low' && <span className={`absolute inset-0 rounded-full ${dot} animate-ping opacity-70`} />}
        <span className={`relative rounded-full w-1.5 h-1.5 ${dot}`} />
      </span>
      {label}
    </span>
  );
}

function StockBar({ product, delay = 0 }) {
  const units = totalUnitsOf(product);
  const state = stockState(product);
  const ratio = Math.min(1, units / Math.max(1, (product.low_stock_unit_threshold || 1) * 4));
  return (
    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(units > 0 ? 5 : 0, ratio * 100)}%` }}
        transition={{ duration: 0.9, delay, ease: 'easeOut' }}
        className={`h-full rounded-full ${state === 'ok' ? 'bg-gradient-to-r from-gold-500 to-amber-300' : 'bg-red-400'}`}
      />
    </div>
  );
}

function ProductIcon({ product }) {
  const state = stockState(product);
  return (
    <div
      className={`w-11 h-11 rounded-xl flex items-center justify-center border shrink-0 ${
        state === 'ok'
          ? 'bg-gradient-to-br from-gold-400/20 to-amber-600/5 border-gold-500/20 text-gold-400'
          : 'bg-red-500/10 border-red-500/20 text-red-400'
      }`}
    >
      {product.units_per_box > 1 ? <Box className="w-5 h-5" /> : <Package className="w-5 h-5" />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export default function Inventory() {
  const { data, isLoading, error: loadErr, refetch } = useProducts();
  const invalidators = useInvalidators();
  const products = data?.products ?? [];
  const metrics = data?.metrics ?? { total_value: 0, total_items: 0, low_stock_count: 0 };
  const loadError = loadErr ? (loadErr.response?.data?.error || 'Failed to load inventory.') : '';

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | low | out | ok
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [sortBy, setSortBy] = useState('name');

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Feedback
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const searchRef = useRef(null);

  const initialFormState = {
    id: null,
    sku: '',
    name: '',
    category: 'General',
    price_per_unit: '',
    low_stock_unit_threshold: 10,
    isBoxTracked: false,
    units_per_box: 1,
    boxes_in_stock: 0, // Add mode
    loose_units_in_stock: 0, // Add mode or single units
    add_boxes: 0, // Edit mode
    add_loose: 0, // Edit mode
  };
  const [formData, setFormData] = useState(initialFormState);

  const notify = (type, msg) => setToast({ type, msg, id: Date.now() });

  /* ---------------- Data ---------------- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Keyboard: "/" focuses search, Esc closes dialogs
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (e.key === 'Escape') {
        if (confirm && !confirmBusy) return setConfirm(null);
        if (isModalOpen && !isSubmitting) return setIsModalOpen(false);
      }
      if (e.key === '/' && !typing && !isModalOpen && !confirm) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, confirmBusy, isModalOpen, isSubmitting]);

  // Lock page scroll behind modal
  useEffect(() => {
    document.body.style.overflow = isModalOpen || confirm ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isModalOpen, confirm]);

  /* ---------------- Derived ---------------- */
  const categories = useMemo(
    () => ['All', ...Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort()],
    [products]
  );

  const counts = useMemo(() => {
    const c = { all: products.length, low: 0, out: 0, ok: 0 };
    products.forEach((p) => c[stockState(p)]++);
    return c;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = products.filter((p) => {
      if (statusFilter !== 'all' && stockState(p) !== statusFilter) return false;
      if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
      if (!q) return true;
      return p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q);
    });
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name),
      stock_asc: (a, b) => totalUnitsOf(a) - totalUnitsOf(b),
      stock_desc: (a, b) => totalUnitsOf(b) - totalUnitsOf(a),
      price_desc: (a, b) => b.price_per_unit - a.price_per_unit,
      value_desc: (a, b) => totalUnitsOf(b) * b.price_per_unit - totalUnitsOf(a) * a.price_per_unit,
    };
    return [...list].sort(sorters[sortBy]);
  }, [products, searchQuery, statusFilter, categoryFilter, sortBy]);

  // Live preview for the modal
  const preview = useMemo(() => {
    const upb = formData.isBoxTracked ? parseInt(formData.units_per_box, 10) || 1 : 1;
    let total;
    if (modalMode === 'add') {
      const boxes = formData.isBoxTracked ? parseInt(formData.boxes_in_stock, 10) || 0 : 0;
      total = boxes * upb + (parseInt(formData.loose_units_in_stock, 10) || 0);
    } else {
      const boxes = (parseInt(formData.boxes_in_stock, 10) || 0) + (formData.isBoxTracked ? parseInt(formData.add_boxes, 10) || 0 : 0);
      total = boxes * upb + (parseInt(formData.loose_units_in_stock, 10) || 0) + (parseInt(formData.add_loose, 10) || 0);
    }
    return { total, value: total * (parseFloat(formData.price_per_unit) || 0) };
  }, [formData, modalMode]);

  /* ---------------- Actions ---------------- */
  const openAdd = () => {
    setModalMode('add');
    setFormData(initialFormState);
    setError('');
    setIsModalOpen(true);
  };

  const openEdit = (product) => {
    setModalMode('edit');
    setFormData({
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      price_per_unit: product.price_per_unit,
      low_stock_unit_threshold: product.low_stock_unit_threshold,
      isBoxTracked: product.units_per_box > 1,
      units_per_box: product.units_per_box,
      boxes_in_stock: product.boxes_in_stock,
      loose_units_in_stock: product.loose_units_in_stock,
      add_boxes: 0,
      add_loose: 0,
    });
    setError('');
    setIsModalOpen(true);
  };

  const handleDelete = (id, name) =>
    setConfirm({
      title: `Delete ${name}?`,
      message: 'This removes the product from inventory. This cannot be undone.',
      confirmLabel: 'Delete product',
      onConfirm: async () => {
        try {
          await api.delete(`/inventory/products/${id}`);
          notify('success', `${name} deleted.`);
          await invalidators.afterProductChange();
        } catch (err) {
          notify('error', err.response?.data?.error || 'Failed to delete product.');
        }
      },
    });

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

  const handleFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const payload = {
        sku: formData.sku,
        name: formData.name,
        category: formData.category,
        price_per_unit: parseFloat(formData.price_per_unit || 0),
        low_stock_unit_threshold: parseInt(formData.low_stock_unit_threshold || 10, 10),
        units_per_box: formData.isBoxTracked ? parseInt(formData.units_per_box || 1, 10) : 1,
      };

      if (modalMode === 'add') {
        payload.boxes_in_stock = formData.isBoxTracked ? parseInt(formData.boxes_in_stock || 0, 10) : 0;
        payload.loose_units_in_stock = parseInt(formData.loose_units_in_stock || 0, 10);
        await api.post('/inventory/products', payload);
      } else {
        payload.add_boxes = formData.isBoxTracked ? parseInt(formData.add_boxes || 0, 10) : 0;
        payload.add_loose = parseInt(formData.add_loose || 0, 10);
        await api.put(`/inventory/products/${formData.id}`, payload);
      }

      setIsModalOpen(false);
      notify('success', modalMode === 'add' ? `${formData.name} added.` : `${formData.name} updated.`);
      await invalidators.afterProductChange();
    } catch (err) {
      setError(err.response?.data?.error || 'An error occurred while saving.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setCategoryFilter('All');
  };
  const filtersActive = searchQuery || statusFilter !== 'all' || categoryFilter !== 'All';

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */
  const kpis = [
    {
      key: 'value',
      label: 'Total value',
      node: <AnimatedNumber value={metrics.total_value} currency />,
      icon: IndianRupee,
      glow: 'bg-gold-500/10 group-hover:bg-gold-500/25',
      chip: 'bg-gold-500/10 text-gold-400',
    },
    {
      key: 'items',
      label: 'Total products',
      node: <AnimatedNumber value={metrics.total_items} />,
      icon: Package,
      glow: 'bg-blue-500/10 group-hover:bg-blue-500/25',
      chip: 'bg-blue-500/10 text-blue-400',
    },
  ];
  const hasLow = metrics.low_stock_count > 0;

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

        <div className="max-w-7xl mx-auto relative z-10 space-y-6 sm:space-y-8">
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-gold-400/25 to-amber-600/5 border border-gold-500/25 flex items-center justify-center shrink-0">
                <Layers className="w-6 h-6 text-gold-400" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-white">Stock Manager</h1>
                <p className="text-gray-500 mt-0.5 text-sm flex items-center gap-2">
                  <span className="relative flex w-2 h-2">
                    <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
                    <span className="relative w-2 h-2 rounded-full bg-emerald-400" />
                  </span>
                  Real-time inventory tracking
                </p>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex w-full md:w-auto items-center gap-3">
              <div className="relative group flex-1 md:w-72">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-gold-400 transition-colors" />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search SKU or name…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl py-2.5 pl-11 pr-10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gold-500/50 focus:bg-gold-500/5 focus:shadow-[0_0_0_4px_rgba(212,175,55,0.08)] transition-all"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {searchQuery ? (
                    <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
                  ) : (
                    <kbd className="hidden sm:block text-[10px] text-gray-500 border border-white/10 rounded px-1.5 py-0.5">/</kbd>
                  )}
                </div>
              </div>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={openAdd}
                className="relative overflow-hidden flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-gold-400 to-amber-500 hover:from-gold-300 hover:to-amber-400 text-black font-bold rounded-xl shadow-[0_0_20px_rgba(212,175,55,0.3)] transition-colors flex-shrink-0"
              >
                <motion.span
                  aria-hidden
                  className="absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                  initial={{ x: '-150%' }}
                  animate={{ x: '450%' }}
                  transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 3.5, ease: 'easeInOut' }}
                />
                <Plus className="w-5 h-5 relative" /> <span className="hidden sm:inline relative">Add product</span>
              </motion.button>
            </motion.div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            {kpis.map(({ key, label, node, icon: Icon, glow, chip }, i) => (
              <motion.div
                key={key}
                variants={rise}
                initial="hidden"
                animate="show"
                custom={i}
                whileHover={{ y: -4 }}
                className={`${cardBase} p-5 sm:p-6 relative overflow-hidden group`}
              >
                <div className={`absolute top-0 right-0 w-28 h-28 rounded-full blur-2xl transition-all ${glow}`} />
                <p className="text-gray-400 text-sm font-semibold mb-2 relative">{label}</p>
                <h3 className="text-2xl sm:text-3xl font-black text-white tabular-nums relative">{isLoading ? <span className="inline-block h-8 w-32 rounded-lg bg-white/10 animate-pulse" /> : node}</h3>
                <div className={`p-3 rounded-xl absolute bottom-5 right-5 ${chip}`}><Icon className="w-6 h-6" /></div>
              </motion.div>
            ))}

            {/* Low stock KPI doubles as a filter shortcut */}
            <motion.button
              type="button"
              variants={rise}
              initial="hidden"
              animate="show"
              custom={2}
              whileHover={{ y: -4 }}
              onClick={() => setStatusFilter(statusFilter === 'low' ? 'all' : 'low')}
              className={`text-left border rounded-3xl p-5 sm:p-6 backdrop-blur-xl relative overflow-hidden group transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 ${
                hasLow ? 'bg-red-500/5 border-red-500/20' : `${cardBase}`
              } ${statusFilter === 'low' ? 'ring-1 ring-red-400/50' : ''}`}
            >
              <div className={`absolute top-0 right-0 w-28 h-28 rounded-full blur-2xl transition-all ${hasLow ? 'bg-red-500/10 group-hover:bg-red-500/25' : 'bg-emerald-500/10 group-hover:bg-emerald-500/25'}`} />
              <p className="text-gray-400 text-sm font-semibold mb-2 relative">Low stock alerts</p>
              <h3 className={`text-2xl sm:text-3xl font-black tabular-nums relative ${hasLow ? 'text-red-400' : 'text-white'}`}>
                {isLoading ? <span className="inline-block h-8 w-12 rounded-lg bg-white/10 animate-pulse" /> : <AnimatedNumber value={metrics.low_stock_count} />}
              </h3>
              <p className="text-[11px] text-gray-500 mt-1 relative">{hasLow ? (statusFilter === 'low' ? 'Showing low stock only. Tap to clear.' : 'Tap to filter the list') : 'Everything is above its threshold'}</p>
              <motion.div
                animate={hasLow ? { rotate: [0, -10, 10, -6, 6, 0] } : {}}
                transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 4 }}
                className={`p-3 rounded-xl absolute bottom-5 right-5 ${hasLow ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}
              >
                {hasLow ? <AlertTriangle className="w-6 h-6" /> : <Check className="w-6 h-6" />}
              </motion.div>
            </motion.button>
          </div>

          {/* Filter bar */}
          <motion.div variants={rise} initial="hidden" animate="show" custom={3} className="space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              {/* Status segmented control */}
              <div className="relative flex bg-black/50 p-1 rounded-xl border border-white/10 overflow-x-auto [scrollbar-width:none]">
                {[
                  ['all', 'All'],
                  ['ok', 'In stock'],
                  ['low', 'Low'],
                  ['out', 'Out'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setStatusFilter(key)}
                    className={`relative flex-1 lg:flex-none px-4 py-1.5 rounded-lg text-sm font-bold transition-colors whitespace-nowrap flex items-center justify-center gap-2 ${statusFilter === key ? 'text-gold-400' : 'text-gray-500 hover:text-white'}`}
                  >
                    {statusFilter === key && (
                      <motion.span layoutId="statusPill" className="absolute inset-0 bg-white/10 rounded-lg" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
                    )}
                    <span className="relative">{label}</span>
                    <span className="relative text-[10px] text-gray-500 tabular-nums">{counts[key]}</span>
                  </button>
                ))}
              </div>

              <div className="flex-1 min-w-0 flex gap-2 overflow-x-auto [scrollbar-width:none] pb-1 lg:pb-0">
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategoryFilter(c)}
                    className={`relative px-3.5 py-1.5 rounded-full text-xs font-bold border whitespace-nowrap shrink-0 transition-colors ${
                      categoryFilter === c ? 'text-gold-400 border-gold-500/40' : 'text-gray-400 border-white/10 hover:bg-white/5'
                    }`}
                  >
                    {categoryFilter === c && (
                      <motion.span layoutId="catPill" className="absolute inset-0 rounded-full bg-gold-500/15" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
                    )}
                    <span className="relative">{c}</span>
                  </button>
                ))}
              </div>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort products"
                className="bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-gold-500/50 [color-scheme:dark]"
              >
                <option value="name">Sort: Name</option>
                <option value="stock_asc">Stock: low to high</option>
                <option value="stock_desc">Stock: high to low</option>
                <option value="price_desc">Price: high to low</option>
                <option value="value_desc">Stock value</option>
              </select>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-500 px-1">
              <span>
                Showing <span className="text-gray-300 font-bold tabular-nums">{filteredProducts.length}</span> of {products.length} products
              </span>
              <AnimatePresence>
                {filtersActive && (
                  <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={clearFilters} className="text-gold-400 hover:text-gold-300 font-semibold">
                    Clear filters
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Load error */}
          {loadError && !isLoading && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm flex items-center justify-between gap-3">
              <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {loadError}</span>
              <button onClick={() => refetch()} className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-colors">Retry</button>
            </div>
          )}

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {isLoading && [0, 1, 2, 3].map((i) => <div key={i} className="h-36 rounded-3xl bg-white/[0.04] animate-pulse" />)}
            <AnimatePresence initial={false}>
              {!isLoading && filteredProducts.map((product, i) => {
                const units = totalUnitsOf(product);
                return (
                  <motion.div
                    key={product.id}
                    layout
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -40 }}
                    transition={{ delay: Math.min(i, 8) * 0.03 }}
                    className={`${cardBase} p-4`}
                  >
                    <div className="flex items-start gap-3">
                      <ProductIcon product={product} />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-white truncate">{product.name}</p>
                        <p className="text-xs text-gray-500 font-mono">{product.sku} · {product.category}</p>
                      </div>
                      <StockBadge state={stockState(product)} />
                    </div>
                    <div className="mt-4 flex items-end justify-between">
                      <div>
                        <p className="text-lg font-black tabular-nums">{units} <span className="text-xs font-semibold text-gray-500">units</span></p>
                        {product.units_per_box > 1 && <p className="text-[11px] text-gray-500">{product.boxes_in_stock} box, {product.loose_units_in_stock} loose</p>}
                      </div>
                      <p className="font-bold text-gold-400 tabular-nums">{formatCurrency(product.price_per_unit)}</p>
                    </div>
                    <div className="mt-3"><StockBar product={product} delay={0.1} /></div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button onClick={() => openEdit(product)} className="py-2.5 rounded-xl bg-white/5 active:bg-gold-400/15 text-gray-300 text-sm font-bold flex items-center justify-center gap-2 border border-white/10"><Edit className="w-4 h-4" /> Edit</button>
                      <button onClick={() => handleDelete(product.id, product.name)} className="py-2.5 rounded-xl bg-white/5 active:bg-red-400/15 text-red-400 text-sm font-bold flex items-center justify-center gap-2 border border-white/10"><Trash2 className="w-4 h-4" /> Delete</button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {!isLoading && filteredProducts.length === 0 && (
              <div className="text-center text-gray-500 py-12">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-25" />
                <p className="font-bold">{products.length === 0 ? 'No products yet' : 'No products match'}</p>
              </div>
            )}
          </div>

          {/* Desktop table */}
          <motion.div variants={rise} initial="hidden" animate="show" custom={4} className={`hidden md:block ${cardBase} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[860px]">
                <thead>
                  <tr className="bg-black/30 border-b border-white/[0.06]">
                    <th className="py-4 px-6 text-xs font-semibold text-gray-400 tracking-wide">SKU &amp; product</th>
                    <th className="py-4 px-6 text-xs font-semibold text-gray-400 tracking-wide">Category</th>
                    <th className="py-4 px-6 text-xs font-semibold text-gray-400 tracking-wide text-right">Price</th>
                    <th className="py-4 px-6 text-xs font-semibold text-gray-400 tracking-wide w-56">Stock</th>
                    <th className="py-4 px-6 text-xs font-semibold text-gray-400 tracking-wide">Status</th>
                    <th className="py-4 px-6 text-xs font-semibold text-gray-400 tracking-wide text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading &&
                    [0, 1, 2, 3, 4].map((i) => (
                      <tr key={i}><td colSpan={6} className="py-3 px-6"><div className="h-12 rounded-xl bg-white/[0.04] animate-pulse" /></td></tr>
                    ))}

                  {!isLoading && filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-gray-500">
                        <Package className="w-10 h-10 mx-auto mb-3 opacity-25" />
                        <p className="font-bold">{products.length === 0 ? 'No products yet' : 'No products match your filters'}</p>
                        <p className="text-xs text-gray-600 mt-1">
                          {products.length === 0 ? 'Add your first product to get started.' : 'Try a different search or clear the filters.'}
                        </p>
                      </td>
                    </tr>
                  )}

                  <AnimatePresence initial={false}>
                    {!isLoading &&
                      filteredProducts.map((product, i) => {
                        const units = totalUnitsOf(product);
                        const state = stockState(product);
                        return (
                          <motion.tr
                            key={product.id}
                            layout="position"
                            initial={{ opacity: 0, x: -16 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 30 }}
                            transition={{ delay: Math.min(i, 12) * 0.025, type: 'spring', stiffness: 300, damping: 30 }}
                            className="group border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors"
                          >
                            <td className="py-3.5 px-6">
                              <div className="flex items-center gap-3">
                                <ProductIcon product={product} />
                                <div className="min-w-0">
                                  <p className="font-bold text-white truncate">{product.name}</p>
                                  <p className="text-xs text-gray-500 font-mono mt-0.5">{product.sku}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-6">
                              <span className="text-xs font-semibold text-gray-300 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full">{product.category}</span>
                            </td>
                            <td className="py-3.5 px-6 text-right font-semibold text-white tabular-nums">{formatCurrency(product.price_per_unit)}</td>
                            <td className="py-3.5 px-6">
                              <div className="flex items-baseline justify-between mb-1.5">
                                <span className={`font-black tabular-nums ${state === 'ok' ? 'text-white' : 'text-red-400'}`}>
                                  {units} <span className="text-xs font-semibold text-gray-500">units</span>
                                </span>
                                {product.units_per_box > 1 && (
                                  <span className="text-[11px] text-gray-500">{product.boxes_in_stock} box, {product.loose_units_in_stock} loose</span>
                                )}
                              </div>
                              <StockBar product={product} delay={0.15 + Math.min(i, 12) * 0.025} />
                            </td>
                            <td className="py-3.5 px-6"><StockBadge state={state} /></td>
                            <td className="py-3.5 px-6">
                              <div className="flex justify-center items-center gap-1.5 opacity-70 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => openEdit(product)} aria-label={`Edit ${product.name}`} className="p-2 text-gray-400 hover:text-gold-400 hover:bg-gold-400/10 rounded-lg transition-colors">
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleDelete(product.id, product.name)} aria-label={`Delete ${product.name}`} className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>

        {/* Add / Edit modal */}
        <AnimatePresence>
          {isModalOpen && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onClick={() => !isSubmitting && setIsModalOpen(false)}
              />
              <motion.div
                role="dialog"
                aria-modal="true"
                initial={{ opacity: 0, y: 60, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 60, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                className="bg-[#0a0a0a] border border-white/10 w-full max-w-2xl rounded-t-[2rem] sm:rounded-3xl shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[94dvh]"
              >
                <div className="flex justify-between items-center p-5 sm:p-6 border-b border-white/5 bg-white/[0.02] flex-none">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gold-500/15 border border-gold-500/25 flex items-center justify-center text-gold-400">
                      {modalMode === 'add' ? <Plus className="w-5 h-5" /> : <Edit className="w-5 h-5" />}
                    </div>
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold text-white">{modalMode === 'add' ? 'Register new product' : 'Edit product'}</h2>
                      <p className="text-xs text-gray-500">{modalMode === 'add' ? 'Add a product and its opening stock.' : 'Update details or add incoming stock.'}</p>
                    </div>
                  </div>
                  <button onClick={() => setIsModalOpen(false)} aria-label="Close" className="text-gray-500 hover:text-white transition-colors p-1">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
                  <div className="p-5 sm:p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
                    <AnimatePresence>
                      {error && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <motion.div animate={{ x: [0, -8, 8, -5, 5, 0] }} transition={{ duration: 0.4 }} className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
                          </motion.div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Basics */}
                    <section className="space-y-4">
                      <h3 className="text-sm font-bold text-white">Product details</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label htmlFor="sku" className={labelBase}>SKU code</label>
                          <input id="sku" required type="text" name="sku" value={formData.sku} onChange={handleFormChange} className={`${inputBase} font-mono text-sm`} placeholder="e.g. PRD-001" />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="pname" className={labelBase}>Product name</label>
                          <input id="pname" required type="text" name="name" value={formData.name} onChange={handleFormChange} className={inputBase} placeholder="Product title" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <label htmlFor="cat" className={labelBase}>Category</label>
                          <input id="cat" required type="text" name="category" list="category-list" value={formData.category} onChange={handleFormChange} className={inputBase} placeholder="General" />
                          <datalist id="category-list">
                            {categories.filter((c) => c !== 'All').map((c) => <option key={c} value={c} />)}
                          </datalist>
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="price" className={labelBase}>Price per unit (₹)</label>
                          <input id="price" required type="number" inputMode="decimal" step="0.01" min="0" name="price_per_unit" value={formData.price_per_unit} onChange={handleFormChange} className={inputBase} placeholder="0.00" />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="low" className={labelBase}>Low stock alert at</label>
                          <input id="low" required type="number" inputMode="numeric" min="0" name="low_stock_unit_threshold" value={formData.low_stock_unit_threshold} onChange={handleFormChange} className={inputBase} placeholder="10" />
                        </div>
                      </div>
                    </section>

                    {/* Stock */}
                    <section className="pt-5 border-t border-white/5 space-y-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="text-sm font-bold text-white">Box tracking</h3>
                          <p className="text-xs text-gray-500 mt-0.5">Track stock as boxes plus loose units.</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={formData.isBoxTracked}
                          aria-label="Enable box tracking"
                          onClick={() => setFormData((p) => ({ ...p, isBoxTracked: !p.isBoxTracked }))}
                          className={`relative w-12 h-7 rounded-full border transition-colors shrink-0 ${formData.isBoxTracked ? 'bg-gold-500 border-gold-400' : 'bg-white/10 border-white/10'}`}
                        >
                          <motion.span
                            layout
                            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                            className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow ${formData.isBoxTracked ? 'right-0.5' : 'left-0.5'}`}
                          />
                        </button>
                      </div>

                      <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                        <AnimatePresence mode="wait" initial={false}>
                          {formData.isBoxTracked ? (
                            <motion.div key="box" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div className="space-y-1.5">
                                <label htmlFor="upb" className="text-xs font-semibold text-gold-400 tracking-wide">Units per box</label>
                                <input id="upb" required type="number" inputMode="numeric" min="1" name="units_per_box" value={formData.units_per_box} onChange={handleFormChange} className={`${inputBase} !border-gold-500/30`} placeholder="e.g. 12" />
                              </div>
                              {modalMode === 'add' ? (
                                <>
                                  <div className="space-y-1.5">
                                    <label htmlFor="ib" className={labelBase}>Initial boxes</label>
                                    <input id="ib" required type="number" inputMode="numeric" min="0" name="boxes_in_stock" value={formData.boxes_in_stock} onChange={handleFormChange} className={inputBase} />
                                  </div>
                                  <div className="space-y-1.5">
                                    <label htmlFor="il" className={labelBase}>Initial loose units</label>
                                    <input id="il" required type="number" inputMode="numeric" min="0" name="loose_units_in_stock" value={formData.loose_units_in_stock} onChange={handleFormChange} className={inputBase} />
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="space-y-1.5">
                                    <label htmlFor="ab" className="text-xs font-semibold text-blue-400 tracking-wide">Add boxes</label>
                                    <input id="ab" required type="number" inputMode="numeric" name="add_boxes" value={formData.add_boxes} onChange={handleFormChange} className={`${inputBase} !border-blue-500/30 focus:!border-blue-500`} />
                                    <p className="text-[11px] text-gray-500">Current: {formData.boxes_in_stock}</p>
                                  </div>
                                  <div className="space-y-1.5">
                                    <label htmlFor="al" className="text-xs font-semibold text-blue-400 tracking-wide">Add loose units</label>
                                    <input id="al" required type="number" inputMode="numeric" name="add_loose" value={formData.add_loose} onChange={handleFormChange} className={`${inputBase} !border-blue-500/30 focus:!border-blue-500`} />
                                    <p className="text-[11px] text-gray-500">Current: {formData.loose_units_in_stock}</p>
                                  </div>
                                </>
                              )}
                            </motion.div>
                          ) : (
                            <motion.div key="single" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="w-full sm:w-1/2 space-y-1.5">
                              <label htmlFor="single" className={labelBase}>
                                {modalMode === 'add' ? 'Total initial stock (units)' : 'Add stock (units)'}
                              </label>
                              <input
                                id="single"
                                required
                                type="number"
                                inputMode="numeric"
                                name={modalMode === 'add' ? 'loose_units_in_stock' : 'add_loose'}
                                value={modalMode === 'add' ? formData.loose_units_in_stock : formData.add_loose}
                                onChange={handleFormChange}
                                className={inputBase}
                              />
                              {modalMode === 'edit' && <p className="text-[11px] text-gray-500">Current stock: {formData.loose_units_in_stock}</p>}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Live preview */}
                      <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-gradient-to-r from-gold-500/10 to-transparent border border-gold-500/15">
                        <div>
                          <p className="text-xs text-gray-400">{modalMode === 'add' ? 'Opening stock' : 'Stock after saving'}</p>
                          <p className="text-xl font-black text-white tabular-nums"><AnimatedNumber value={preview.total} /> <span className="text-xs font-semibold text-gray-500">units</span></p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-400">Stock value</p>
                          <p className="text-xl font-black text-gold-400 tabular-nums"><AnimatedNumber value={preview.value} currency /></p>
                        </div>
                      </div>
                    </section>
                  </div>

                  <div className="p-4 sm:p-5 border-t border-white/5 bg-white/[0.02] flex justify-end gap-3 flex-none pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 rounded-xl font-semibold text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors">
                      Cancel
                    </button>
                    <button type="submit" disabled={isSubmitting} className="px-6 py-2.5 bg-gradient-to-r from-gold-400 to-amber-500 hover:from-gold-300 hover:to-amber-400 text-black font-bold rounded-xl shadow-[0_0_20px_rgba(212,175,55,0.3)] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2">
                      {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : modalMode === 'add' ? 'Add product' : 'Save changes'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Confirm dialog */}
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
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 border bg-red-500/10 border-red-500/20 text-red-400">
                  <Trash2 className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-white">{confirm.title}</h3>
                <p className="text-sm text-gray-400 mt-1.5">{confirm.message}</p>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setConfirm(null)} disabled={confirmBusy} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 font-bold text-sm transition-colors disabled:opacity-50">
                    Cancel
                  </button>
                  <button onClick={runConfirm} disabled={confirmBusy} className="flex-1 py-3 rounded-xl font-bold text-sm bg-red-500 hover:bg-red-600 text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
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