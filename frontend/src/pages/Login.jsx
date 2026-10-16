import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  motion,
  AnimatePresence,
  animate,
  useAnimationControls,
  useMotionValue,
  useMotionTemplate,
  useSpring,
  useTransform,
  useReducedMotion,
} from 'framer-motion';
import { User, Lock, ArrowRight, Eye, EyeOff, Sparkles, Shield, Zap, Check, Loader2, AlertTriangle, RotateCcw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { warmServer } from '../api/queries';
import logoImage from '../assets/logo.jpg'; // Best results: a transparent PNG (logo.png). Change the import if you switch.

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */
const INTRO_KEY = 'nxt_intro_seen';
const REMEMBER_KEY = 'nxt_remember_user';
// Set to false if your logo file is NOT transparent (the light sweep uses the logo's shape as a mask)
const LOGO_HAS_ALPHA = true;

const HEADLINE_WORDS = ['Modern Retail.', 'Handmade Luxury.', 'Nature’s Touch.', 'Smart Billing.'];

/* ------------------------------------------------------------------ */
/*  Gold particle vortex + burst (canvas)                              */
/* ------------------------------------------------------------------ */
function ParticleCanvas({ burstRef }) {
  const ref = useRef(null);

  useEffect(() => {
    const c = ref.current;
    const ctx = c.getContext('2d');
    let w = 0, h = 0, raf, last = performance.now(), burstDone = false, fade = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = c.clientWidth;
      h = c.clientHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const maxR = () => Math.hypot(w, h) / 2;
    const make = (fresh) => ({
      a: Math.random() * Math.PI * 2,
      r: fresh ? Math.random() * maxR() : maxR() * (0.85 + Math.random() * 0.2),
      v: 0.5 + Math.random() * 0.9,
      w: 0.5 + Math.random() * 1.1,
      s: 0.6 + Math.random() * 1.8,
      al: 0.3 + Math.random() * 0.6,
    });
    const N = w < 640 ? 50 : 110;
    const parts = Array.from({ length: N }, () => make(true));
    let sparks = [];

    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cx = w / 2, cy = h / 2;
      const minR = Math.min(w, h) * 0.16;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(3,3,3,0.22)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      if (burstRef.current && !burstDone) {
        burstDone = true;
        sparks = Array.from({ length: w < 640 ? 70 : 130 }, () => {
          const a = Math.random() * Math.PI * 2;
          const sp = 120 + Math.random() * 520;
          return { x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, s: 0.8 + Math.random() * 2.2 };
        });
      }
      if (burstDone) fade = Math.min(1, fade + dt * 0.7);

      for (const p of parts) {
        const speed = 160 * (p.r / maxR() * 0.8 + 0.2) * p.v;
        p.r -= speed * dt;
        p.a += p.w * dt * (1.2 - p.r / maxR());
        if (p.r < minR) Object.assign(p, make(false));
        const x = cx + Math.cos(p.a) * p.r;
        const y = cy + Math.sin(p.a) * p.r;
        const alpha = p.al * (1 - 0.7 * fade);
        ctx.fillStyle = `rgba(232,190,92,${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, p.s, 0, Math.PI * 2);
        ctx.fill();
      }

      sparks = sparks.filter((s) => s.life > 0);
      for (const s of sparks) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= 0.965;
        s.vy *= 0.965;
        s.vy += 18 * dt;
        s.life -= dt * 0.75;
        ctx.fillStyle = `rgba(255,214,120,${Math.max(0, s.life)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.s, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [burstRef]);

  return <canvas ref={ref} className="absolute inset-0 w-full h-full" aria-hidden />;
}

/* ------------------------------------------------------------------ */
/*  Cinematic splash: vortex → logo unveil → burst → logo flies home   */
/* ------------------------------------------------------------------ */
function Splash({ ping, targetRef, onLeave, onLanded, reduce }) {
  const logoControls = useAnimationControls();
  const logoRef = useRef(null);
  const burstRef = useRef(false);
  const wentRef = useRef(false);
  const readyRef = useRef({ time: false, ping: false });
  const cbRef = useRef({ onLeave, onLanded });
  cbRef.current = { onLeave, onLanded };

  const progress = useMotionValue(0);
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [canSkip, setCanSkip] = useState(false);
  const [flash, setFlash] = useState(false);

  const minTime = reduce ? 900 : 3000;

  const go = useCallback(async () => {
    if (wentRef.current) return;
    wentRef.current = true;
    setLeaving(true);
    cbRef.current.onLeave();

    const el = logoRef.current;
    const target = targetRef.current;
    if (el && target) {
      const a = el.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      await logoControls.start({
        x: b.left + b.width / 2 - (a.left + a.width / 2),
        y: b.top + b.height / 2 - (a.top + a.height / 2),
        scale: b.width / el.offsetWidth,
        clipPath: 'inset(0% 0% 0% 0%)',
        opacity: 1,
        filter: 'blur(0px)',
        transition: { duration: reduce ? 0.3 : 1.15, ease: [0.76, 0, 0.24, 1] },
      });
    }
    cbRef.current.onLanded();
  }, [logoControls, targetRef, reduce]);

  const finishIfReady = useCallback(() => {
    const r = readyRef.current;
    if (r.time && r.ping && !wentRef.current) {
      animate(progress, 1, { duration: 0.35, ease: 'easeOut' }).then(go);
    }
  }, [go, progress]);

  // Mount: run the timeline
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const unsub = progress.on('change', (v) => setPct(Math.round(v * 100)));
    const prog = animate(progress, 0.88, { duration: (minTime / 1000) * 0.95, ease: 'circOut' });

    logoControls.start({
      clipPath: 'inset(0% 0% 0% 0%)',
      opacity: 1,
      scale: 1,
      filter: 'blur(0px)',
      transition: { duration: reduce ? 0.5 : 1.5, delay: reduce ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] },
    });

    const timers = [
      setTimeout(() => setCanSkip(true), 1200),
      setTimeout(() => {
        readyRef.current.time = true;
        finishIfReady();
      }, minTime),
      setTimeout(() => go(), 7000), // hard stop, never trap the user
    ];
    if (!reduce) {
      timers.push(setTimeout(() => { burstRef.current = true; setFlash(true); }, 1750));
      timers.push(setTimeout(() => setFlash(false), 2300));
    }

    return () => {
      document.body.style.overflow = prevOverflow;
      unsub();
      prog.stop();
      timers.forEach(clearTimeout);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Server ping resolved → allowed to finish
  useEffect(() => {
    if (ping.state !== 'pending') {
      readyRef.current.ping = true;
      finishIfReady();
    }
  }, [ping.state, finishIfReady]);

  // Skip with click / key
  useEffect(() => {
    if (!canSkip) return;
    const onKey = (e) => {
      if (['Enter', ' ', 'Escape'].includes(e.key)) go();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSkip, go]);

  const stage = 'min(78vw, 56vh, 420px)';
  const status =
    ping.state === 'pending'
      ? 'Waking up the server…'
      : ping.state === 'ok'
      ? `Server online · ${ping.ms} ms`
      : 'Server unreachable. You can still try signing in.';

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden"
      onClick={() => canSkip && go()}
      role="status"
      aria-label="Loading NXT VIBE"
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-[#030303]"
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{ duration: 0.9, delay: 0.15 }}
      >
        {!reduce && <ParticleCanvas burstRef={burstRef} />}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at center, rgba(212,175,55,0.12), transparent 55%)' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.85) 100%)' }} />
      </motion.div>

      {/* Burst flash */}
      <AnimatePresence>
        {flash && (
          <motion.div
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.55, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            style={{ background: 'radial-gradient(circle at center, rgba(255,226,150,0.55), transparent 55%)' }}
          />
        )}
      </AnimatePresence>

      {/* Rings + glow (fade out when leaving) */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="relative" style={{ width: stage, height: stage }}>
          <motion.div
            className="absolute inset-[8%] rounded-full bg-gold-500/25 blur-3xl"
            animate={reduce ? {} : { opacity: [0.35, 0.8, 0.35], scale: [0.95, 1.08, 0.95] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
          {!reduce && (
            <motion.svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full" animate={{ rotate: 360 }} transition={{ duration: 50, repeat: Infinity, ease: 'linear' }}>
              <motion.circle cx="100" cy="100" r="97" fill="none" stroke="rgba(212,175,55,0.55)" strokeWidth="0.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2, delay: 0.3, ease: 'easeInOut' }} />
              <motion.circle cx="100" cy="100" r="92" fill="none" stroke="rgba(212,175,55,0.35)" strokeWidth="1.2" strokeDasharray="0.6 4.2" strokeLinecap="round" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.4, delay: 0.8 }} />
            </motion.svg>
          )}
          {!reduce && (
            <motion.svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full" animate={{ rotate: -360 }} transition={{ duration: 80, repeat: Infinity, ease: 'linear' }}>
              <motion.circle cx="100" cy="100" r="88" fill="none" stroke="rgba(255,214,120,0.25)" strokeWidth="0.4" strokeDasharray="14 10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.6, delay: 1 }} />
            </motion.svg>
          )}
        </div>
      </motion.div>

      {/* Logo (this element flies to the login page slot) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div
          ref={logoRef}
          initial={{ clipPath: 'inset(47% 0% 47% 0%)', opacity: 0, scale: 0.9, filter: 'blur(14px)' }}
          animate={logoControls}
          className="relative aspect-square"
          style={{ width: `calc(${stage} * 0.74)` }}
        >
          <img src={logoImage} alt="NXT VIBE" className="w-full h-full object-contain drop-shadow-[0_0_24px_rgba(212,175,55,0.35)]" draggable={false} />
          {LOGO_HAS_ALPHA && !reduce && (
            <motion.div
              aria-hidden
              className="absolute inset-0"
              style={{
                WebkitMaskImage: `url(${logoImage})`,
                maskImage: `url(${logoImage})`,
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
                backgroundImage: 'linear-gradient(105deg, transparent 42%, rgba(255,240,200,0.95) 50%, transparent 58%)',
                backgroundSize: '260% 100%',
                backgroundRepeat: 'no-repeat',
              }}
              initial={{ backgroundPosition: '150% 0%' }}
              animate={{ backgroundPosition: ['150% 0%', '-50% 0%'] }}
              transition={{ duration: 1.6, delay: 2, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }}
            />
          )}
        </motion.div>
      </div>

      {/* Progress */}
      <motion.div
        className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pointer-events-none"
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{ duration: 0.4 }}
      >
        <p className="text-[11px] tracking-[0.3em] uppercase text-gold-400/80 tabular-nums">
          {ping.state === 'ok' && pct >= 88 ? 'Welcome' : 'Preparing your workspace'} · {pct}%
        </p>
        <div className="w-56 sm:w-72 h-[2px] bg-white/10 rounded-full overflow-hidden">
          <motion.div className="h-full bg-gradient-to-r from-gold-600 via-gold-300 to-amber-200 origin-left" style={{ scaleX: progress }} />
        </div>
        <p className={`text-xs ${ping.state === 'down' ? 'text-amber-400' : 'text-gray-500'}`}>{status}</p>
        <AnimatePresence>
          {canSkip && !leaving && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} exit={{ opacity: 0 }} className="text-[10px] tracking-widest uppercase text-gray-600 mt-1">
              Tap anywhere to skip
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small live pieces                                                  */
/* ------------------------------------------------------------------ */
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const h = now.getHours();
  const greeting = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  return (
    <div className="flex items-center justify-between gap-3 text-[11px] tracking-widest uppercase text-gray-500">
      <span className="text-gold-400/90 font-semibold">{greeting}</span>
      <span className="tabular-nums">
        {now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })} ·{' '}
        {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
      </span>
    </div>
  );
}

function ServerPill({ ping }) {
  const map = {
    pending: ['Connecting…', 'text-gray-400 border-white/10 bg-white/5', 'bg-gray-400'],
    ok: [`Server online · ${ping.ms} ms`, 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10', 'bg-emerald-400'],
    down: ['Server offline', 'text-red-400 border-red-500/20 bg-red-500/10', 'bg-red-400'],
  };
  const [label, cls, dot] = map[ping.state];
  return (
    <span className={`inline-flex items-center gap-2 text-[11px] font-semibold px-3 py-1.5 rounded-full border ${cls}`}>
      <span className="relative flex w-1.5 h-1.5">
        {ping.state !== 'down' && <span className={`absolute inset-0 rounded-full ${dot} animate-ping opacity-70`} />}
        <span className={`relative w-1.5 h-1.5 rounded-full ${dot}`} />
      </span>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Login                                                              */
/* ------------------------------------------------------------------ */
export default function Login() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  // Intro state
  const introSeen = useMemo(() => {
    try { return sessionStorage.getItem(INTRO_KEY) === '1'; } catch { return false; }
  }, []);
  const [phase, setPhase] = useState(introSeen ? 'done' : 'splash'); // splash | flying | done
  const [logoLanded, setLogoLanded] = useState(introSeen);
  const revealed = phase !== 'splash';
  const logoSlotRef = useRef(null);

  // Server ping (also wakes a sleeping free-tier backend) - once on mount, no timer
  const [ping, setPing] = useState({ state: 'pending', ms: null });
  useEffect(() => {
    const t0 = performance.now();
    warmServer()
      .then(() => setPing({ state: 'ok', ms: Math.round(performance.now() - t0) }))
      .catch(() => setPing({ state: 'down', ms: null }));
  }, []);

  // Form
  const [formData, setFormData] = useState(() => {
    let u = '';
    try { u = localStorage.getItem(REMEMBER_KEY) || ''; } catch { /* ignore */ }
    return { username: u, password: '' };
  });
  const [remember, setRemember] = useState(() => {
    try { return !!localStorage.getItem(REMEMBER_KEY); } catch { return false; }
  });
  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [error, setError] = useState('');
  const [errorTick, setErrorTick] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(null);
  const btnRef = useRef(null);
  const userRef = useRef(null);

  // Pointer-driven effects (motion values → no re-renders)
  const mx = useMotionValue(600);
  const my = useMotionValue(400);
  const nx = useMotionValue(0);
  const ny = useMotionValue(0);
  const spotlight = useMotionTemplate`radial-gradient(800px circle at ${mx}px ${my}px, rgba(212,175,55,0.08), transparent 40%)`;
  const orbX = useSpring(useTransform(nx, (v) => v * -40), { stiffness: 40, damping: 20 });
  const orbY = useSpring(useTransform(ny, (v) => v * -30), { stiffness: 40, damping: 20 });
  const tiltY = useSpring(useTransform(nx, (v) => v * 10), { stiffness: 120, damping: 18 });
  const tiltX = useSpring(useTransform(ny, (v) => v * -10), { stiffness: 120, damping: 18 });

  const handlePointerMove = (e) => {
    mx.set(e.clientX);
    my.set(e.clientY);
    nx.set((e.clientX / window.innerWidth) * 2 - 1);
    ny.set((e.clientY / window.innerHeight) * 2 - 1);
  };

  // Magnetic button
  const bx = useSpring(useMotionValue(0), { stiffness: 200, damping: 15 });
  const by = useSpring(useMotionValue(0), { stiffness: 200, damping: 15 });
  const onBtnMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    bx.set((e.clientX - (r.left + r.width / 2)) * 0.12);
    by.set((e.clientY - (r.top + r.height / 2)) * 0.25);
  };
  const onBtnLeave = () => { bx.set(0); by.set(0); };

  // Rotating headline
  const [wi, setWi] = useState(0);
  useEffect(() => {
    if (!revealed || reduce) return;
    const t = setInterval(() => setWi((i) => (i + 1) % HEADLINE_WORDS.length), 2800);
    return () => clearInterval(t);
  }, [revealed, reduce]);

  // Floating gold dust (deterministic per mount)
  const dust = useMemo(
    () => Array.from({ length: 16 }, (_, i) => ({
      left: `${(i * 37 + 11) % 100}%`,
      size: 2 + (i % 3),
      dur: 14 + (i % 6) * 3,
      delay: -((i * 1.7) % 14),
    })),
    []
  );

  // Focus username on desktop once the intro is done
  useEffect(() => {
    if (phase === 'done' && window.matchMedia('(min-width: 1024px)').matches && !formData.username) {
      userRef.current?.focus();
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLeave = useCallback(() => setPhase('flying'), []);
  const handleLanded = useCallback(() => {
    setLogoLanded(true);
    try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* ignore */ }
    requestAnimationFrame(() => setPhase('done'));
  }, []);
  const replayIntro = () => {
    try { sessionStorage.removeItem(INTRO_KEY); } catch { /* ignore */ }
    window.scrollTo(0, 0);
    setLogoLanded(false);
    setPhase('splash');
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await api.post('/auth/login', formData);
      const jwtToken = response.data.token || response.data.access_token;
      if (!jwtToken) throw new Error('No token received from server');

      localStorage.setItem('token', jwtToken);
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, formData.username);
        else localStorage.removeItem(REMEMBER_KEY);
      } catch { /* ignore */ }

      const r = btnRef.current?.getBoundingClientRect();
      setSuccess({
        x: r ? r.left + r.width / 2 : window.innerWidth / 2,
        y: r ? r.top + r.height / 2 : window.innerHeight / 2,
      });
      setTimeout(() => navigate('/dashboard'), reduce ? 250 : 1150);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Invalid username or password.');
      setErrorTick((t) => t + 1);
      setIsLoading(false);
    }
  };

  const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.35 } } };
  const fadeUp = {
    hidden: { opacity: 0, y: 30 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } },
  };

  const inputCls =
    'w-full bg-white/[0.03] border border-white/10 rounded-2xl text-white placeholder-gray-600 focus:outline-none focus:border-gold-500/60 focus:bg-gold-500/[0.05] focus:shadow-[0_0_0_4px_rgba(212,175,55,0.08)] transition-all duration-300 text-sm sm:text-base py-4 sm:py-[1.15rem]';

  const coverRadius = typeof window !== 'undefined' ? Math.hypot(window.innerWidth, window.innerHeight) * 1.1 : 2000;

  return (
    <>
      <style>{`
        .font-playfair { font-family: 'Playfair Display', serif; }
        @keyframes shimmer { 100% { transform: translateX(200%) skewX(12deg); } }
        @keyframes marquee { to { transform: translateX(-50%); } }
        @keyframes dustUp { 0% { transform: translateY(0) scale(1); opacity: 0; } 15% { opacity: .7; } 100% { transform: translateY(-110vh) scale(.6); opacity: 0; } }
        .dust { position: absolute; bottom: -10px; border-radius: 9999px; background: rgba(232,190,92,.9); box-shadow: 0 0 8px rgba(212,175,55,.8); animation: dustUp linear infinite; }
        @media (prefers-reduced-motion: reduce) { .dust { display: none; } }
      `}</style>

      {/* Cinematic intro */}
      {phase !== 'done' && (
        <Splash ping={ping} targetRef={logoSlotRef} onLeave={handleLeave} onLanded={handleLanded} reduce={!!reduce} />
      )}

      <div
        onPointerMove={handlePointerMove}
        className="min-h-[100dvh] bg-[#030303] flex items-center justify-center p-3 sm:p-6 lg:p-8 font-sans overflow-hidden relative selection:bg-gold-500/30 w-full"
      >
        {/* Ambient layers */}
        <motion.div aria-hidden className="pointer-events-none fixed inset-0 z-0" style={{ background: spotlight }} />
        <motion.div aria-hidden style={{ x: orbX, y: orbY }} className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-gold-600/10 rounded-full blur-[120px] mix-blend-screen animate-[pulse_8s_ease-in-out_infinite] pointer-events-none z-0" />
        <motion.div aria-hidden style={{ x: orbX, y: orbY }} className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] bg-amber-700/10 rounded-full blur-[150px] mix-blend-screen animate-[pulse_10s_ease-in-out_infinite_reverse] pointer-events-none z-0" />
        <div aria-hidden className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          {dust.map((d, i) => (
            <span key={i} className="dust" style={{ left: d.left, width: d.size, height: d.size, animationDuration: `${d.dur}s`, animationDelay: `${d.delay}s` }} />
          ))}
        </div>

        {/* Card with a travelling gold light on its border */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: revealed ? 1 : 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="relative z-10 w-full max-w-[1400px] rounded-[1.75rem] sm:rounded-[3rem] p-px overflow-hidden bg-white/[0.06] shadow-[0_0_80px_rgba(0,0,0,0.8)]"
        >
          <div
            aria-hidden
            className="absolute -inset-[100%] animate-[spin_14s_linear_infinite]"
            style={{ background: 'conic-gradient(from 0deg, transparent 0deg, transparent 290deg, rgba(212,175,55,0.95) 340deg, transparent 360deg)' }}
          />
          <div className="relative grid grid-cols-1 lg:grid-cols-2 rounded-[calc(1.75rem-1px)] sm:rounded-[calc(3rem-1px)] overflow-hidden bg-[#060606]/95 backdrop-blur-3xl lg:min-h-[780px]">

            {/* LEFT: brand */}
            <div className="relative p-6 sm:p-12 lg:p-16 flex flex-col justify-between bg-gradient-to-br from-black/60 to-transparent overflow-hidden">
              <motion.div initial="hidden" animate={revealed ? 'show' : 'hidden'} variants={stagger} className="relative z-10 max-w-xl w-full mx-auto lg:mx-0">
                {/* Logo slot: the intro logo lands exactly here */}
                <div ref={logoSlotRef} className="relative mb-6 lg:mb-10 w-24 h-24 sm:w-32 sm:h-32 lg:w-40 lg:h-40 mx-auto lg:mx-0">
                  <motion.div
                    aria-hidden
                    className="absolute -inset-6 rounded-full bg-gradient-to-r from-gold-500 to-amber-300 blur-3xl"
                    animate={{ opacity: logoLanded ? [0.12, 0.28, 0.12] : 0 }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.img
                    src={logoImage}
                    alt="NXT VIBE Logo"
                    draggable={false}
                    style={{ rotateX: tiltX, rotateY: tiltY, transformPerspective: 900, opacity: logoLanded ? 1 : 0 }}
                    className="relative w-full h-full object-contain drop-shadow-[0_0_15px_rgba(212,175,55,0.3)]"
                  />
                </div>

                <div className="mb-5 lg:mb-8 text-center lg:text-left">
                  <motion.h1 variants={fadeUp} className="text-3xl sm:text-5xl lg:text-6xl font-playfair font-black text-white leading-[1.15] tracking-tight">
                    The Art of
                  </motion.h1>
                  <motion.div variants={fadeUp} className="relative h-[1.3em] overflow-hidden text-3xl sm:text-5xl lg:text-6xl font-playfair font-black leading-[1.15] tracking-tight">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={wi}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: '-100%', opacity: 0 }}
                        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-x-0 lg:inset-x-auto lg:left-0 whitespace-nowrap text-transparent bg-clip-text bg-gradient-to-r from-gold-400 via-amber-300 to-gold-600"
                      >
                        {HEADLINE_WORDS[wi]}
                      </motion.span>
                    </AnimatePresence>
                  </motion.div>
                </div>

                <motion.p variants={fadeUp} className="hidden sm:block text-gray-400 text-base lg:text-lg max-w-md leading-relaxed mb-10 lg:mb-14 font-light">
                  Precision engineering meets elegant design. Experience sub-second transactions and absolute inventory control.
                </motion.p>

                <motion.div variants={stagger} className="hidden sm:grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                  {[
                    [Zap, 'bg-gold-500/10', 'text-gold-400', 'Lightning Fast POS', 'Sub-second processing.'],
                    [Shield, 'bg-amber-500/10', 'text-amber-400', 'Atomic Inventory', 'Zero-collision tracking.'],
                  ].map(([Icon, bg, fg, title, sub]) => (
                    <motion.div key={title} variants={fadeUp} whileHover={{ y: -4 }} className="flex items-center gap-4 bg-white/[0.03] p-4 rounded-2xl border border-white/[0.06] hover:border-gold-500/30 transition-colors backdrop-blur-md">
                      <div className={`p-3 ${bg} rounded-xl`}><Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${fg}`} /></div>
                      <div>
                        <h3 className="text-white font-semibold text-sm sm:text-base">{title}</h3>
                        <p className="text-gray-500 text-xs sm:text-sm">{sub}</p>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              </motion.div>

              {/* Brand marquee */}
              <div className="relative z-10 mt-8 lg:mt-12 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)] hidden sm:block">
                <div className="flex w-max animate-[marquee_30s_linear_infinite] font-playfair italic text-lg text-gold-500/50 whitespace-nowrap">
                  {[0, 1].map((k) => (
                    <div key={k} className="flex gap-8 pr-8" aria-hidden={k === 1}>
                      {['Nature Touch', 'Handmades', 'Nxt Vibe', 'Nature Touch', 'Handmades', 'Nxt Vibe'].map((t, i) => (
                        <span key={i} className="flex gap-8">{t}<span className="text-gold-500/30">✦</span></span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT: form */}
            <div className="p-6 sm:p-12 lg:p-16 flex flex-col justify-center relative z-10 border-t lg:border-t-0 lg:border-l border-white/[0.05] bg-black/30">
              <motion.div
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: revealed ? 1 : 0, x: revealed ? 0 : 24 }}
                transition={{ duration: 0.8, delay: 0.5, type: 'spring', stiffness: 90, damping: 18 }}
                className="w-full max-w-md mx-auto relative"
              >
                <div className="absolute -top-20 -right-20 w-40 h-40 bg-gold-500/10 rounded-full blur-[80px] pointer-events-none" />

                <div className="mb-6"><LiveClock /></div>

                <div className="mb-8 sm:mb-10">
                  <h2 className="text-3xl sm:text-4xl font-black text-white mb-3 flex items-center gap-3 font-playfair tracking-wide">
                    Welcome Back
                    <motion.span animate={reduce ? {} : { rotate: [0, 15, -10, 0], scale: [1, 1.2, 1] }} transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 2 }}>
                      <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 text-gold-500" />
                    </motion.span>
                  </h2>
                  <p className="text-gray-400 text-sm sm:text-base font-light mb-4">Authenticate to access your command center.</p>
                  <ServerPill ping={ping} />
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-6">
                      <motion.div
                        key={errorTick}
                        animate={{ x: [0, -10, 10, -6, 6, 0] }}
                        transition={{ duration: 0.45 }}
                        role="alert"
                        className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-sm flex items-center gap-3 backdrop-blur-md"
                      >
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        {error}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
                  <div className="space-y-2.5 relative group">
                    <label htmlFor="username" className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-widest group-focus-within:text-gold-400 transition-colors">Admin Username</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-gray-500 group-focus-within:text-gold-400 transition-colors"><User className="h-5 w-5" /></div>
                      <input
                        ref={userRef}
                        id="username"
                        type="text"
                        name="username"
                        autoComplete="username"
                        value={formData.username}
                        onChange={handleChange}
                        className={`${inputCls} pl-14 pr-5`}
                        placeholder="Enter identity"
                        required
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <div className="space-y-2.5 relative group">
                    <label htmlFor="password" className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-widest group-focus-within:text-gold-400 transition-colors">Access Code</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-gray-500 group-focus-within:text-gold-400 transition-colors"><Lock className="h-5 w-5" /></div>
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        autoComplete="current-password"
                        value={formData.password}
                        onChange={handleChange}
                        onKeyDown={(e) => setCapsOn(!!e.getModifierState?.('CapsLock'))}
                        onKeyUp={(e) => setCapsOn(!!e.getModifierState?.('CapsLock'))}
                        onBlur={() => setCapsOn(false)}
                        className={`${inputCls} pl-14 pr-14 font-mono`}
                        placeholder="••••••••"
                        required
                        disabled={isLoading}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 pr-5 flex items-center text-gray-500 hover:text-white transition-colors">
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span key={showPassword ? 'off' : 'on'} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
                            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                          </motion.span>
                        </AnimatePresence>
                      </button>
                    </div>
                    <AnimatePresence>
                      {capsOn && (
                        <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="text-xs text-amber-400 flex items-center gap-1.5 overflow-hidden">
                          <AlertTriangle className="w-3.5 h-3.5" /> Caps Lock is on
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>

                  <label className="flex items-center gap-3 text-sm text-gray-400 cursor-pointer select-none w-fit">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 accent-gold-500 rounded" />
                    Remember my username on this device
                  </label>

                  <motion.div style={{ x: bx, y: by }} onPointerMove={onBtnMove} onPointerLeave={onBtnLeave} className="pt-2">
                    <button
                      ref={btnRef}
                      type="submit"
                      disabled={isLoading}
                      className="group relative w-full flex justify-between items-center py-4 sm:py-5 px-6 sm:px-8 border border-white/10 rounded-2xl text-sm sm:text-base font-bold text-black bg-gradient-to-r from-gold-400 via-amber-400 to-gold-500 bg-[length:200%_auto] hover:bg-[position:right_center] transition-all duration-500 overflow-hidden shadow-[0_0_40px_rgba(212,175,55,0.2)] hover:shadow-[0_0_60px_rgba(212,175,55,0.4)] active:scale-[0.99] disabled:opacity-60 disabled:cursor-wait"
                    >
                      <span className="relative z-10 tracking-wide">{isLoading ? 'Authenticating…' : 'Initialize Session'}</span>
                      <div className="relative z-10 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-black/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                        {isLoading ? <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" /> : <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 text-black group-hover:translate-x-1 transition-transform" />}
                      </div>
                      <div className="absolute inset-y-0 left-0 w-1/2 -translate-x-full group-hover:animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12" />
                    </button>
                  </motion.div>
                </form>

                <p className="mt-10 text-center text-xs sm:text-sm text-gray-500">
                  System not configured?
                  <Link to="/register" className="font-bold text-gray-300 hover:text-gold-400 transition-colors ml-2 border-b border-transparent hover:border-gold-400 pb-0.5">
                    Deploy Network
                  </Link>
                </p>

                <div className="mt-6 flex items-center justify-between text-[11px] text-gray-600">
                  <span>© NXT VIBE · Nature Touch Handmades</span>
                  <button type="button" onClick={replayIntro} className="flex items-center gap-1 hover:text-gold-400 transition-colors">
                    <RotateCcw className="w-3 h-3" /> Replay intro
                  </button>
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* Success: gold curtain expands from the button */}
        <AnimatePresence>
          {success && (
            <motion.div
              className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-gradient-to-br from-gold-300 via-amber-400 to-gold-600 text-black"
              initial={{ clipPath: `circle(0px at ${success.x}px ${success.y}px)` }}
              animate={{ clipPath: `circle(${coverRadius}px at ${success.x}px ${success.y}px)` }}
              transition={{ duration: reduce ? 0.2 : 0.9, ease: [0.76, 0, 0.24, 1] }}
            >
              <motion.div
                initial={{ scale: 0, rotate: -45 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: reduce ? 0 : 0.55, type: 'spring', stiffness: 260, damping: 16 }}
                className="w-20 h-20 rounded-full bg-black/85 text-gold-400 flex items-center justify-center shadow-2xl"
              >
                <Check className="w-10 h-10" strokeWidth={3} />
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : 0.7 }}
                className="mt-5 font-playfair font-black text-3xl sm:text-4xl tracking-tight"
              >
                Welcome back
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}