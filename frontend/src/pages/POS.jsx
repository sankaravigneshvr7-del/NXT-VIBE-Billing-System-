import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  motion,
  AnimatePresence,
  MotionConfig,
  useDragControls,
  useMotionValue,
  animate,
} from 'framer-motion';
import api from '../api/client';
import { useProducts, useOrders, dayStartIso, dayEndIso, useInvalidators } from '../api/queries';
import html2canvas from 'html2canvas';
import { format } from 'date-fns';
import {
  Search, Plus, Minus, Trash2, ShoppingCart,
  CreditCard, Banknote, SplitSquareHorizontal,
  X, ArrowRight, Activity, Share2, Receipt,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

// Tiny debounce hook (used for the order-history search box)
function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(amount || 0);

// Smoothly counts from the previous value to the new one
function AnimatedMoney({ value }) {
  const mv = useMotionValue(value);
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.45, ease: 'easeOut' });
    const unsub = mv.on('change', (v) => setDisplay(v));
    return () => {
      controls.stop();
      unsub();
    };
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{formatCurrency(display)}</>;
}

/* ------------------------------------------------------------------ */
/*  Product card: cursor spotlight, stock meter, tap burst             */
/* ------------------------------------------------------------------ */
function ProductCard({ product, index, qtyInCart, onAdd }) {
  const [bursts, setBursts] = useState([]);

  const totalUnits = product.boxes_in_stock * product.units_per_box + product.loose_units_in_stock;
  const hasStockInfo = Number.isFinite(totalUnits);
  const isOut = hasStockInfo && totalUnits <= 0;
  const isLow = hasStockInfo && !isOut && totalUnits <= product.low_stock_unit_threshold;
  const stockRatio = hasStockInfo
    ? Math.min(1, totalUnits / Math.max(1, (product.low_stock_unit_threshold || 1) * 4))
    : 1;

  const handleMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  const handleClick = () => {
    if (isOut) return;
    onAdd(product);
    const id = Date.now() + Math.random();
    setBursts((b) => [...b, id]);
    setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 700);
    if (navigator.vibrate) navigator.vibrate(8);
  };

  const initials = (product.name || '?')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      onMouseMove={handleMove}
      disabled={isOut}
      initial={{ opacity: 0, y: 24, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, delay: Math.min(index, 18) * 0.03 }}
      whileHover={isOut ? undefined : { y: -4 }}
      whileTap={isOut ? undefined : { scale: 0.95 }}
      className={`group relative isolate text-left h-40 sm:h-44 p-3.5 sm:p-4 rounded-2xl overflow-hidden flex flex-col justify-between
        bg-gradient-to-br from-white/[0.06] to-white/[0.015] border border-white/[0.07]
        hover:border-gold-500/40 hover:shadow-[0_12px_40px_-12px_rgba(212,175,55,0.35)]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 transition-[border-color,box-shadow] duration-300
        ${isOut ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {/* Cursor spotlight */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background:
            'radial-gradient(180px circle at var(--mx, 50%) var(--my, 0%), rgba(212,175,55,0.20), transparent 70%)',
        }}
      />
      {/* Sheen sweep on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 -z-10 -skew-x-12 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent
          -translate-x-full group-hover:translate-x-[450%] transition-transform duration-[900ms] ease-out"
      />

      {/* Top row: monogram + cart badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-400/30 to-amber-600/10 border border-gold-500/20 flex items-center justify-center text-[11px] font-black text-gold-400 tracking-wide shrink-0">
          {initials}
        </div>
        <AnimatePresence>
          {qtyInCart > 0 && (
            <motion.span
              key={qtyInCart}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}
              className="min-w-[26px] h-[26px] px-1.5 rounded-full bg-gradient-to-br from-gold-400 to-amber-500 text-black text-xs font-black flex items-center justify-center shadow-[0_0_14px_rgba(212,175,55,0.55)]"
            >
              {qtyInCart}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Name + SKU */}
      <div className="min-h-0">
        <h3 className="font-bold text-gray-100 text-[13px] sm:text-sm leading-tight line-clamp-2 group-hover:text-gold-400 transition-colors">
          {product.name}
        </h3>
        <p className="text-[10px] text-gray-500 font-mono mt-0.5 truncate">{product.sku}</p>
      </div>

      {/* Price + stock meter */}
      <div>
        <div className="flex items-end justify-between gap-2">
          <p className="text-base sm:text-lg font-black text-white tabular-nums">{formatCurrency(product.price_per_unit)}</p>
          {isOut && <span className="text-[10px] font-bold text-gray-400 bg-white/10 px-2 py-0.5 rounded-md">OUT</span>}
          {isLow && (
            <span className="text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-md border border-red-400/20 animate-pulse">
              LOW
            </span>
          )}
        </div>
        <div className="mt-2 h-[3px] rounded-full bg-white/10 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(4, stockRatio * 100)}%` }}
            transition={{ duration: 0.8, delay: 0.2 + Math.min(index, 18) * 0.03, ease: 'easeOut' }}
            className={`h-full rounded-full ${isLow || isOut ? 'bg-red-400' : 'bg-gradient-to-r from-gold-500 to-amber-300'}`}
          />
        </div>
      </div>

      {/* Floating +1 on tap */}
      <AnimatePresence>
        {bursts.map((id) => (
          <motion.span
            key={id}
            initial={{ opacity: 1, y: 0, scale: 0.8 }}
            animate={{ opacity: 0, y: -48, scale: 1.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.65, ease: 'easeOut' }}
            className="pointer-events-none absolute right-4 top-12 text-gold-400 font-black text-lg drop-shadow-[0_0_8px_rgba(212,175,55,0.8)]"
          >
            +1
          </motion.span>
        ))}
      </AnimatePresence>
    </motion.button>
  );
}

