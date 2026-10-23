import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Falls back to a placeholder so `prisma generate` works before .env exists.
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://user:pass@localhost:5432/placeholder" },
});
