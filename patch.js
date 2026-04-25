const fs = require('fs');
const file = '/Users/tanxiao/Desktop/trae/自媒体/apps/web/vite.config.ts';
const content = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
});`;
fs.writeFileSync(file, content);
console.log('hmr patched');
