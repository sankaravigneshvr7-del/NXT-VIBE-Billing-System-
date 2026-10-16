import { useMemo } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from './client';

const unwrap = (response) => response.data;

/* ------------------------------------------------------------------ */
/*  Products (ONE shared query used by Layout, POS, Inventory, Treats)  */
/* ------------------------------------------------------------------ */
export const productsQueryOptions = {
  queryKey: ['products'],
  queryFn: ({ signal }) => api.get('/inventory/products', { signal }).then(unwrap),
  staleTime: 30_000,
};

// Full response: { products: [...], metrics: {...} }
export const useProducts = (options = {}) => useQuery({ ...productsQueryOptions, ...options });

// Layout bell + sidebar badge. Same query key => NO extra network request.
const selectLowStock = (data) => {
  const list = data?.products || data || [];
  return list
    .map((p) => ({
      id: p.id,
      name: p.name,
      units: p.boxes_in_stock * p.units_per_box + p.loose_units_in_stock,
      threshold: p.low_stock_unit_threshold,
    }))
    .filter((p) => p.units <= p.threshold)
    .sort((a, b) => a.units - b.units);
};
export const useLowStock = () => useQuery({ ...productsQueryOptions, select: selectLowStock });

/* ------------------------------------------------------------------ */
/*  Dashboard                                                           */
/* ------------------------------------------------------------------ */
export function useDashboardStats(range) {
  const start = range.start.toISOString();
  const end = range.end.toISOString();
  const start_date = format(range.start, 'yyyy-MM-dd');
  const end_date = format(range.end, 'yyyy-MM-dd');
  const tz_offset = new Date().getTimezoneOffset();
  return useQuery({
    queryKey: ['dashboard', start, end, tz_offset],
    queryFn: ({ signal }) =>
      api.get('/dashboard/stats', { params: { start, end, start_date, end_date, tz_offset }, signal }).then(unwrap),
    staleTime: 20_000,
    placeholderData: keepPreviousData, // no blank flash when changing the date range
  });
}

/* ------------------------------------------------------------------ */
/*  POS order history                                                   */
/* ------------------------------------------------------------------ */
// Local (Chennai) day boundaries -> UTC ISO strings for the API.
// ('2026-10-11' + 'T00:00:00' without Z is parsed as LOCAL time.)
export const dayStartIso = (ymd) => new Date(`${ymd}T00:00:00`).toISOString();
export const dayEndIso = (ymd) => new Date(`${ymd}T23:59:59.999`).toISOString();

export function useOrders(params, enabled = true) {
  return useQuery({
    queryKey: ['orders', params],
    queryFn: ({ signal }) => api.get('/pos/orders', { params, signal }).then(unwrap),
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

/* ------------------------------------------------------------------ */
/*  Staff treats                                                        */
/* ------------------------------------------------------------------ */
export const useTreatsHistory = () =>
  useQuery({
    queryKey: ['treats', 'history'],
    queryFn: ({ signal }) => api.get('/treats/', { signal }).then(unwrap),
    staleTime: 30_000,
  });

export const useStaffNames = () =>
  useQuery({
    queryKey: ['treats', 'staff'],
    queryFn: ({ signal }) => api.get('/treats/staff', { signal }).then(unwrap),
    staleTime: 5 * 60_000,
  });

export const useTreatsSummary = () =>
  useQuery({
    queryKey: ['treats', 'summary'],
    queryFn: ({ signal }) => api.get('/treats/summary', { signal }).then(unwrap),
    staleTime: 30_000,
    retry: (count, err) => err?.response?.status !== 403 && count < 1,
  });

/* ------------------------------------------------------------------ */
/*  Server status dot (Layout). Light ping only - never touches the DB. */
/* ------------------------------------------------------------------ */
export const useServerPing = () =>
  useQuery({
    queryKey: ['ping'],
    queryFn: async () => {
      const t0 = performance.now();
      await api.get('/ping', { timeout: 8000 });
      return Math.round(performance.now() - t0);
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

// One-time warm-up for the login page: wakes Render AND Neon (SELECT 1).
// Do NOT call this on a timer: Neon free has monthly compute-hour limits.
export const warmServer = () => api.get('/ping', { params: { db: 1 }, timeout: 60000 });

/* ------------------------------------------------------------------ */
/*  Invalidation after changes (replaces manual fetchProducts() etc.)   */
/* ------------------------------------------------------------------ */
export function useInvalidators() {
  const qc = useQueryClient();
  return useMemo(() => {
    const inv = (...keys) => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
    return {
      afterSale: () => inv(['products'], ['orders'], ['dashboard']),          // POS checkout / void
      afterProductChange: () => inv(['products'], ['dashboard']),             // Inventory add / edit / delete
      afterTreatChange: () => inv(['products'], ['treats'], ['dashboard']),   // log / settle / delete treat
    };
  }, [qc]);
}