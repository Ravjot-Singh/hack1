// Run a command against the production (Neon) database:
//   node scripts/with-prod-db.mjs npx prisma migrate deploy
// Copies PROD_DB_URL from .env into DATABASE_URL for that one command only.
import "dotenv/config";
import { spawnSync } from "node:child_process";

if (!process.env.PROD_DB_URL) {
  console.error("PROD_DB_URL is not set in .env");
  process.exit(1);
}
const [cmd, ...args] = process.argv.slice(2);
const result = spawnSync(cmd, args, {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: process.env.PROD_DB_URL },
});
process.exit(result.status ?? 1);
