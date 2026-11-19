import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Dev: `npm run dev:web` serves the homepage on :5173 (app at /app/) and proxies /api to the Nightshift server (:4100).
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { proxy: { "/api": { target: `http://localhost:${process.env.NIGHTSHIFT_PORT || 4100}`, changeOrigin: true } } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    // Two pages: the marketing homepage at / and the application at /app/.
    rolldownOptions: {
      input: {
        home: fileURLToPath(new URL("./index.html", import.meta.url)),
        app: fileURLToPath(new URL("./app/index.html", import.meta.url)),
      },
    },
  },
});
