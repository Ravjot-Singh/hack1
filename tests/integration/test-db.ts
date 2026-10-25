/**
 * The integration test database: TEST_DATABASE_URL, or DATABASE_URL with "_test" appended to
 * the database name. Anything not ending in "_test" is refused, so a run can never wipe real data.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL;
  if (!base) throw new Error("Set DATABASE_URL (or TEST_DATABASE_URL) to run integration tests.");
  const url = new URL(base);
  if (!explicit) url.pathname = `${url.pathname.replace(/\/$/, "")}_test`;
  const name = url.pathname.slice(1);
  if (!name.endsWith("_test")) throw new Error(`Refusing to use database "${name}" for tests: its name must end in "_test".`);
  return url.toString();
}
