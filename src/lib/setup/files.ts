// Browser-only helpers for reading and downloading spreadsheet files.
import { parseCsv, toCsv } from "./import";

function cellToString(c: unknown): string {
  if (c == null) return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  if (typeof c === "boolean") return c ? "yes" : "no";
  return String(c).trim();
}

/** Read a .csv or .xlsx file into a table of strings (first sheet for Excel). */
export async function readTable(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    const data = await readSheet(file);
    return data.map((row) => row.map(cellToString));
  }
  if (/\.xls$/i.test(file.name)) {
    throw new Error("Old .xls files aren't supported. In Excel use File → Save As → Excel Workbook (.xlsx) or CSV.");
  }
  return parseCsv(await file.text());
}

export function downloadCsv(filename: string, table: string[][]) {
  // BOM so Excel opens UTF-8 names (e.g. "Café", Hindi/Punjabi names) correctly.
  const blob = new Blob(["﻿" + toCsv(table)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
