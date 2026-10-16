import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Lock, ArrowRight, Eye, EyeOff, Hexagon, Sparkles, Database, Shield } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import logoImage from '../assets/logo.jpg';

export default function Register() {
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 500, y: 500 });
  const navigate = useNavigate();

  // --- Mouse Spotlight Tracker ---
  const handleMouseMove = (e) => {
    setMousePos({ x: e.clientX, y: e.clientY });
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
      const response = await api.post('/auth/signup', formData);
      const jwtToken = response.data.token || response.data.access_token;
      if (!jwtToken) throw new Error("No token received from server");
      
      localStorage.setItem('token', jwtToken);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Registration failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // Animation Variants
  const staggerContainer = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.15, delayChildren: 0.2 } }
  };

  const fadeUp = {
    hidden: { opacity: 0, y: 30 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 100, damping: 20 } }
  };

  return (
    <>
      {/* Injecting Playfair Display for the premium serif aesthetic */}
      <style>{`
        .font-playfair { font-family: 'Playfair Display', serif; }
      `}</style>

      <div 
        onMouseMove={handleMouseMove}
        className="min-h-screen bg-[#030303] flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans overflow-hidden relative selection:bg-gold-500/30 w-full"
      >
        {/* --- Interactive Ambient Spotlight --- */}
        <div 
          className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-300"
          style={{
            background: `radial-gradient(800px circle at ${mousePos.x}px ${mousePos.y}px, rgba(212,175,55,0.07), transparent 40%)`
          }}
        />

        {/* --- Deep Background Orbs --- */}
        <div className="absolute bottom-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-gold-600/10 rounded-full blur-[120px] mix-blend-screen animate-[pulse_8s_ease-in-out_infinite] pointer-events-none z-0"></div>
        <div className="absolute top-[-10%] right-[-10%] w-[40vw] h-[40vw] bg-amber-700/10 rounded-full blur-[150px] mix-blend-screen animate-[pulse_10s_ease-in-out_infinite_reverse] pointer-events-none z-0"></div>

        {/* --- Main Glassmorphic Container --- */}
        <div className="w-full max-w-[1400px] grid grid-cols-1 lg:grid-cols-2 gap-0 bg-white/[0.02] rounded-[2rem] sm:rounded-[3rem] shadow-[0_0_80px_rgba(0,0,0,0.8)] overflow-hidden border border-white/[0.05] relative z-10 backdrop-blur-3xl min-h-[600px] lg:min-h-[800px] flex-col-reverse lg:flex-row">
          
          {/* LEFT SIDE: Brand & Network Visuals */}
          <div className="relative p-8 sm:p-12 lg:p-20 flex flex-col justify-between items-start overflow-hidden bg-gradient-to-br from-black/60 to-transparent order-2 lg:order-1 border-t lg:border-t-0 lg:border-r border-white/[0.05]">
            <motion.div 
              initial="hidden"
              animate="show"
              variants={staggerContainer}
              className="w-full max-w-xl mx-auto lg:mx-0 relative z-10"
            >
              {/* Premium Logo Reveal */}
              <motion.div variants={fadeUp} className="relative inline-block mb-10 lg:mb-16 group">
                <div className="absolute inset-0 bg-gradient-to-r from-gold-500 to-amber-300 rounded-full blur-2xl opacity-20 group-hover:opacity-40 animate-[pulse_4s_ease-in-out_infinite] transition duration-1000"></div>
                <img 
                  src={logoImage} 
                  alt="NXT VIBE Logo" 
                  className="h-20 sm:h-24 lg:h-32 w-auto object-contain relative z-10 drop-shadow-[0_0_15px_rgba(212,175,55,0.3)] transition-transform duration-700 group-hover:scale-105" 
                />
              </motion.div>

              {/* Playfair Typography Headline */}
              <div className="space-y-4 mb-8">
                <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-7xl font-playfair font-black text-white leading-[1.1] tracking-tight">
                  Establish Your
                </motion.h1>
                <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-7xl font-playfair font-black text-transparent bg-clip-text bg-gradient-to-r from-gold-400 via-amber-300 to-gold-600 leading-[1.1] tracking-tight">
                  Enterprise Core.
                </motion.h1>
              </div>
              
              <motion.p variants={fadeUp} className="text-gray-400 text-base sm:text-lg max-w-md leading-relaxed mb-12 lg:mb-20 font-light">
                Deploy a dedicated, single-tenant database architecture for uncompromised performance and total data sovereignty.
              </motion.p>

              {/* Feature Tags */}
              <motion.div variants={staggerContainer} className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                <motion.div variants={fadeUp} className="flex items-center space-x-4 bg-white/[0.03] p-4 rounded-2xl border border-white/[0.05] backdrop-blur-md">
                  <div className="p-3 bg-gold-500/10 rounded-xl"><Database className="w-5 h-5 sm:w-6 sm:h-6 text-gold-400" /></div>
                  <div>
                    <h3 className="text-white font-semibold text-sm sm:text-base">Isolated Storage</h3>
                    <p className="text-gray-500 text-xs sm:text-sm">Single-shop schema.</p>
                  </div>
                </motion.div>
                <motion.div variants={fadeUp} className="flex items-center space-x-4 bg-white/[0.03] p-4 rounded-2xl border border-white/[0.05] backdrop-blur-md">
                  <div className="p-3 bg-amber-500/10 rounded-xl"><Shield className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" /></div>
                  <div>
                    <h3 className="text-white font-semibold text-sm sm:text-base">Root Security</h3>
                    <p className="text-gray-500 text-xs sm:text-sm">Encrypted administrator profile.</p>
                  </div>
                </motion.div>
              </motion.div>
            </motion.div>
          </div>

          {/* RIGHT SIDE: Interactive Registration Form */}
          <div className="p-8 sm:p-12 lg:p-20 flex flex-col justify-center relative z-10 bg-black/20 order-1 lg:order-2">
            <motion.div 
              initial={{ opacity: 0, x: 20 }} 
              animate={{ opacity: 1, x: 0 }} 
              transition={{ duration: 0.8, delay: 0.3, type: "spring" }} 
              className="w-full max-w-md mx-auto relative"
            >
              {/* Form Ambient Glow */}
              <div className="absolute -top-20 -right-20 w-40 h-40 bg-gold-500/10 rounded-full blur-[80px] pointer-events-none"></div>
              
              <div className="mb-10">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/5 border border-white/10 mb-6 backdrop-blur-md shadow-[inset_0_0_15px_rgba(212,175,55,0.1)]">
                  <Sparkles className="w-6 h-6 text-gold-400" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-black text-white mb-3 font-playfair tracking-wide">
                  Deploy Network
                </h2>
                <p className="text-gray-400 text-sm sm:text-base font-light">Configure the root administrator profile for your POS architecture.</p>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }} 
                    animate={{ opacity: 1, height: 'auto' }} 
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-8 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-sm flex items-center gap-3 backdrop-blur-md overflow-hidden"
                  >
                    <Hexagon className="w-5 h-5 text-red-500 flex-shrink-0" />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-3 relative group">
                  <label className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-widest group-focus-within:text-gold-400 transition-colors">Root Username</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-gray-500 group-focus-within:text-gold-400 transition-colors">
                      <User className="h-5 w-5" />
                    </div>
                    <input 
                      type="text" 
                      name="username" 
                      value={formData.username} 
                      onChange={handleChange} 
                      className="w-full pl-14 pr-5 py-4 sm:py-5 bg-white/[0.02] border border-white/10 rounded-2xl text-white placeholder-gray-600 focus:outline-none focus:border-gold-500/50 focus:bg-gold-500/5 focus:ring-1 focus:ring-gold-500/50 transition-all duration-300 text-sm sm:text-base shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]" 
                      placeholder="e.g. admin_core" 
                      required 
                      disabled={isLoading} 
                    />
                  </div>
                </div>

                <div className="space-y-3 relative group">
                  <label className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-widest group-focus-within:text-gold-400 transition-colors">Encryption Key</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-gray-500 group-focus-within:text-gold-400 transition-colors">
                      <Lock className="h-5 w-5" />
                    </div>
                    <input 
                      type={showPassword ? "text" : "password"} 
                      name="password" 
                      value={formData.password} 
                      onChange={handleChange} 
                      className="w-full pl-14 pr-14 py-4 sm:py-5 bg-white/[0.02] border border-white/10 rounded-2xl text-white placeholder-gray-600 focus:outline-none focus:border-gold-500/50 focus:bg-gold-500/5 focus:ring-1 focus:ring-gold-500/50 transition-all duration-300 font-mono text-sm sm:text-base shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]" 
                      placeholder="••••••••" 
                      required 
                      disabled={isLoading} 
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-5 flex items-center text-gray-500 hover:text-white transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <button 
                  type="submit" 
                  disabled={isLoading} 
                  className="group relative w-full mt-10 flex justify-between items-center py-4 sm:py-5 px-6 sm:px-8 border border-white/20 rounded-2xl text-sm sm:text-base font-bold text-white bg-white/5 hover:bg-white/10 backdrop-blur-md transition-all duration-500 overflow-hidden hover:border-gold-500/50 hover:shadow-[0_0_40px_rgba(212,175,55,0.2)] disabled:opacity-50 disabled:cursor-wait"
                >
                  <span className="relative z-10 tracking-wide group-hover:text-gold-300 transition-colors">{isLoading ? 'Compiling Profile...' : 'Build Environment'}</span>
                  <div className="relative z-10 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-gold-500/20 transition-colors duration-300">
                    <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 text-gray-300 group-hover:text-gold-400 group-hover:translate-x-1 transition-all" />
                  </div>
                  <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12"></div>
                </button>
              </form>

              <p className="mt-12 text-center text-xs sm:text-sm text-gray-500">
                Existing architecture found? 
                <Link to="/" className="font-bold text-gray-300 hover:text-gold-400 transition-colors ml-2 border-b border-transparent hover:border-gold-400 pb-0.5">
                  Return to Login
                </Link>
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </>
  );
}