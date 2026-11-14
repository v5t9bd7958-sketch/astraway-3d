import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "/astraway-3d/",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        terrainTest: resolve(process.cwd(), "terrain-test.html"),
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});