import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    environmentMatchGlobs: [
      // Use jsdom only for React component tests
      ["src/components/**", "jsdom"],
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