function ProductSkeletons() {
  return Array.from({ length: 12 }).map((_, i) => (
    <div key={i} className="h-40 sm:h-44 rounded-2xl bg-white/[0.04] border border-white/5 relative overflow-hidden">
      <motion.div
        className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
        initial={{ x: '-100%' }}
        animate={{ x: '300%' }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear', delay: i * 0.05 }}
      />
    </div>
  ));
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export default function POS() {
  // Data
  const { data: productsData, isLoading: loadingProducts, isError: loadError, refetch: refetchProducts } = useProducts();
  const products = productsData?.products ?? [];
  const invalidators = useInvalidators();
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState('pos'); // 'pos' | 'history'

  // Tabs & cart
  const [tabs, setTabs] = useState([{ id: 1, name: 'Tab #1', items: [] }]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [nextTabId, setNextTabId] = useState(2);
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);

  // History
  const [historyDates, setHistoryDates] = useState({
    start: format(new Date(), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd'),
  });
  const [historySearch, setHistorySearch] = useState('');

  // Modals
  const [paymentModal, setPaymentModal] = useState({ isOpen: false, method: 'cash' });
  const [cashReceived, setCashReceived] = useState('');
  const [splitCash, setSplitCash] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [billModal, setBillModal] = useState({ isOpen: false, order: null });
  const [isGeneratingImg, setIsGeneratingImg] = useState(false);

  const billPrintRef = useRef(null);
  const searchInputRef = useRef(null);
  const cashInputRef = useRef(null);
  const checkoutRef = useRef(() => {});
  const sheetDrag = useDragControls();

  /* ---------------- API ---------------- */
  const debouncedSearch = useDebounce(historySearch, 300);
  const { data: orderHistory = [], refetch: refetchHistory } = useOrders(
    { start: dayStartIso(historyDates.start), end: dayEndIso(historyDates.end), q: debouncedSearch },
    view === 'history'
  );

  /* ---------------- Cart & tabs ---------------- */
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const cartTotal = activeTab?.items.reduce((s, i) => s + i.price_at_sale * i.quantity, 0) || 0;
  const cartCount = activeTab?.items.reduce((s, i) => s + i.quantity, 0) || 0;

  const qtyMap = useMemo(() => {
    const m = {};
    activeTab?.items.forEach((i) => (m[i.product_id] = i.quantity));
    return m;
  }, [activeTab]);

  const handleAddTab = () => {
    setTabs((t) => [...t, { id: nextTabId, name: `Tab #${nextTabId}`, items: [] }]);
    setActiveTabId(nextTabId);
    setNextTabId((n) => n + 1);
  };

  const closeTab = (id) => {
    const idx = tabs.findIndex((t) => t.id === id);
    let newTabs = tabs.filter((t) => t.id !== id);
    if (newTabs.length === 0) {
      newTabs = [{ id: nextTabId, name: `Tab #${nextTabId}`, items: [] }];
      setNextTabId((n) => n + 1);
    }
    setTabs(newTabs);
    if (activeTabId === id) setActiveTabId(newTabs[Math.max(0, idx - 1)].id);
  };

  const addToCart = (product) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const existing = tab.items.find((i) => i.product_id === product.id);
        if (existing) {
          return {
            ...tab,
            items: tab.items.map((i) => (i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i)),
          };
        }
        return {
          ...tab,
          items: [
            ...tab.items,
            { product_id: product.id, name: product.name, price_at_sale: product.price_per_unit, quantity: 1 },
          ],
        };
      })
    );
  };

  const updateQty = (productId, delta) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const items = tab.items
          .map((i) => (i.product_id === productId ? { ...i, quantity: i.quantity + delta } : i))
          .filter((i) => i.quantity > 0);
        return { ...tab, items };
      })
    );
  };

  const clearCart = () =>
    setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? { ...tab, items: [] } : tab)));

  /* ---------------- Checkout ---------------- */
  const openPayment = () => {
    if (cartTotal <= 0) return;
    setCashReceived('');
    setSplitCash('');
    setPaymentModal({ isOpen: true, method: 'cash' });
  };

  const cashFloat = parseFloat(cashReceived) || 0;
  const splitFloat = parseFloat(splitCash) || 0;
  const canPay =
    paymentModal.method === 'cash'
      ? cashFloat >= cartTotal
      : paymentModal.method === 'split'
      ? splitFloat >= 0 && splitFloat <= cartTotal
      : true;

  // Smart cash chips: exact, then next round numbers
  const cashChips = useMemo(() => {
    if (cartTotal <= 0) return [];
    const exact = Math.ceil(cartTotal);
    const set = new Set([exact]);
    [50, 100, 500, 1000].forEach((step) => {
      const v = Math.ceil(cartTotal / step) * step;
      if (v >= cartTotal) set.add(v);
    });
    return [...set].sort((a, b) => a - b).slice(0, 4);
  }, [cartTotal]);

  const handleCheckout = async () => {
    if (cartTotal <= 0 || isProcessing || !activeTab) return;

    const payment = { method: paymentModal.method, cash_amount: 0, upi_amount: 0, change_returned: 0 };

    if (paymentModal.method === 'cash') {
      if (cashFloat < cartTotal) return alert('Insufficient cash received!');
      payment.cash_amount = cartTotal;
      payment.change_returned = cashFloat - cartTotal;
    } else if (paymentModal.method === 'upi') {
      payment.upi_amount = cartTotal;
    } else if (paymentModal.method === 'split') {
      if (splitFloat < 0 || splitFloat > cartTotal) return alert('Invalid split amount!');
      payment.cash_amount = splitFloat;
      payment.upi_amount = cartTotal - splitFloat;
    }

    setIsProcessing(true);
    try {
      const response = await api.post('/pos/orders', { items: activeTab.items, payment });

      setPaymentModal({ isOpen: false, method: 'cash' });
      setIsMobileCartOpen(false);
      invalidators.afterSale(); // not awaited: show the bill immediately
      setBillModal({ isOpen: true, order: response.data.order_data });

      if (tabs.length > 1) closeTab(activeTabId);
      else clearCart();
    } catch (err) {
      alert(err.response?.data?.error || 'Checkout failed.');
    } finally {
      setIsProcessing(false);
    }
  };
  checkoutRef.current = handleCheckout;

  const handleVoidOrder = async (orderId, orderNum) => {
    if (!window.confirm(`Void bill ${orderNum}? This restores inventory.`)) return;
    try {
      await api.delete('/pos/orders/' + orderId);
      await invalidators.afterSale();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to void order.');
    }
  };

  const shareWhatsApp = async (order) => {
    if (!billPrintRef.current) return;
    setIsGeneratingImg(true);
    try {
      const canvas = await html2canvas(billPrintRef.current, { scale: 2, backgroundColor: '#ffffff', logging: false });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], `Invoice_${order.order_number}.png`, { type: 'image/png' });

      const paymentText =
        order.payment_method === 'split'
          ? `SPLIT (Cash: ₹${(order.cash_received || 0).toFixed(2)} | UPI: ₹${(order.upi_received || 0).toFixed(2)})`
          : order.payment_method.toUpperCase();

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Invoice ${order.order_number}`,
          text: `Invoice ${order.order_number} attached. Paid via ${paymentText}.`,
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Invoice_${order.order_number}.png`;
        a.click();

        const phone = prompt('Image downloaded. Enter WhatsApp number (with country code) to open chat:', '91');
        if (phone && phone.length >= 10) {
          const text = `Hello! Please find your invoice attached. Paid via: ${paymentText}.`;
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError') alert('Failed to generate image.');
    } finally {
      setIsGeneratingImg(false);
    }
  };

  /* ---------------- Keyboard ---------------- */
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

      if (e.key === 'Escape') {
        if (billModal.isOpen) return setBillModal({ isOpen: false, order: null });
        if (paymentModal.isOpen) return setPaymentModal({ isOpen: false, method: 'cash' });
        if (isMobileCartOpen) return setIsMobileCartOpen(false);
        searchInputRef.current?.focus();
      }
      if (e.key === '/' && !typing && view === 'pos' && !paymentModal.isOpen && !billModal.isOpen) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Enter' && paymentModal.isOpen && !isProcessing) {
        e.preventDefault();
        checkoutRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paymentModal.isOpen, billModal.isOpen, isMobileCartOpen, isProcessing, view]);

  useEffect(() => {
    if (paymentModal.isOpen && paymentModal.method !== 'upi') {
      const t = setTimeout(() => cashInputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [paymentModal.isOpen, paymentModal.method]);

  // Lock background scroll while the mobile cart sheet is open
  useEffect(() => {
    document.body.style.overflow = isMobileCartOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileCartOpen]);

  /* ---------------- Derived ---------------- */
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)
    );
  }, [products, searchQuery]);

  const historyStats = useMemo(() => {
    const total = orderHistory.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    return { total, count: orderHistory.length, avg: orderHistory.length ? total / orderHistory.length : 0 };
  }, [orderHistory]);

  const paymentBadge = (m) =>
    m === 'upi'
      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
      : m === 'cash'
      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
      : 'bg-purple-500/10 text-purple-400 border border-purple-500/20';

  /* ---------------- Cart panel (shared by sidebar + mobile sheet) ---------------- */
  const renderCart = (isSheet) => (
    <>
      <div className="px-5 py-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02] flex-none">
        <div className="flex items-center gap-3 min-w-0">
          {isSheet && (
            <button onClick={() => setIsMobileCartOpen(false)} className="text-gray-400 hover:text-white p-1 -ml-1" aria-label="Close cart">
              <X className="w-6 h-6" />
            </button>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-black text-white truncate">{activeTab?.name}</h2>
            <p className="text-[11px] text-gray-500">{cartCount} {cartCount === 1 ? 'item' : 'items'}</p>
          </div>
        </div>
        <button
          onClick={clearCart}
          disabled={cartCount === 0}
          className="text-xs font-bold text-red-400 hover:text-red-300 uppercase tracking-wider bg-red-400/10 px-3 py-1.5 rounded-lg border border-red-400/20 transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          Clear
        </button>
      </div>

      <div className="px-4 py-4 flex-1 overflow-y-auto custom-scrollbar overscroll-contain">
        <ul className="space-y-2.5">
          <AnimatePresence initial={false} mode="popLayout">
            {activeTab?.items.map((item) => (
              <motion.li
                key={item.product_id}
                layout
                initial={{ opacity: 0, x: 40, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -60, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="bg-white/[0.04] p-3 rounded-2xl border border-white/[0.06] flex justify-between items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm line-clamp-1">{item.name}</p>
                  <div className="flex items-center gap-1 mt-2 bg-black/50 w-fit rounded-lg border border-white/10 p-0.5">
                    <button onClick={() => updateQty(item.product_id, -1)} aria-label="Decrease" className="w-7 h-7 rounded-md hover:bg-white/10 active:bg-white/20 text-gray-300 flex items-center justify-center transition-colors">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <motion.span
                      key={item.quantity}
                      initial={{ y: -6, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      className="text-sm font-bold w-7 text-center text-gold-400 tabular-nums"
                    >
                      {item.quantity}
                    </motion.span>
                    <button onClick={() => updateQty(item.product_id, 1)} aria-label="Increase" className="w-7 h-7 rounded-md hover:bg-white/10 active:bg-white/20 text-gray-300 flex items-center justify-center transition-colors">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-white tabular-nums">{formatCurrency(item.price_at_sale * item.quantity)}</p>
                  <p className="text-[10px] text-gray-500 mt-1">@ {formatCurrency(item.price_at_sale)}</p>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        {(!activeTab?.items || activeTab.items.length === 0) && (
          <div className="text-center text-gray-500 mt-16">
            <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-25" />
            </motion.div>
            <p className="text-sm font-semibold">Cart is empty</p>
            <p className="text-xs mt-1 text-gray-600">Tap a product to add it</p>
          </div>
        )}
      </div>

      <div className="p-5 bg-white/[0.02] border-t border-white/5 flex-none pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex justify-between items-baseline text-white mb-4">
          <span className="text-sm font-bold text-gray-400">Total</span>
          <span className="text-3xl font-black text-gold-400 tabular-nums">
            <AnimatedMoney value={cartTotal} />
          </span>
        </div>
        <button
          onClick={openPayment}
          disabled={cartTotal <= 0}
          className={`relative overflow-hidden w-full py-4 rounded-xl font-black text-base sm:text-lg transition-all flex justify-center items-center gap-2 ${
            cartTotal > 0
              ? 'bg-gradient-to-r from-gold-400 to-amber-500 text-black shadow-[0_0_24px_rgba(212,175,55,0.3)] hover:shadow-[0_0_34px_rgba(212,175,55,0.5)] active:scale-[0.98]'
              : 'bg-white/5 text-gray-500 cursor-not-allowed'
          }`}
        >
          {cartTotal > 0 && (
            <motion.span
              aria-hidden
              className="absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent"
              initial={{ x: '-150%' }}
              animate={{ x: '450%' }}
              transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 2.5, ease: 'easeInOut' }}
            />
          )}
          <span className="relative">PROCEED TO PAY</span>
          <ArrowRight className="w-5 h-5 relative" />
        </button>
      </div>
    </>
  );

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <MotionConfig reducedMotion="user">
      <div className="h-[calc(100dvh-5rem)] flex flex-col lg:flex-row w-full z-10 overflow-hidden relative text-white bg-[#050505]">
        {/* Ambient glow behind everything */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute -top-32 -left-24 w-[420px] h-[420px] rounded-full bg-gold-500/[0.07] blur-[90px]"
            animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute bottom-0 right-1/3 w-[380px] h-[380px] rounded-full bg-amber-600/[0.05] blur-[100px]"
            animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
            transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        {/* LEFT AREA */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative lg:border-r border-white/5">
          {/* Header */}
          <div className="p-3 bg-black/30 backdrop-blur-md border-b border-white/5 flex flex-col sm:flex-row gap-3 sm:items-center z-10">
            {/* View toggle with sliding pill */}
            <div className="relative flex bg-black/50 p-1 rounded-xl border border-white/10 w-full sm:w-auto shrink-0">
              {[
                ['pos', 'POS Grid'],
                ['history', 'Management'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`relative flex-1 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${view === key ? 'text-gold-400' : 'text-gray-500 hover:text-white'}`}
                >
                  {view === key && (
                    <motion.span
                      layoutId="viewPill"
                      className="absolute inset-0 bg-white/10 rounded-lg shadow-sm"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>

            {/* Tabs */}
            {view === 'pos' && (
              <div className="flex flex-1 min-w-0 gap-2 overflow-x-auto custom-scrollbar items-center pb-1 sm:pb-0 [scrollbar-width:none]">
                <AnimatePresence initial={false}>
                  {tabs.map((tab) => {
                    const active = activeTabId === tab.id;
                    const count = tab.items.reduce((s, i) => s + i.quantity, 0);
                    return (
                      <motion.div
                        key={tab.id}
                        layout
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        onClick={() => setActiveTabId(tab.id)}
                        className={`relative px-3.5 py-2 rounded-xl font-bold text-sm cursor-pointer whitespace-nowrap flex items-center gap-2 border shrink-0 transition-colors ${
                          active ? 'text-gold-400 border-gold-500/30' : 'bg-white/5 text-gray-400 border-white/5 hover:bg-white/10'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="tabPill"
                            className="absolute inset-0 rounded-xl bg-gold-500/20"
                            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                          />
                        )}
                        <span className="relative">{tab.name}</span>
                        {count > 0 && (
                          <span className="relative text-[10px] min-w-[18px] h-[18px] px-1 rounded-full bg-gold-500 text-black flex items-center justify-center font-black">
                            {count}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tab.id);
                          }}
                          aria-label={`Close ${tab.name}`}
                          className="relative hover:text-red-400 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                <button onClick={handleAddTab} aria-label="New tab" className="px-3 py-2 rounded-xl text-gold-500 border border-gold-500/30 border-dashed hover:bg-gold-500/10 transition-colors shrink-0">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {/* POS GRID */}
            {view === 'pos' && (
              <motion.div
                key="pos"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="flex-1 flex flex-col min-h-0 relative"
              >
                <div className="p-3 sm:p-4 border-b border-white/5 bg-black/20">
                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search product or SKU…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-20 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-gold-500/50 focus:bg-white/10 focus:shadow-[0_0_0_4px_rgba(212,175,55,0.08)] transition-all text-sm"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      {searchQuery ? (
                        <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="text-gray-500 hover:text-white">
                          <X className="w-4 h-4" />
                        </button>
                      ) : (
                        <kbd className="hidden sm:block text-[10px] text-gray-500 border border-white/10 rounded px-1.5 py-0.5">/</kbd>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-600 mt-2 px-1">
                    {loadingProducts ? 'Loading products…' : `${filteredProducts.length} of ${products.length} products`}
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 sm:p-4 pb-28 lg:pb-4 overscroll-contain">
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 sm:gap-4">
                    {loadingProducts && <ProductSkeletons />}
                    {!loadingProducts &&
                      filteredProducts.map((p, i) => (
                        <ProductCard key={p.id} product={p} index={i} qtyInCart={qtyMap[p.id] || 0} onAdd={addToCart} />
                      ))}
                  </div>

                  {!loadingProducts && loadError && (
                    <div className="text-center text-gray-400 mt-16">
                      <p className="font-bold">Couldn't load products</p>
                      <p className="text-xs text-gray-600 mt-1">Check that the server is running, then try again.</p>
                      <button onClick={() => refetchProducts()} className="mt-4 px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-bold border border-white/10 transition-colors">
                        Retry
                      </button>
                    </div>
                  )}
                  {!loadingProducts && !loadError && filteredProducts.length === 0 && (
                    <div className="text-center text-gray-500 mt-16">
                      <Search className="w-10 h-10 mx-auto mb-3 opacity-25" />
                      <p className="font-bold">No products match "{searchQuery}"</p>
                      <p className="text-xs text-gray-600 mt-1">Try a different name or SKU.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* HISTORY */}
            {view === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="flex-1 flex flex-col min-h-0 p-3 sm:p-6 bg-black/40 relative overflow-y-auto custom-scrollbar"
              >
                <div className="mb-5">
                  <h2 className="text-xl sm:text-2xl font-black text-white">Bill Management</h2>
                  <p className="text-sm text-gray-500">Reprint invoices, share via WhatsApp, or void records.</p>
                </div>

                {/* Summary tiles */}
                <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-5">
                  {[
                    ['Sales', <AnimatedMoney key="s" value={historyStats.total} />],
                    ['Bills', historyStats.count],
                    ['Avg bill', <AnimatedMoney key="a" value={historyStats.avg} />],
                  ].map(([label, val], i) => (
                    <motion.div
                      key={label}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.07, type: 'spring', stiffness: 260, damping: 24 }}
                      className="p-3 sm:p-4 rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.01] border border-white/[0.07]"
                    >
                      <p className="text-[11px] text-gray-500 font-semibold">{label}</p>
                      <p className="text-sm sm:text-xl font-black text-gold-400 mt-1 tabular-nums truncate">{val}</p>
                    </motion.div>
                  ))}
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-2 sm:gap-3 mb-5">
                  <input type="date" value={historyDates.start} onChange={(e) => setHistoryDates((p) => ({ ...p, start: e.target.value }))} className="flex-1 min-w-[130px] bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-gold-500 text-sm [color-scheme:dark]" />
                  <span className="text-gray-500 self-center text-sm">to</span>
                  <input type="date" value={historyDates.end} onChange={(e) => setHistoryDates((p) => ({ ...p, end: e.target.value }))} className="flex-1 min-w-[130px] bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-gold-500 text-sm [color-scheme:dark]" />
                  <div className="relative flex-1 min-w-[180px] basis-full sm:basis-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input type="text" placeholder="Search order ID…" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-white focus:outline-none focus:border-gold-500 text-sm" />
                  </div>
                  <button onClick={() => refetchHistory()} className="bg-white/10 hover:bg-white/20 text-white px-5 py-2 rounded-xl font-bold transition-colors text-sm border border-white/5">
                    Refresh
                  </button>
                </div>

                {/* Mobile: cards */}
                <div className="md:hidden space-y-2.5">
                  {orderHistory.map((order, i) => (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i, 10) * 0.03 }}
                      className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-gold-400 text-sm truncate">{order.order_number}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{format(new Date(order.created_at), 'dd MMM, HH:mm')}</p>
                        <span className={`inline-block mt-2 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${paymentBadge(order.payment_method)}`}>{order.payment_method}</span>
                      </div>
                      <p className="font-black text-white tabular-nums">{formatCurrency(order.total_amount)}</p>
                      <div className="flex flex-col gap-2">
                        <button onClick={() => setBillModal({ isOpen: true, order })} aria-label="View bill" className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-blue-400 active:bg-blue-500 active:text-white transition-all"><Receipt className="w-4 h-4" /></button>
                        <button onClick={() => handleVoidOrder(order.id, order.order_number)} aria-label="Void bill" className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-red-400 active:bg-red-500 active:text-white transition-all"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Desktop: table */}
                <div className="hidden md:block flex-1 overflow-auto bg-white/[0.02] rounded-3xl border border-white/[0.05] custom-scrollbar">
                  <table className="w-full text-left whitespace-nowrap">
                    <thead className="sticky top-0 bg-black border-b border-white/10 z-10">
                      <tr className="text-xs uppercase tracking-widest text-gray-500">
                        <th className="p-4 font-bold">Order ID</th>
                        <th className="p-4 font-bold">Time</th>
                        <th className="p-4 font-bold">Total</th>
                        <th className="p-4 font-bold">Payment</th>
                        <th className="p-4 font-bold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {orderHistory.map((order, i) => (
                        <motion.tr
                          key={order.id}
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: Math.min(i, 12) * 0.025 }}
                          className="hover:bg-white/[0.03] transition-colors text-sm"
                        >
                          <td className="p-4 font-mono text-gold-400">{order.order_number}</td>
                          <td className="p-4 text-gray-400">{format(new Date(order.created_at), 'dd MMM, HH:mm')}</td>
                          <td className="p-4 font-bold text-white tabular-nums">{formatCurrency(order.total_amount)}</td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${paymentBadge(order.payment_method)}`}>{order.payment_method}</span>
                          </td>
                          <td className="p-4">
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => setBillModal({ isOpen: true, order })} aria-label="View bill" className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-blue-400 hover:bg-blue-500 hover:text-white hover:border-blue-500 transition-all"><Receipt className="w-4 h-4" /></button>
                              <button onClick={() => handleVoidOrder(order.id, order.order_number)} aria-label="Void bill" className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-red-400 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {orderHistory.length === 0 && (
                  <div className="text-center text-gray-500 py-12">
                    <Receipt className="w-10 h-10 mx-auto mb-3 opacity-25" />
                    <p className="font-bold">No bills in this range</p>
                    <p className="text-xs text-gray-600 mt-1">Change the dates or search term.</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* DESKTOP CART SIDEBAR */}
        <aside className="hidden lg:flex flex-col w-[380px] xl:w-[420px] flex-none h-full bg-black/40 backdrop-blur-xl relative">
          {renderCart(false)}
        </aside>

        {/* MOBILE: floating cart bar */}
        <AnimatePresence>
          {view === 'pos' && cartCount > 0 && !isMobileCartOpen && (
            <motion.button
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              onClick={() => setIsMobileCartOpen(true)}
              className="lg:hidden fixed bottom-3 inset-x-3 z-40 mb-[env(safe-area-inset-bottom)] flex items-center justify-between gap-3 bg-gradient-to-r from-gold-400 to-amber-500 text-black px-5 py-3.5 rounded-2xl font-black shadow-[0_10px_40px_rgba(212,175,55,0.45)]"
            >
              <span className="flex items-center gap-2">
                <span className="relative">
                  <ShoppingCart className="w-5 h-5" />
                  <motion.span
                    key={cartCount}
                    initial={{ scale: 1.8 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                    className="absolute -top-2 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-black text-gold-400 text-[10px] flex items-center justify-center"
                  >
                    {cartCount}
                  </motion.span>
                </span>
                <span className="ml-2">View cart</span>
              </span>
              <span className="tabular-nums"><AnimatedMoney value={cartTotal} /></span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* MOBILE: cart bottom sheet (drag the handle down to close) */}
        <AnimatePresence>
          {isMobileCartOpen && (
            <>
              <motion.div
                key="sheet-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMobileCartOpen(false)}
                className="lg:hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
              />
              <motion.aside
                key="sheet"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                drag="y"
                dragControls={sheetDrag}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 120 || info.velocity.y > 500) setIsMobileCartOpen(false);
                }}
                className="lg:hidden fixed inset-x-0 bottom-0 z-[55] h-[88dvh] flex flex-col rounded-t-[2rem] bg-[#0a0a0a] border-t border-white/10 shadow-[0_-20px_60px_rgba(0,0,0,0.6)] overflow-hidden"
              >
                <div onPointerDown={(e) => sheetDrag.start(e)} className="py-3 flex justify-center cursor-grab touch-none flex-none">
                  <span className="w-12 h-1.5 rounded-full bg-white/20" />
                </div>
                {renderCart(true)}
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* PAYMENT MODAL */}
        <AnimatePresence>
          {paymentModal.isOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-end sm:items-center justify-center sm:p-4"
              onClick={() => setPaymentModal({ isOpen: false, method: 'cash' })}
            >
              <motion.div
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, y: 60, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 60, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                className="bg-[#0a0a0a] w-full sm:max-w-md rounded-t-[2rem] sm:rounded-[2rem] p-6 sm:p-8 border border-white/10 shadow-2xl relative max-h-[94dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
              >
                <button onClick={() => setPaymentModal({ isOpen: false, method: 'cash' })} aria-label="Close" className="absolute top-5 right-5 text-gray-500 hover:text-white">
                  <X className="w-6 h-6" />
                </button>

                <h2 className="text-2xl font-black text-white mb-5">Checkout</h2>

                <div className="relative overflow-hidden text-center mb-6 p-5 sm:p-6 bg-white/5 rounded-2xl border border-white/5">
                  <motion.div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-gold-500/10 to-transparent"
                    initial={{ x: '-100%' }}
                    animate={{ x: '100%' }}
                    transition={{ duration: 1.2, ease: 'easeOut' }}
                  />
                  <p className="relative text-gray-400 text-xs font-semibold uppercase tracking-widest">Amount due</p>
                  <h1 className="relative text-4xl sm:text-5xl font-black text-gold-400 mt-2 tabular-nums">{formatCurrency(cartTotal)}</h1>
                </div>

                {/* Method switch with sliding pill */}
                <div className="flex bg-black p-1 rounded-xl mb-5 border border-white/10">
                  {[
                    ['cash', Banknote, 'Cash'],
                    ['upi', CreditCard, 'UPI'],
                    ['split', SplitSquareHorizontal, 'Split'],
                  ].map(([key, Icon, label]) => (
                    <button
                      key={key}
                      onClick={() => setPaymentModal((p) => ({ ...p, method: key }))}
                      className={`relative flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-colors ${paymentModal.method === key ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      {paymentModal.method === key && (
                        <motion.span layoutId="payPill" className="absolute inset-0 bg-white/10 rounded-lg" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
                      )}
                      <Icon className="w-4 h-4 relative" />
                      <span className="relative">{label}</span>
                    </button>
                  ))}
                </div>

                <div className="min-h-[7.5rem] mb-5">
                  <AnimatePresence mode="wait" initial={false}>
                    {paymentModal.method === 'cash' && (
                      <motion.div key="cash" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Cash received</label>
                        <input ref={cashInputRef} type="number" inputMode="decimal" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white text-xl font-bold focus:outline-none focus:border-gold-500" placeholder="0" />
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {cashChips.map((c) => (
                            <button key={c} type="button" onClick={() => setCashReceived(String(c))} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-gold-500/20 hover:text-gold-400 border border-white/10 text-xs font-bold text-gray-300 transition-colors">
                              ₹{c}
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 flex justify-between items-center text-sm">
                          <span className="text-gray-400">Change due</span>
                          <span className={`font-bold tabular-nums ${cashFloat - cartTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatCurrency(Math.max(0, cashFloat - cartTotal))}
                          </span>
                        </div>
                      </motion.div>
                    )}
                    {paymentModal.method === 'upi' && (
                      <motion.div key="upi" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-[7.5rem] flex flex-col items-center justify-center text-center">
                        <span className="relative flex items-center justify-center mb-2">
                          <motion.span className="absolute w-12 h-12 rounded-full border border-gold-500/50" animate={{ scale: [1, 1.8], opacity: [0.6, 0] }} transition={{ duration: 1.6, repeat: Infinity }} />
                          <Activity className="w-8 h-8 text-gold-500" />
                        </span>
                        <p className="text-white font-bold">Awaiting scan</p>
                        <p className="text-xs text-gray-500 mt-1">Confirm payment in your banking app.</p>
                      </motion.div>
                    )}
                    {paymentModal.method === 'split' && (
                      <motion.div key="split" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="flex gap-3 sm:gap-4 items-start">
                        <div className="flex-1 min-w-0">
                          <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Cash part</label>
                          <input ref={cashInputRef} type="number" inputMode="decimal" value={splitCash} onChange={(e) => setSplitCash(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white text-xl font-bold focus:outline-none focus:border-gold-500" placeholder="0" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">UPI part</label>
                          <div className="w-full bg-white/5 border border-white/5 rounded-xl px-3 sm:px-4 py-3 text-gold-400 text-lg sm:text-xl font-bold flex items-center h-[52px] tabular-nums overflow-hidden">
                            {formatCurrency(Math.max(0, cartTotal - splitFloat))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  onClick={handleCheckout}
                  disabled={isProcessing || !canPay}
                  className="w-full bg-gradient-to-r from-gold-400 to-amber-500 text-black py-4 rounded-xl font-black text-lg hover:shadow-[0_0_20px_rgba(212,175,55,0.4)] active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none"
                >
                  {isProcessing ? 'PROCESSING…' : (
                    <>CONFIRM &amp; PRINT <span className="hidden sm:inline text-sm font-bold opacity-60">(Enter)</span></>
                  )}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* BILL MODAL */}
        <AnimatePresence>
          {billModal.isOpen && billModal.order && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center p-3 sm:p-4"
              onClick={() => setBillModal({ isOpen: false, order: null })}
            >
              <motion.div
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-[#0a0a0a] w-full max-w-sm rounded-[2rem] p-5 sm:p-6 border border-white/10 shadow-2xl flex flex-col max-h-[92dvh]"
              >
                <div className="flex justify-between items-center mb-4 flex-none">
                  <div className="flex items-center gap-3">
                    {/* Self-drawing checkmark */}
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
                      <motion.circle cx="16" cy="16" r="14" stroke="#D4AF37" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5 }} />
                      <motion.path d="M10 16.5l4 4 8-9" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.4 }} />
                    </svg>
                    <h2 className="text-xl font-black text-white">E-Invoice</h2>
                  </div>
                  <button onClick={() => setBillModal({ isOpen: false, order: null })} aria-label="Close" className="text-gray-500 hover:text-white">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                {/* Receipt "prints" downward */}
                <motion.div
                  initial={{ clipPath: 'inset(0 0 100% 0)' }}
                  animate={{ clipPath: 'inset(0 0 0% 0)' }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.15 }}
                  className="flex-1 min-h-0 flex flex-col"
                >
                  <div ref={billPrintRef} className="bg-white p-5 sm:p-6 text-black font-mono shadow-sm flex-1 overflow-y-auto min-h-0">
                    <div className="text-center mb-5 border-b-2 border-black/10 pb-4">
                      <h1 className="text-2xl font-black tracking-tighter">NXT VIBE</h1>
                      <p className="text-[10px] font-bold uppercase tracking-widest mt-1">Order: {billModal.order.order_number}</p>
                      <p className="text-[10px] text-gray-500 mt-1">{format(new Date(billModal.order.created_at), 'dd MMM yyyy, HH:mm')}</p>
                    </div>

                    <div className="space-y-3 mb-5">
                      {billModal.order.items.map((i, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.3 + idx * 0.06 }}
                          className="flex justify-between text-sm font-bold"
                        >
                          <span className="pr-4">{i.quantity}x {i.name}</span>
                          <span className="tabular-nums">{formatCurrency(i.quantity * i.price_at_sale)}</span>
                        </motion.div>
                      ))}
                    </div>

                    <div className="flex justify-between border-t-2 border-black/10 pt-4 text-lg font-black">
                      <span>TOTAL</span>
                      <span className="tabular-nums">{formatCurrency(billModal.order.total_amount)}</span>
                    </div>

                    <div className="text-center mt-5 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      Paid via: {billModal.order.payment_method === 'split' ? 'SPLIT (CASH/UPI)' : billModal.order.payment_method}
                    </div>
                    <div className="text-center mt-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Thank you for visiting!</div>
                  </div>
                  {/* Torn paper edge */}
                  <div
                    aria-hidden
                    className="h-3 flex-none"
                    style={{
                      background: 'linear-gradient(135deg, #fff 6px, transparent 0), linear-gradient(225deg, #fff 6px, transparent 0)',
                      backgroundSize: '12px 12px',
                    }}
                  />
                </motion.div>

                <div className="flex flex-col gap-2.5 flex-none mt-4">
                  <button onClick={() => shareWhatsApp(billModal.order)} disabled={isGeneratingImg} className="w-full bg-[#25D366] hover:bg-green-600 text-white py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2 shadow-md disabled:opacity-50">
                    <Share2 className="w-5 h-5" /> {isGeneratingImg ? 'Generating…' : 'Share Image'}
                  </button>
                  <button onClick={() => setBillModal({ isOpen: false, order: null })} className="w-full bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl font-bold transition-colors border border-white/10">
                    Close <span className="hidden sm:inline opacity-50 text-sm">(Esc)</span>
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