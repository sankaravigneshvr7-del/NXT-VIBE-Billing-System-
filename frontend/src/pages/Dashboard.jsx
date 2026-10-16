import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useDashboardStats } from '../api/queries';
import {
  Package, CreditCard, AlertTriangle, IndianRupee, Activity, TrendingUp,
  Calendar, Box, ShieldAlert, CheckCircle2, RefreshCw, Bug, X, Receipt,
  Smartphone, Banknote, Wallet,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, BarChart, Bar, Cell, PieChart, Pie,
} from 'recharts';
import {
  format, subDays, startOfDay, endOfDay, startOfYesterday, endOfYesterday,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, isSameDay,
} from 'date-fns';

/* ==========================================================================
   CONFIG
   ========================================================================== */

const GOLD = '#D4AF37';
const GOLD_SOFT = 'rgba(212,175,55,0.28)';

// One source of truth for payment colours, used by the donut, badges and bars.
const METHOD_META = {
  cash:  { label: 'Cash',  color: '#D4AF37', icon: Banknote },
  upi:   { label: 'UPI',   color: '#34D399', icon: Smartphone },
  card:  { label: 'Card',  color: '#A78BFA', icon: CreditCard },
  other: { label: 'Other', color: '#94A3B8', icon: Wallet },
};
const METHOD_ORDER = ['cash', 'upi', 'card', 'other'];

const FINAL_STATUSES = ['completed', 'complete', 'finalized', 'finalised', 'paid', 'success'];

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7days', label: 'Last 7 days' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];

const PANEL = 'rounded-2xl border border-white/[0.07] bg-white/[0.025] backdrop-blur-xl';

/* ==========================================================================
   DATA SAFETY HELPERS
   Everything coming from the API goes through these before it is displayed.
   ========================================================================== */

// Turns numbers, "1,200", "₹1,200" and Mongo Decimal128 objects into a number.
const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/[₹,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object') {
    if ('$numberDecimal' in value) return toNumber(value.$numberDecimal);
    if ('$numberInt' in value) return toNumber(value.$numberInt);
    if ('$numberLong' in value) return toNumber(value.$numberLong);
    if ('$numberDouble' in value) return toNumber(value.$numberDouble);
  }
  return 0;
};

const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(toNumber(amount));

const formatCompactCurrency = (amount) => {
  const n = toNumber(amount);
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
};

const formatNumber = (n) => toNumber(n).toLocaleString('en-IN');

// "2026-10-10" must be read as a LOCAL date, not UTC, or IST users see shifts.
const parseDateSafe = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const safeFormatDate = (value, formatStr = 'dd MMM yyyy, HH:mm') => {
  const d = parseDateSafe(value);
  if (!d) return 'N/A';
  try {
    return format(d, formatStr);
  } catch (e) {
    return 'N/A';
  }
};

const percent = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

// Maps any backend spelling (UPI, upi, GPay, Credit Card...) to a known method.
const normalizeMethod = (raw) => {
  const key = String(raw ?? '').toLowerCase().trim();
  if (!key) return 'other';
  if (key.includes('upi') || key.includes('gpay') || key.includes('phonepe') || key.includes('paytm')) return 'upi';
  if (key.includes('cash')) return 'cash';
  if (key.includes('card') || key.includes('credit') || key.includes('debit')) return 'card';
  return 'other';
};

// Accepts { cash, upi } objects, { cash: { total } } objects, and arrays like
// [{ _id: 'upi', total: 500 }]. Returns totals for every known method.
const normalizePayments = (raw) => {
  const totals = { cash: 0, upi: 0, card: 0, other: 0 };
  const unknownKeys = [];
  if (!raw) return { totals, unknownKeys };

  const pickAmount = (item) => {
    if (item && typeof item === 'object' && !('$numberDecimal' in item)) {
      return toNumber(item.total ?? item.amount ?? item.value ?? item.total_amount ?? item.revenue ?? 0);
    }
    return toNumber(item);
  };

  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      const rawKey = item?._id ?? item?.method ?? item?.payment_method ?? item?.name;
      const method = normalizeMethod(rawKey);
      if (method === 'other' && rawKey) unknownKeys.push(String(rawKey));
      totals[method] += pickAmount(item);
    });
  } else if (typeof raw === 'object') {
    Object.entries(raw).forEach(([rawKey, value]) => {
      // 'split' is only an informational total; its cash/UPI parts are already
      // inside the cash and upi numbers, so counting it again would double count.
      if (['total', 'split'].includes(rawKey.toLowerCase())) return;
      const method = normalizeMethod(rawKey);
      if (method === 'other') unknownKeys.push(rawKey);
      totals[method] += pickAmount(value);
    });
  }
  return { totals, unknownKeys };
};

