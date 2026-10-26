import { z } from "zod";

/**
 * A real calendar date as "YYYY-MM-DD". The format alone isn't enough: JavaScript turns
 * "2026-11-31" into 1 December, so a date check that only looks at the string would compare
 * one day while the database stores another.
 */
export function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const year = Number(s.slice(0, 4));
  if (year < 2000 || year > 2100) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** How far ahead bookings and placement rounds may be planned. */
export const MAX_DAYS_AHEAD = 366;

export const isoDate =(message = "Pick a valid date") => z.string().refine(isRealDate, message);
