import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Auth pages load right away (first screen)
import Login from './pages/Login';
import Register from './pages/Register';

// Layout
import Layout from './components/Layout';

// Protected pages are loaded on demand, so the login page does not download
// recharts / html2canvas / every page's code up front.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Inventory = lazy(() => import('./pages/Inventory'));
const POS = lazy(() => import('./pages/POS'));
const Treats = lazy(() => import('./pages/Treats'));

// Simple Protected Route Wrapper
const ProtectedRoute = () => {
  const token = localStorage.getItem('token');

  if (!token) {
    return <Navigate to="/" replace />;
  }

  // Render the Layout component which contains the <Outlet />
  return <Layout />;
};

const PageLoader = () => (
  <div className="min-h-screen bg-black flex items-center justify-center">
    <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-[#D4AF37] animate-spin" />
  </div>
);

export default function App() {
  return (
    <Router>
      {/* Safety net. For no sidebar flicker, ALSO wrap {outlet} inside Layout.jsx in its own <Suspense> (see the prompt file). */}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected Routes rendered INSIDE the Layout via Outlet */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/pos" element={<POS />} />
            <Route path="/treats" element={<Treats />} />

            {/* Catch-all for authenticated users */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </Router>
  );
}