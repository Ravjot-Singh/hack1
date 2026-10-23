"use server";

import { redirect } from "next/navigation";
import { demoCollege } from "@/lib/demo/demo-college";
import { createInstitute } from "@/lib/institute";

/** Give a visitor their own copy of the demo college to experiment with. */
export async function createDemoCopy() {
  const slug = `demo-${Math.random().toString(36).slice(2, 8)}`;
  await createInstitute({ ...demoCollege(`${slug}-`), name: "Demo Institute of Technology (your copy)" }, slug, true);
  redirect(`/${slug}`);
}