// Builds a predictable stats object so the UI can never crash on missing keys.
const normalizeStats = (raw) => {
  const kpis = raw?.kpis ?? {};
  const inventory = kpis.inventory ?? {};
  const { totals, unknownKeys } = normalizePayments(kpis.payments);

  return {
    kpis: {
      revenue: toNumber(kpis.revenue),
      orders: toNumber(kpis.orders),
      products_sold: toNumber(kpis.products_sold),
      payments: totals,
      unknownPaymentKeys: unknownKeys,
      inventory: {
        total_value: toNumber(inventory.total_value),
        total_items: toNumber(inventory.total_items),
        low_stock: toNumber(inventory.low_stock),
        low_stock_details: Array.isArray(inventory.low_stock_details)
          ? inventory.low_stock_details.map((item) => ({
              name: item?.name ?? 'Unnamed item',
              stock: toNumber(item?.stock),
              threshold: toNumber(item?.threshold),
            }))
          : [],
      },
    },
    charts: {
      trend: Array.isArray(raw?.charts?.trend)
        ? raw.charts.trend.map((row) => ({
            _id: row?._id,
            daily_revenue: toNumber(row?.daily_revenue),
          }))
        : [],
      top_products: Array.isArray(raw?.charts?.top_products)
        ? raw.charts.top_products.map((row) => ({
            _id: String(row?._id ?? 'Unknown'),
            quantity_sold: toNumber(row?.quantity_sold),
          }))
        : [],
    },
    tables: {
      recent_orders: Array.isArray(raw?.tables?.recent_orders)
        ? raw.tables.recent_orders.map((order, i) => ({
            id: order?.id ?? order?._id ?? `row-${i}`,
            order_number: order?.order_number ?? '—',
            payment_method: normalizeMethod(order?.payment_method),
            raw_method: order?.payment_method,
            total_amount: toNumber(order?.total_amount),
            created_at: order?.created_at,
            status: order?.status ? String(order.status) : '',
          }))
        : [],
    },
  };
};

/* ==========================================================================
   MOTION
   ========================================================================== */

const makeVariants = (reduce) => ({
  container: {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: reduce ? 0 : 0.07 } },
  },
  item: {
    hidden: { opacity: 0, y: reduce ? 0 : 14 },
    show: {
      opacity: 1,
      y: 0,
      transition: reduce ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 26 },
    },
  },
});

/* ==========================================================================
   SMALL UI PIECES
   ========================================================================== */

const PanelHeader = ({ title, hint, right }) => (
  <div className="mb-6 flex items-start justify-between gap-4">
    <div>
      <h3 className="font-display text-2xl font-bold text-white">{title}</h3>
      {hint && <p className="mt-1 text-sm text-white/45">{hint}</p>}
    </div>
    {right}
  </div>
);

const EmptyState = ({ icon: Icon, title, hint }) => (
  <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
    <div className="mb-4 rounded-full border border-white/10 bg-white/[0.03] p-4">
      <Icon className="h-7 w-7 text-white/30" />
    </div>
    <p className="font-display text-lg font-bold text-white/70">{title}</p>
    {hint && <p className="mt-1 max-w-[260px] text-sm text-white/40">{hint}</p>}
  </div>
);

