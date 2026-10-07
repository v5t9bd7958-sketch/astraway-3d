import { defineConfig } from "vite";

export default defineConfig({
  base: "/astraway-3d/",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
  },
  server: {
    host: true,
    port: 5173,
  },
});
