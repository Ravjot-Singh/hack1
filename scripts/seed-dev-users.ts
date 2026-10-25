// Development only: creates test accounts (one per role) and makes them members of a college.
//   npx tsx scripts/seed-dev-users.ts <college-slug>
// Every account uses DEV_PASSWORD below. Never run this against production.
import "dotenv/config";
import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/db";

const DEV_PASSWORD = "timetable-dev-123";

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("Usage: npx tsx scripts/seed-dev-users.ts <college-slug>");
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to create dev accounts in production.");
  const inst = await prisma.institution.findUniqueOrThrow({ where: { slug }, include: { departments: true, teachers: true, sections: true } });
  const dept = (code: string) => inst.departments.find((d) => d.code === code)?.id ?? null;
  const teacher = (name: string) => inst.teachers.find((t) => t.name.includes(name))?.id ?? null;
  const section = (name: string) => inst.sections.find((s) => s.name === name)?.id ?? null;

  const accounts = [
    { email: "admin@dev.test", name: "Asha Admin", role: "INSTITUTE_ADMIN" as const },
    { email: "hoi@dev.test", name: "Harjit Principal", role: "HEAD_OF_INSTITUTE" as const },
    { email: "hod.cse@dev.test", name: "Rajesh Kumar", role: "HOD" as const, departmentId: dept("CSE"), teacherId: teacher("Rajesh Kumar") },
    { email: "teacher@dev.test", name: "Anita Desai", role: "TEACHER" as const, teacherId: teacher("Anita Desai") },
    { email: "student@dev.test", name: "Gurleen Student", role: "STUDENT" as const, sectionId: section("CSE-2A") },
    { email: "student3@dev.test", name: "Tanvir Third-year", role: "STUDENT" as const, sectionId: section("CSE-3A") },
    { email: "placement@dev.test", name: "Pallavi Placement", role: "PLACEMENT_OFFICER" as const },
  ];

  for (const a of accounts) {
    let user = await prisma.user.findUnique({ where: { email: a.email } });
    if (!user) {
      await auth.api.signUpEmail({ body: { email: a.email, password: DEV_PASSWORD, name: a.name } });
      user = await prisma.user.findUniqueOrThrow({ where: { email: a.email } });
    }
    const data = {
      role: a.role,
      departmentId: "departmentId" in a ? a.departmentId : null,
      teacherId: "teacherId" in a ? a.teacherId : null,
      sectionId: "sectionId" in a ? a.sectionId : null,
    };
    await prisma.membership.upsert({
      where: { userId_institutionId: { userId: user.id, institutionId: inst.id } },
      create: { userId: user.id, institutionId: inst.id, ...data },
      update: data,
    });
    console.log(`${a.email.padEnd(20)} ${a.role}`);
  }
  console.log(`\nAll accounts use the password defined in scripts/seed-dev-users.ts (college: /${slug}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
