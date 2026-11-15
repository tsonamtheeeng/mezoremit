// Load .env.local / .env for local runs (Render injects env vars directly). Must be imported first.
import fs from "node:fs";
import path from "node:path";

for (const f of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), f);
  if (fs.existsSync(p)) {
    try {
      process.loadEnvFile(p); // does not override variables that are already set
    } catch {
      /* older Node: ignore */
    }
  }
}
