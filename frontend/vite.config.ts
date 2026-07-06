import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': o app controla o momento do reload (src/lib/pwa-update.ts faz
      // polling do sw.js, mostra toast e recarrega ~3s depois). O SW novo espera
      // o SKIP_WAITING enviado por updateServiceWorker(true).
      registerType: 'prompt',
      // O registro é feito pelo módulo virtual importado em main.tsx.
      injectRegister: 'auto',
      // Preserva o manifest.json existente em public/ (não regerar).
      manifest: false,
      // Mantém o mesmo caminho /sw.js para que clientes com o SW antigo migrem sozinhos.
      filename: 'sw.js',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff,woff2}'],
        cleanupOutdatedCaches: true,
        // SPA: navegações caem no index.html...
        navigateFallback: '/index.html',
        // ...exceto rotas servidas pelo backend/Nginx, que não devem passar pelo SW.
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/, /^\/ws/, /^\/health/],
      },
      // PWA desligado em desenvolvimento para não atrapalhar o HMR.
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    hmr: {
      host: 'localhost',
    },
    watch: {
      usePolling: true,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-select'],
          'vendor-form': ['react-hook-form', '@hookform/resolvers', 'zod'],
          'vendor-charts': ['recharts'],
          'vendor-xlsx': ['xlsx'],
          'vendor-icons': ['lucide-react'],
          'vendor-table': ['@tanstack/react-table'],
        },
      },
    },
  },
})