const MethodBadge = ({ method }) => {
  const meta = METHOD_META[method] ?? METHOD_META.other;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold"
      style={{
        color: meta.color,
        borderColor: `${meta.color}40`,
        backgroundColor: `${meta.color}14`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
};

const InlineStat = ({ icon: Icon, label, value, note }) => (
  <div className="flex-1 px-0 py-4 sm:px-6 sm:py-0 first:sm:pl-0 last:sm:pr-0">
    <div className="mb-2 flex items-center gap-2 text-sm text-white/50">
      <Icon className="h-4 w-4" style={{ color: GOLD }} />
      {label}
    </div>
    <p className="font-display text-3xl font-bold text-white">{value}</p>
    {note && <p className="mt-1 text-xs text-white/40">{note}</p>}
  </div>
);

const SkeletonBlock = ({ className = '' }) => (
  <div className={`animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.04] ${className}`} />
);

// Tooltip that formats the label correctly for dates AND for plain text labels.
const ChartTooltip = ({ active, payload, label, isCurrency, labelType }) => {
  if (!active || !payload || payload.length === 0) return null;
  const heading = labelType === 'date' ? safeFormatDate(label, 'EEE, dd MMM yyyy') : label;
  return (
    <div className="min-w-[160px] rounded-xl border border-white/10 bg-[#0d0c0a]/95 p-4 shadow-2xl backdrop-blur-xl">
      {heading && (
        <p className="mb-2 border-b border-white/10 pb-2 text-xs font-medium text-white/50">{heading}</p>
      )}
      {payload.map((entry, index) => (
        <div key={index} className="my-1 flex items-center justify-between gap-6">
          <span className="text-sm text-white/70">{entry.name}</span>
          <span
            className="font-display text-lg font-bold"
            style={{ color: entry.color || entry.payload?.fill || GOLD }}
          >
            {isCurrency ? formatCurrency(entry.value) : formatNumber(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

/* ==========================================================================
   DATA CHECK PANEL
   Shows exactly what the backend sent so you can see where numbers go wrong.
   ========================================================================== */

const DataCheckPanel = ({ raw, stats, onClose }) => {
  const payments = stats.kpis.payments;
  const paymentTotal = METHOD_ORDER.reduce((sum, key) => sum + payments[key], 0);
  const difference = stats.kpis.revenue - paymentTotal;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      className="fixed inset-x-4 bottom-4 z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0c0a]/95 p-6 shadow-2xl backdrop-blur-xl sm:left-auto sm:right-6 sm:w-[460px]"
    >
      <div className="mb-4 flex items-center justify-between">
        <h4 className="font-display text-xl font-bold text-white">Data check</h4>
        <button
          onClick={onClose}
          aria-label="Close data check"
          className="rounded-lg p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-white/70">
          <span>Revenue (from API)</span>
          <span className="font-semibold text-white">{formatCurrency(stats.kpis.revenue)}</span>
        </div>
        {METHOD_ORDER.map((key) => (
          <div key={key} className="flex justify-between text-white/70">
            <span>{METHOD_META[key].label} (from API)</span>
            <span className="font-semibold" style={{ color: METHOD_META[key].color }}>
              {formatCurrency(payments[key])}
            </span>
          </div>
        ))}
        <div className="flex justify-between border-t border-white/10 pt-2 text-white/70">
          <span>Payments added up</span>
          <span className="font-semibold text-white">{formatCurrency(paymentTotal)}</span>
        </div>
        <div className="flex justify-between text-white/70">
          <span>Difference from revenue</span>
          <span className={`font-semibold ${Math.abs(difference) > 1 ? 'text-red-400' : 'text-emerald-400'}`}>
            {formatCurrency(difference)}
          </span>
        </div>
      </div>

      {stats.kpis.unknownPaymentKeys.length > 0 && (
        <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-300">
          The backend sent payment methods this dashboard does not recognise:{' '}
          {stats.kpis.unknownPaymentKeys.join(', ')}. They are shown under Other.
        </p>
      )}

      <p className="mb-2 mt-5 text-sm font-medium text-white/60">Raw kpis.payments from the API</p>
      <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/60 p-4 text-xs leading-relaxed text-emerald-300">
        {JSON.stringify(raw?.kpis?.payments ?? null, null, 2)}
      </pre>
    </motion.div>
  );
};

/* ==========================================================================
   MAIN DASHBOARD
   ========================================================================== */

export default function Dashboard() {
  const reduceMotion = useReducedMotion();
  const variants = useMemo(() => makeVariants(reduceMotion), [reduceMotion]);

  const [showDataCheck, setShowDataCheck] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState('all');

  const [datePreset, setDatePreset] = useState('today');
  const [dateRange, setDateRange] = useState({
    start: startOfDay(new Date()),
    end: endOfDay(new Date()),
  });

  const { data: rawStats, isLoading, isFetching, error: queryError, refetch } = useDashboardStats(dateRange);
  const error = queryError
    ? (queryError.response?.data?.error || 'Could not load analytics. Check that the server is running and try again.')
    : '';

  /* ---------- date controls ---------- */

  const handlePresetChange = (preset) => {
    setDatePreset(preset);
    const now = new Date();
    const presets = {
      today: { start: startOfDay(now), end: endOfDay(now) },
      yesterday: { start: startOfYesterday(), end: endOfYesterday() },
      week: { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) },
      month: { start: startOfMonth(now), end: endOfMonth(now) },
      '7days': { start: startOfDay(subDays(now, 6)), end: endOfDay(now) },
    };
    if (presets[preset]) setDateRange(presets[preset]);
  };

  const handleCustomDate = (which, value) => {
    const parsed = parseDateSafe(value);
    if (!parsed) return;
    setDatePreset('custom');
    setDateRange((prev) => {
      const next =
        which === 'start'
          ? { start: startOfDay(parsed), end: prev.end }
          : { start: prev.start, end: endOfDay(parsed) };
      return next.start > next.end ? prev : next;
    });
  };

  /* ---------- data loading: handled by useDashboardStats above ---------- */

  /* ---------- derived values ---------- */

  const stats = useMemo(() => (rawStats ? normalizeStats(rawStats) : null), [rawStats]);

  const derived = useMemo(() => {
    if (!stats) return null;
    const payments = stats.kpis.payments;
    const paymentTotal = METHOD_ORDER.reduce((sum, key) => sum + payments[key], 0);
    const revenue = stats.kpis.revenue;
    const difference = revenue - paymentTotal;

    const pieData = METHOD_ORDER
      .map((key) => ({ key, name: METHOD_META[key].label, value: payments[key], fill: METHOD_META[key].color }))
      .filter((row) => row.value > 0);

    const peakDay = stats.charts.trend.reduce(
      (best, row) => (row.daily_revenue > (best?.daily_revenue ?? -1) ? row : best),
      null
    );

    return {
      paymentTotal,
      difference,
      mismatch: revenue > 0 && Math.abs(difference) > 1,
      pieData,
      peakDay,
      averageOrder: stats.kpis.orders > 0 ? revenue / stats.kpis.orders : 0,
      upiShare: percent(payments.upi, paymentTotal || revenue),
    };
  }, [stats]);

  const filteredOrders = useMemo(() => {
    if (!stats) return [];
    const all = stats.tables.recent_orders;
    return ledgerFilter === 'all' ? all : all.filter((o) => o.payment_method === ledgerFilter);
  }, [stats, ledgerFilter]);

  const filteredOrdersTotal = useMemo(
    () => filteredOrders.reduce((sum, o) => sum + o.total_amount, 0),
    [filteredOrders]
  );

  const rangeLabel = isSameDay(dateRange.start, dateRange.end)
    ? format(dateRange.start, 'dd MMM yyyy')
    : `${format(dateRange.start, 'dd MMM')} – ${format(dateRange.end, 'dd MMM yyyy')}`;

  /* ---------- render ---------- */

  return (
    <>
      <style>{`
        .dash-root { font-family: 'DM Sans', system-ui, sans-serif; }
        .font-display { font-family: 'Playfair Display', Georgia, serif; font-variant-numeric: lining-nums; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(212,175,55,0.25); border-radius: 999px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(212,175,55,0.45); }
        .dash-root input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.8); cursor: pointer; }
        .dash-root button:focus-visible, .dash-root input:focus-visible {
          outline: 2px solid #D4AF37; outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .dash-root * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      <div className="dash-root relative min-h-screen w-full overflow-y-auto bg-[#070706] p-4 text-white sm:p-6 lg:p-10">
        {/* Soft background glow */}
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="absolute -left-[10%] -top-[20%] h-[55vw] w-[55vw] rounded-full bg-[#D4AF37]/[0.05] blur-[150px]" />
          <div className="absolute -bottom-[20%] -right-[10%] h-[45vw] w-[45vw] rounded-full bg-amber-700/[0.05] blur-[130px]" />
        </div>

        <div className="relative z-10 mx-auto max-w-[1600px] space-y-6">
          {/* ------------------------------------------------------------
              HEADER
             ------------------------------------------------------------ */}
          <header className={`${PANEL} flex flex-col gap-6 p-6 lg:p-8 xl:flex-row xl:items-center xl:justify-between`}>
            <div>
              <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">Command Center</h1>
              <p className="mt-2 text-sm text-white/50">
                Sales, payments and stock for <span className="text-white/80">{rangeLabel}</span>
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 xl:w-auto">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Date presets">
                {PRESETS.map((preset) => {
                  const active = datePreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => handlePresetChange(preset.id)}
                      aria-pressed={active}
                      className={`rounded-full px-5 py-2 text-sm font-medium transition-colors duration-200 ${
                        active
                          ? 'bg-[#D4AF37] text-black'
                          : 'border border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex w-fit flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/40 p-2">
                <Calendar className="ml-2 h-4 w-4" style={{ color: GOLD }} />
                <input
                  type="date"
                  aria-label="Start date"
                  value={format(dateRange.start, 'yyyy-MM-dd')}
                  onChange={(e) => handleCustomDate('start', e.target.value)}
                  className="cursor-pointer border-none bg-transparent text-sm font-medium text-white outline-none"
                />
                <span className="text-white/30">to</span>
                <input
                  type="date"
                  aria-label="End date"
                  value={format(dateRange.end, 'yyyy-MM-dd')}
                  onChange={(e) => handleCustomDate('end', e.target.value)}
                  className="cursor-pointer border-none bg-transparent text-sm font-medium text-white outline-none"
                />
                <button
                  onClick={() => refetch()}
                  aria-label="Refresh data"
                  className="ml-1 rounded-lg bg-white/10 p-2.5 text-white transition-colors hover:bg-white/20"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading || isFetching ? 'animate-spin' : ''}`} style={isLoading || isFetching ? { color: GOLD } : undefined} />
                </button>
              </div>
            </div>
          </header>

          {/* ------------------------------------------------------------
              ERROR
             ------------------------------------------------------------ */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                role="alert"
                className="flex items-center justify-between gap-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-red-300"
              >
                <div className="flex items-center gap-4">
                  <AlertTriangle className="h-6 w-6 flex-shrink-0" />
                  <p className="font-medium">{error}</p>
                </div>
                <button
                  onClick={() => refetch()}
                  className="rounded-lg border border-red-400/30 px-4 py-2 text-sm font-medium transition hover:bg-red-500/20"
                >
                  Try again
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ------------------------------------------------------------
              LOADING SKELETON
             ------------------------------------------------------------ */}
          {isLoading && !stats && (
            <div className="space-y-6">
              <SkeletonBlock className="h-56" />
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <SkeletonBlock className="h-[420px] xl:col-span-2" />
                <SkeletonBlock className="h-[420px]" />
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------
              CONTENT
             ------------------------------------------------------------ */}
          {stats && derived && (
            <motion.div
              variants={variants.container}
              initial="hidden"
              animate="show"
              className={`space-y-6 transition-opacity duration-300 ${isLoading || isFetching ? 'opacity-60' : 'opacity-100'}`}
            >
              {/* Mismatch warning */}
              {derived.mismatch && (
                <motion.div
                  variants={variants.item}
                  className="flex flex-col gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-300" />
                    <p className="text-sm leading-relaxed text-amber-100">
                      Payment totals add up to <strong>{formatCurrency(derived.paymentTotal)}</strong>, but revenue is{' '}
                      <strong>{formatCurrency(stats.kpis.revenue)}</strong>. The difference of{' '}
                      <strong>{formatCurrency(Math.abs(derived.difference))}</strong> is missing from the payment
                      breakdown, so this is a backend grouping issue and not a display issue.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDataCheck(true)}
                    className="whitespace-nowrap rounded-lg border border-amber-300/30 px-4 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-400/15"
                  >
                    Open data check
                  </button>
                </motion.div>
              )}

              {/* Hero revenue panel */}
              <motion.section
                variants={variants.item}
                className={`${PANEL} relative overflow-hidden p-6 sm:p-8 lg:p-10`}
              >
                <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#D4AF37]/10 blur-[90px]" />
                <div className="relative">
                  <div className="mb-3 flex items-center gap-2 text-sm text-white/55">
                    <IndianRupee className="h-4 w-4" style={{ color: GOLD }} />
                    Gross revenue
                  </div>
                  <p className="font-display text-5xl font-black tracking-tight text-white sm:text-6xl lg:text-7xl">
                    {formatCurrency(stats.kpis.revenue)}
                  </p>
                  <p className="mt-3 text-sm text-white/45">
                    From {formatNumber(stats.kpis.orders)} finalized {stats.kpis.orders === 1 ? 'order' : 'orders'}
                  </p>

                  <div className="mt-8 flex flex-col divide-y divide-white/10 border-t border-white/10 pt-4 sm:flex-row sm:divide-x sm:divide-y-0 sm:pt-6">
                    <InlineStat
                      icon={TrendingUp}
                      label="Average order"
                      value={derived.averageOrder > 0 ? formatCurrency(derived.averageOrder) : '₹0.00'}
                      note="Revenue per order"
                    />
                    <InlineStat
                      icon={Package}
                      label="Units sold"
                      value={formatNumber(stats.kpis.products_sold)}
                      note="Physical items moved"
                    />
                    <InlineStat
                      icon={Smartphone}
                      label="Paid by UPI"
                      value={formatCurrency(stats.kpis.payments.upi)}
                      note={
                        derived.paymentTotal > 0
                          ? `${derived.upiShare.toFixed(0)}% of payments received`
                          : 'No payments recorded'
                      }
                    />
                  </div>
                </div>
              </motion.section>

              {/* Trend + Tender split */}
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                {/* Revenue trend */}
                <motion.section variants={variants.item} className={`${PANEL} flex min-h-[460px] flex-col p-6 sm:p-8 xl:col-span-2`}>
                  <PanelHeader
                    title="Revenue trend"
                    hint={
                      derived.peakDay
                        ? `Best day: ${safeFormatDate(derived.peakDay._id, 'dd MMM')} at ${formatCurrency(derived.peakDay.daily_revenue)}`
                        : 'Daily revenue for the selected dates'
                    }
                  />
                  <div className="min-h-0 w-full flex-1">
                    {stats.charts.trend.length === 0 ? (
                      <EmptyState
                        icon={Activity}
                        title="No revenue in this period"
                        hint="Pick a wider date range to see how sales moved."
                      />
                    ) : (
                      <ResponsiveContainer width="100%" height={340}>
                        <AreaChart data={stats.charts.trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={GOLD} stopOpacity={0.45} />
                              <stop offset="95%" stopColor={GOLD} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                          <XAxis
                            dataKey="_id"
                            tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(val) => safeFormatDate(val, 'dd MMM')}
                          />
                          <YAxis
                            tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={formatCompactCurrency}
                          />
                          <RechartsTooltip
                            content={<ChartTooltip isCurrency labelType="date" />}
                            cursor={{ stroke: GOLD_SOFT, strokeWidth: 1.5, strokeDasharray: '4 4' }}
                          />
                          <Area
                            type="monotone"
                            dataKey="daily_revenue"
                            name="Revenue"
                            stroke={GOLD}
                            strokeWidth={3}
                            fill="url(#colorRevenue)"
                            activeDot={{ r: 6, fill: GOLD, stroke: '#070706', strokeWidth: 3 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </motion.section>

                {/* Tender split */}
                <motion.section variants={variants.item} className={`${PANEL} flex min-h-[460px] flex-col p-6 sm:p-8`}>
                  <PanelHeader title="Tender split" hint="How customers paid" />

                  {derived.pieData.length === 0 ? (
                    <EmptyState
                      icon={CreditCard}
                      title="No payments yet"
                      hint="Payment methods will appear once orders are finalized."
                    />
                  ) : (
                    <>
                      <div className="relative mx-auto h-[210px] w-full max-w-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={derived.pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={72}
                              outerRadius={100}
                              paddingAngle={4}
                              dataKey="value"
                              nameKey="name"
                              stroke="none"
                            >
                              {derived.pieData.map((entry) => (
                                <Cell key={entry.key} fill={entry.fill} />
                              ))}
                            </Pie>
                            <RechartsTooltip content={<ChartTooltip isCurrency />} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-xs text-white/45">Received</span>
                          <span className="font-display text-xl font-bold text-white">
                            {formatCompactCurrency(derived.paymentTotal)}
                          </span>
                        </div>
                      </div>

                      <ul className="mt-6 space-y-4">
                        {derived.pieData.map((row) => {
                          const share = percent(row.value, derived.paymentTotal);
                          return (
                            <li key={row.key}>
                              <div className="mb-1.5 flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-white/80">
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.fill }} />
                                  {row.name}
                                </span>
                                <span className="font-display font-bold text-white">
                                  {formatCurrency(row.value)}
                                  <span className="ml-2 font-sans text-xs font-normal text-white/40">
                                    {share.toFixed(0)}%
                                  </span>
                                </span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                                <div
                                  className="h-full rounded-full transition-all duration-700"
                                  style={{ width: `${share}%`, backgroundColor: row.fill }}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </motion.section>
              </div>

              {/* Asset health + Volume leaders + Ledger */}
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                {/* Inventory */}
                <motion.section variants={variants.item} className={`${PANEL} relative flex min-h-[500px] flex-col overflow-hidden p-6 sm:p-8`}>
                  <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#D4AF37]/10 blur-[80px]" />
                  <PanelHeader title="Stock health" hint="Inventory value and items running low" />

                  <div className="relative mb-6">
                    <p className="text-sm text-white/50">Inventory value</p>
                    <p className="mt-1 font-display text-4xl font-black text-[#D4AF37] lg:text-5xl">
                      {formatCurrency(stats.kpis.inventory.total_value)}
                    </p>
                    <p className="mt-2 text-sm text-white/40">
                      Across {formatNumber(stats.kpis.inventory.total_items)} units
                    </p>
                  </div>

                  <div className="relative flex min-h-0 flex-1 flex-col rounded-xl border border-white/[0.06] bg-black/40 p-5">
                    {stats.kpis.inventory.low_stock > 0 ? (
                      <div className="flex h-full flex-col">
                        <div className="mb-4 flex flex-none items-center gap-3">
                          <div className="rounded-lg bg-red-500/15 p-2 text-red-400">
                            <ShieldAlert className="h-5 w-5" />
                          </div>
                          <p className="font-display text-lg font-bold text-red-300">
                            {stats.kpis.inventory.low_stock} {stats.kpis.inventory.low_stock === 1 ? 'item needs' : 'items need'} restocking
                          </p>
                        </div>
                        <ul className="custom-scrollbar max-h-[200px] flex-1 space-y-3 overflow-y-auto pr-2">
                          {stats.kpis.inventory.low_stock_details.map((item, i) => (
                            <li
                              key={`${item.name}-${i}`}
                              className="flex items-center justify-between border-b border-white/5 pb-3 text-sm"
                            >
                              <span className="max-w-[60%] truncate text-white/80">{item.name}</span>
                              <span className="rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300">
                                {item.stock} left · min {item.threshold}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center text-center">
                        <CheckCircle2 className="mb-3 h-14 w-14 text-emerald-400" />
                        <p className="font-display text-xl font-bold text-emerald-300">Stock is healthy</p>
                        <p className="mt-1 text-sm text-white/40">Every item is above its minimum level.</p>
                      </div>
                    )}
                  </div>
                </motion.section>

                {/* Volume leaders */}
                <motion.section variants={variants.item} className={`${PANEL} flex min-h-[500px] flex-col p-6 sm:p-8`}>
                  <PanelHeader title="Volume leaders" hint="Best-selling products by units" />
                  <div className="min-h-0 w-full flex-1">
                    {stats.charts.top_products.length === 0 ? (
                      <EmptyState
                        icon={Box}
                        title="No sales yet"
                        hint="Top products will show up after the first sale in this period."
                      />
                    ) : (
                      <ResponsiveContainer width="100%" height={380}>
                        <BarChart
                          data={stats.charts.top_products}
                          layout="vertical"
                          margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal vertical={false} />
                          <XAxis type="number" hide />
                          <YAxis
                            dataKey="_id"
                            type="category"
                            width={120}
                            tick={{ fill: 'rgba(255,255,255,0.75)', fontSize: 12 }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(name) => (name.length > 16 ? `${name.slice(0, 15)}…` : name)}
                          />
                          <RechartsTooltip
                            cursor={{ fill: 'rgba(212,175,55,0.06)' }}
                            content={<ChartTooltip isCurrency={false} labelType="text" />}
                          />
                          <Bar dataKey="quantity_sold" name="Units" radius={[0, 8, 8, 0]} barSize={24}>
                            {stats.charts.top_products.map((entry, index) => (
                              <Cell key={`bar-${entry._id}-${index}`} fill={index === 0 ? GOLD : GOLD_SOFT} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </motion.section>

                {/* Live ledger */}
                <motion.section variants={variants.item} className={`${PANEL} flex min-h-[500px] flex-col p-6 sm:p-8`}>
                  <PanelHeader
                    title="Live ledger"
                    hint={`${filteredOrders.length} ${filteredOrders.length === 1 ? 'order' : 'orders'} · ${formatCurrency(filteredOrdersTotal)}`}
                  />

                  <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter orders by payment method">
                    {['all', ...METHOD_ORDER.filter((k) => k !== 'other')].map((key) => {
                      const active = ledgerFilter === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setLedgerFilter(key)}
                          aria-pressed={active}
                          className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                            active
                              ? 'bg-white text-black'
                              : 'border border-white/10 text-white/55 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          {key === 'all' ? 'All' : METHOD_META[key].label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="custom-scrollbar -mx-2 max-h-[340px] min-h-0 flex-1 overflow-auto px-2">
                    <table className="w-full whitespace-nowrap text-left">
                      <thead className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#0c0b09]">
                        <tr>
                          <th className="py-3 text-xs font-medium text-white/45">Order</th>
                          <th className="py-3 text-center text-xs font-medium text-white/45">Paid by</th>
                          <th className="py-3 text-right text-xs font-medium text-white/45">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrders.length === 0 ? (
                          <tr>
                            <td colSpan="3" className="py-12 text-center text-sm text-white/40">
                              No orders match this filter.
                            </td>
                          </tr>
                        ) : (
                          filteredOrders.map((order) => {
                            const isFinal =
                              !order.status || FINAL_STATUSES.includes(order.status.toLowerCase());
                            return (
                              <tr
                                key={order.id}
                                className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.04]"
                              >
                                <td className="py-4">
                                  <div className="flex flex-col">
                                    <span className="font-display text-lg font-bold text-[#D4AF37]">
                                      #{order.order_number}
                                    </span>
                                    <span className="mt-0.5 flex items-center gap-2 text-xs text-white/40">
                                      {safeFormatDate(order.created_at)}
                                      {!isFinal && (
                                        <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                                          {order.status}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-4 text-center">
                                  <MethodBadge method={order.payment_method} />
                                </td>
                                <td className="py-4 text-right">
                                  <span className="font-display text-lg font-bold text-white">
                                    {formatCurrency(order.total_amount)}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </motion.section>
              </div>

              {/* Footer actions */}
              <motion.footer variants={variants.item} className="flex items-center justify-between pb-4 pt-2 text-sm text-white/35">
                <span className="flex items-center gap-2">
                  <Receipt className="h-4 w-4" />
                  Figures use finalized orders in the selected dates
                </span>
                <button
                  onClick={() => setShowDataCheck((v) => !v)}
                  className="flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-white/60 transition hover:bg-white/10 hover:text-white"
                >
                  <Bug className="h-4 w-4" />
                  Data check
                </button>
              </motion.footer>
            </motion.div>
          )}
        </div>

        {/* Data check drawer */}
        <AnimatePresence>
          {showDataCheck && stats && (
            <DataCheckPanel raw={rawStats} stats={stats} onClose={() => setShowDataCheck(false)} />
          )}
        </AnimatePresence>
      </div>
    </>
  );
}