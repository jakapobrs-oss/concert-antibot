import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest config — unit tests สำหรับ logic หลัก (fairness, anti-bot, behavior)
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
