import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { getInstitution } from "@/lib/inst";

export default async function TimetablesPage({ params }: PageProps<"/[inst]/timetables">) {
  const { inst: slug } = await params;
  const inst = await getInstitution(slug);
  const versions = await prisma.timetableVersion.findMany({
    where: { institutionId: inst.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true, quality: true, stats: true, createdAt: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timetables</h1>
          <p className="text-muted-foreground">Every saved version, newest first. Each one was clash-checked by the server.</p>
        </div>
        <Link href={`/${slug}/solve`} className={buttonVariants()}>
          Generate new
        </Link>
      </div>
      {versions.length === 0 ? (
        <p className="text-muted-foreground">No timetables yet.</p>
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
                      <Badge variant="secondary">{v.status.toLowerCase()}</Badge>
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
