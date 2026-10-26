import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("redirect after sign-in", () => {
  it("keeps paths inside the app", () => {
    expect(safeNext("/demo/timetables?x=1")).toBe("/demo/timetables?x=1");
    expect(safeNext("/invite/abc")).toBe("/invite/abc");
  });

  it.each([
    ["https://evil.com"],
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["\\\\evil.com"],
    ["javascript:alert(1)"],
    [""],
    [null],
  ])("sends %j home instead of off the site", (next) => {
    expect(safeNext(next)).toBe("/");
  });
});
