import { expect, test } from "@playwright/test";
import { noPageErrors, signIn, SLUG } from "./helpers";

// Needs the dev accounts: npx tsx scripts/seed-dev-users.ts <slug>
test.describe("signed-in roles", () => {
  test("admin sees every management page", async ({ page }) => {
    await signIn(page, "admin@dev.test", `/${SLUG}`);
    const nav = page.getByRole("navigation").or(page.locator("header"));
    for (const name of ["Setup", "Generate", "Venues", "Labs", "Electives", "People"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    await noPageErrors(page, async () => {
      for (const path of ["setup/rules", "venues", "labs", "electives", "placements", "insights", "absences", "calendar", "people"]) {
        const res = await page.goto(`/${SLUG}/${path}`);
        expect(res?.status(), path).toBe(200);
        await expect(page.getByText("Your role doesn't include this page.")).toHaveCount(0);
      }
    });
  });

  test("a student is kept out of management pages but can use their own", async ({ page }) => {
    await signIn(page, "student@dev.test", `/${SLUG}/today`);
    for (const path of ["setup", "venues", "labs", "people"]) {
      await page.goto(`/${SLUG}/${path}`);
      await expect(page.getByText(/Your role doesn't include this page|don't have access|not allowed/i).first(), path).toBeVisible();
    }
    for (const path of ["today", "me", "appointments", "electives", "placements"]) {
      await page.goto(`/${SLUG}/${path}`);
      await expect(page.getByText("Your role doesn't include this page.")).toHaveCount(0);
    }
  });

  test("a teacher's Today view shows their classes for a date", async ({ page }) => {
    await signIn(page, "teacher@dev.test", `/${SLUG}/today`);
    await page.goto(`/${SLUG}/today?date=2026-11-03`);
    await expect(page.getByRole("heading", { name: /3 November/ })).toBeVisible();
    await expect(page.locator(".lesson-card").first()).toBeVisible();
  });

  test("plain-English rule: read by the built-in reader and confirmed", async ({ page }) => {
    await signIn(page, "admin@dev.test", `/${SLUG}/setup/rules`);
    await page.getByLabel("New rule").fill("No labs on Saturday");
    await page.getByRole("button", { name: "Read rule" }).click();
    await expect(page.getByText("Built-in reader", { exact: true })).toBeVisible();
    await expect(page.getByText("Labs: never on Sat")).toBeVisible();
    // Not saved: leave the college's rules as they are.
    await page.getByRole("button", { name: "Not what I meant" }).click();
  });

  test("venue grid: a class slot can't be booked by a teacher", async ({ page }) => {
    await signIn(page, "teacher@dev.test", `/${SLUG}/venues?date=2026-11-03`);
    const cls = page.getByRole("button", { name: /: Class: / }).first();
    await cls.click();
    await expect(page.getByText(/Only the Head of Institute can book over classes/)).toBeVisible();
  });
});
