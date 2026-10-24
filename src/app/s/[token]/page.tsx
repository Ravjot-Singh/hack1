import { Suspense } from "react";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/page-skeleton";
import { SharedTimetable } from "@/components/timetable/shared-timetable";
import { getShared } from "@/lib/share";

export const metadata: Metadata = {
  title: "Shared timetable · Scheduling Optimizer",
  // Share links are meant for a college's own students and staff, not search engines.
  robots: { index: false, follow: false },
};

export default function SharedPage({ params }: PageProps<"/s/[token]">) {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-6 print:max-w-none print:p-0">
      <Link href="/" className="flex items-center gap-2 text-sm font-medium text-muted-foreground print:hidden">
        <CalendarRange className="size-4" /> Scheduling Optimizer
      </Link>
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Shared params={params} />
      </Suspense>
    </main>
  );
}

async function Shared({ params }: Pick<PageProps<"/s/[token]">, "params">) {
  const { token } = await params;
  const s = await getShared(token);
  if (!s.version) {
    return (
      <div>
        <div className="text-sm text-muted-foreground">{s.collegeName}</div>
        <h1 className="text-2xl font-semibold tracking-tight">No timetable published yet</h1>
        <p className="text-muted-foreground">This link will show the timetable as soon as the college publishes one.</p>
      </div>
    );
  }
  const v = s.version;
  return (
    <>
      <div className="print:hidden">
        <div className="text-sm text-muted-foreground">{s.collegeName}</div>
        <h1 className="text-2xl font-semibold tracking-tight">{v.title}</h1>
        <p className="text-sm text-muted-foreground">
          {s.follows ? "Latest published timetable" : v.name} · updated{" "}
          {v.updatedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      </div>
      <SharedTimetable snapshot={v.snapshot} assignment={v.assignment} title={v.name} fixed={v.fixed} />
    </>
  );
}
