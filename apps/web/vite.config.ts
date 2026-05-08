import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
    hmr: {
      port: 3000,
      host: "localhost",
      protocol: "ws"
    },
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true
      },
      "/static": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  }
});