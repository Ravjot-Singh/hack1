import { expect, test } from "@playwright/test";
import { noPageErrors } from "./helpers";

test.describe("public pages", () => {
  test("landing page offers a new college and the demo", async ({ page }) => {
    await noPageErrors(page, async () => {
      await page.goto("/");
      await expect(page.getByRole("link", { name: "Set up your college" })).toBeVisible();
      await expect(page.getByRole("link", { name: /demo/i }).first()).toBeVisible();
    });
  });

  test("the shared demo shows its timetable to anyone", async ({ page }) => {
    await noPageErrors(page, async () => {
      await page.goto("/demo/timetables");
      const first = page.locator('a[href^="/demo/timetables/"]').first();
      await expect(first).toBeVisible();
      await first.click();
      // The week grid shows lessons (subject code, teacher, room) for the first section.
      // (The page also has a phone-only list, hidden on desktop.)
      await expect(page.locator(".lesson-card:visible").first()).toBeVisible();
    });
  });

  test("the demo's Generate runs the solver in the browser with 0 clashes", async ({ page }) => {
    await noPageErrors(page, async () => {
      await page.goto("/demo/solve");
      await page.getByRole("button", { name: "Generate timetable" }).click();
      await expect(page.getByText("0 clashes")).toBeVisible({ timeout: 60_000 });
      // Read-only demo: nothing can be saved.
      await expect(page.getByRole("button", { name: /Save as draft/ })).toHaveCount(0);
    });
  });

  test("an unknown college shows the not-found page", async ({ page }) => {
    // The college is looked up inside a streamed section, so Next.js sends the 404 page with
    // HTTP 200 plus a noindex tag (a "soft 404"); the visitor still sees "not found".
    await page.goto("/no-such-college-xyz");
    await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
    expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBeGreaterThan(0);
  });
});
