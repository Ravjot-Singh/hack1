import { execSync } from "node:child_process";
import pg from "pg";
import { testDatabaseUrl } from "./test-db";

/**
 * Create the test database if needed and apply migrations (never resets or drops anything).
 * Each run creates its own colleges and users, and teardown removes only those.
 */
export async function setup() {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (!exists.rowCount) await client.query(`CREATE DATABASE "${name.replace(/"/g, "")}"`);
  await client.end();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
}

/** Remove what the tests created: colleges with "it-" slugs and "@it.test" users. */
export async function teardown() {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  await client.query(`DELETE FROM "Institution" WHERE slug LIKE 'it-%'`);
  await client.query(`DELETE FROM "User" WHERE email LIKE '%@it.test'`);
  await client.end();
}
