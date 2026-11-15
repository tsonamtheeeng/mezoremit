import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules, not bundled (local fallback DB).
  serverExternalPackages: ["@electric-sql/pglite"],
  // Mezo Passport + OrangeKit (Bitcoin wallets via Mezo smart accounts) ship untranspiled ESM.
  transpilePackages: ["@mezo-org/passport", "@mezo-org/orangekit", "@mezo-org/orangekit-smart-account", "@mezo-org/orangekit-contracts"],
  turbopack: {
    // @coinbase/cdp-sdk (via wagmi connectors) lazily imports x402 packages that this app never uses.
    resolveAlias: {
      "@x402/core/client": "./lib/stubs/empty-module.js",
      "@x402/evm": "./lib/stubs/empty-module.js",
      "@x402/evm/exact/client": "./lib/stubs/empty-module.js",
      "@x402/evm/upto/client": "./lib/stubs/empty-module.js",
      "@x402/svm/exact/client": "./lib/stubs/empty-module.js",
    },
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
