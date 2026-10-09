import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 37033,
    strictPort: true,
    allowedHosts: ["frogie.dev.hexly.ai"],
  },
  build: { outDir: "dist" },
});
