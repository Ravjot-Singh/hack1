// Writes the demo college as importable CSV files to public/samples/ (filled-in examples
// linked from the import dialog).  Run: npx tsx scripts/export-demo-csv.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { demoCollege } from "../src/lib/demo/demo-college";
import { fromInstituteInput, lookupsOf } from "../src/lib/setup/convert";
import { exportTable, toCsv, type Entity } from "../src/lib/setup/import";

const ENTITIES: Entity[] = ["departments", "buildings", "rooms", "teachers", "programs", "sections", "subjects", "allocation"];
const data = fromInstituteInput(demoCollege());
const lookups = lookupsOf(data);
mkdirSync("public/samples", { recursive: true });
for (const entity of ENTITIES) {
  const table = exportTable(entity, data, lookups);
  // Grid names are specific to the demo; blank = the importing college's first grid.
  if (entity === "sections") {
    const col = table[0].indexOf("time_grid");
    for (const row of table.slice(1)) row[col] = "";
  }
  writeFileSync(`public/samples/${entity}.csv`, "﻿" + toCsv(table) + "\n");
  console.log(`public/samples/${entity}.csv  (${table.length - 1} rows)`);
}
