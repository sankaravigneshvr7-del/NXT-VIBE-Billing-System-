import axios from 'axios';

// Set VITE_API_URL in .env (local) and in your hosting dashboard (production).
// It must include the /api part, e.g. https://your-service.onrender.com/api
export const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000/api').replace(/\/+$/, '');

const api = axios.create({
  baseURL: API_URL,
  // Render free can take 30-50s to wake up; do not give up too early.
  timeout: 60000,
});

// Attach the JWT to every request (no more per-file authHeaders()).
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Expired / invalid token -> clear it and go back to the login page once.
// (Wrong password on the login page is NOT affected: no token is stored yet.)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const jwtProblem = status === 401 || (status === 422 && error.response?.data?.msg);
    if (jwtProblem && localStorage.getItem('token')) {
      localStorage.removeItem('token');
      if (!['/', '/register'].includes(window.location.pathname)) {
        window.location.assign('/');
      }
    }
    return Promise.reject(error);
  }
);

export default api;