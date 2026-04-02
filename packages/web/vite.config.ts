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
