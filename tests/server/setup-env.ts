// Imported FIRST by every server test: lib/chain/config reads addresses at module load.
process.env.NEXT_PUBLIC_MANAGER_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.NEXT_PUBLIC_DEPLOY_BLOCK = "1";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef0123456789";
process.env.PROVIDER_WEBHOOK_SECRET_SANDBOX = "test-sandbox-webhook-secret-0123456789";
process.env.CONFIRMATIONS = "0";
process.env.REORG_WINDOW = "5";
delete process.env.DATABASE_URL;
delete process.env.RELAYER_PRIVATE_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;
delete process.env.RECIPIENT_DATA_KEY;
// Boot the in-memory PGlite + schema during import (no hook timeout applies here).
const { getDb } = await import("@/lib/server/db");
await getDb();
export {};
