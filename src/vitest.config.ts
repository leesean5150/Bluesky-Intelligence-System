import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    // Root set to repo root so test paths and CLI filters resolve consistently
    // whether running locally (src/../ = repo root) or in Docker (app/../ = /)
    root: path.resolve(__dirname, ".."),
    include: ["tests/**/*.test.ts"],
    setupFiles: [path.resolve(__dirname, "./vitest.setup.ts")],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
})
