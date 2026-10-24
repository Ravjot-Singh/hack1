import { Suspense } from "react";
import Link from "next/link";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { StatusBadge } from "@/components/timetable/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { checkPage } from "@/lib/access";
import { prisma } from "@/lib/db";

async function TimetablesPageContent({ params }: Pick<PageProps<"/[inst]/timetables">, "params">) {
  const { inst: slug } = await params;
  const access = await checkPage(slug);
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/timetables`} />;
  const drafts = access.can("timetable.viewDrafts");
  const versions = await prisma.timetableVersion.findMany({
    // Teachers, students and other roles see published and archived timetables only.
    where: { institutionId: access.inst.id, ...(drafts ? {} : { status: { in: ["PUBLISHED", "ARCHIVED"] } }) },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true, quality: true, stats: true, createdAt: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timetables</h1>
          <p className="text-muted-foreground">
            {drafts
              ? "Every saved version, newest first. Each one was clash-checked by the server."
              : "The published timetable, and earlier ones that it replaced."}
          </p>
        </div>
        {access.can("timetable.generate") && (
          <Link href={`/${slug}/solve`} className={buttonVariants()}>
            Generate new
          </Link>
        )}
      </div>
      {versions.length === 0 ? (
        <p className="text-muted-foreground">{drafts ? "No timetables yet." : "Nothing has been published yet."}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {versions.map((v) => {
            const stats = v.stats as { unscheduled?: number; lessons?: number };
            return (
              <Link key={v.id} href={`/${slug}/timetables/${v.id}`}>
                <Card className="transition-colors hover:bg-muted/40">
                  <CardContent className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{v.name}</span>
                      <StatusBadge status={v.status} />
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Quality {v.quality}/100 · {(stats.lessons ?? 0) - (stats.unscheduled ?? 0)}/{stats.lessons ?? 0} classes
                    </div>
                    <div className="text-xs text-muted-foreground">{v.createdAt.toLocaleString("en-IN")}</div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Data streams in under a Suspense boundary so navigation between pages is instant.
export default function TimetablesPage({ params }: PageProps<"/[inst]/timetables">) {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <TimetablesPageContent params={params} />
    </Suspense>
  );
}
