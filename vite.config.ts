/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build`             → dist/ (multi-file static site, works offline)
// `npm run build:standalone`  → dist-standalone/index.html (one self-contained file)
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "standalone" ? [viteSingleFile()] : [])],
  base: "./",
  build: {
    outDir: mode === "standalone" ? "dist-standalone" : "dist",
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  worker: { format: "iife" },
  test: {
    include: ["tests/{physiology,simulation,ecg}/**/*.test.ts"],
    testTimeout: 120000,
    pool: "forks",
    fileParallelism: false,
    setupFiles: ["tests/helpers/yield.ts"],
  },
}));
