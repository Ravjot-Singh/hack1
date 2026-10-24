import { Suspense } from "react";
import { NoAccess } from "@/components/no-access";
import { checkPage } from "@/lib/access";
import { loadInstituteInput } from "@/lib/institute";
import { PageSkeleton } from "@/components/page-skeleton";
import { SolvePanel } from "@/components/solve-panel";

export default function SolvePage({ params }: PageProps<"/[inst]/solve">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Generate timetable</h1>
        <p className="text-muted-foreground">
          One solve for the whole institute, so shared rooms and labs are split fairly between departments. It runs in
          your browser, and the server checks every rule again before saving.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton />}>
        <Solve params={params} />
      </Suspense>
    </div>
  );
}

async function Solve({ params }: Pick<PageProps<"/[inst]/solve">, "params">) {
  const { inst: slug } = await params;
  const access = await checkPage(slug, "timetable.generate");
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/solve`} />;
  const input = await loadInstituteInput(access.inst.id);
  return <SolvePanel slug={slug} input={input} canSave={!access.publicDemo} />;
}
