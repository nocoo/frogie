import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  server: {
    port: 7033,
    host: true,
    // Add custom hosts via VITE_ALLOWED_HOSTS env var (comma-separated)
    allowedHosts: process.env['VITE_ALLOWED_HOSTS']?.split(',').filter(Boolean) ?? [],
    proxy: {
      '/api': {
        target: 'http://localhost:7034',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:7034',
        ws: true,
      },
    },
  },
})
