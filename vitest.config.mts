import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    testTimeout: 30000,
    // Mezo Passport ships extensionless ESM imports; let Vite resolve them instead of Node.
    server: { deps: { inline: [/@mezo-org\//] } },
  },
});
