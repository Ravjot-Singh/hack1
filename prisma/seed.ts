// Seeds the fixed "demo" institute used by the landing page and README.
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { demoCollege } from "../src/lib/demo/demo-college";
import { createInstitute } from "../src/lib/institute";

async function main() {
  await prisma.institution.deleteMany({ where: { slug: "demo" } });
  const id = await createInstitute(demoCollege("demo-"), "demo", true);
  console.log(`Seeded demo institute ${id} at /demo`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
