import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/** The college the dev accounts belong to (`npx tsx scripts/seed-dev-users.ts <slug>`). */
export const SLUG = process.env.E2E_SLUG ?? "test-college-zsmj";

/** The shared dev password, read from the seed script so it isn't copied anywhere else. */
function devPassword(): string {
  if (process.env.E2E_PASSWORD) return process.env.E2E_PASSWORD;
  const m = /DEV_PASSWORD = "([^"]+)"/.exec(readFileSync("scripts/seed-dev-users.ts", "utf8"));
  if (!m) throw new Error("Set E2E_PASSWORD or keep DEV_PASSWORD in scripts/seed-dev-users.ts.");
  return m[1];
}

export async function signIn(page: Page, email: string, next: string) {
  await page.context().clearCookies();
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(devPassword());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => u.pathname === next.split("?")[0], { timeout: 60_000 });
}

/** No uncaught errors in the page while `fn` runs. */
export async function noPageErrors(page: Page, fn: () => Promise<void>) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fn();
  expect(errors).toEqual([]);
}
