import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,            // data is "fresh" for 30s: no refetch when you revisit a page
      gcTime: 5 * 60_000,           // keep unused data in memory for 5 min
      retry: 1,                     // one retry (helps while the free server wakes up)
      refetchOnWindowFocus: false,  // no surprise refetch when you alt-tab back
      refetchOnReconnect: true,
    },
    mutations: { retry: 0 },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)