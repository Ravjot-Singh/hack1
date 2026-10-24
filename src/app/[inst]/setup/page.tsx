import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { PageSkeleton } from "@/components/page-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { getInstitution } from "@/lib/inst";
import { getSetup } from "@/lib/setup/load";
import { STEPS, stepCounts } from "@/lib/setup/steps";

export default function SetupIndex({ params }: PageProps<"/[inst]/setup">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Set up your college</h1>
        <p className="text-muted-foreground">
          Go through the steps in order. Each list can be typed in or imported from a CSV or Excel file. You can come
          back and change anything later.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton />}>
        <Steps params={params} />
      </Suspense>
    </div>
  );
}

async function Steps({ params }: Pick<PageProps<"/[inst]/setup">, "params">) {
  const { inst: slug } = await params;
  const inst = await getInstitution(slug);
  const counts = stepCounts(await getSetup(inst.id));
  const next = STEPS.find((s) => counts[s.slug] === 0) ?? STEPS[0];
  return (
    <div className="space-y-4">
      <ol className="grid gap-2 sm:grid-cols-2">
        {STEPS.map((s, i) => {
          const n = counts[s.slug];
          const done = n === undefined ? false : n > 0;
          return (
            <li key={s.slug}>
              <Link href={`/${slug}/setup/${s.slug}`} className="flex gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40">
                {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0">
                  <span className="font-medium">
                    {i + 1}. {s.title}
                  </span>
                  {n !== undefined && <span className="ml-2 text-xs text-muted-foreground">{n} added</span>}
                  <span className="block text-sm text-muted-foreground">{s.help}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <Link href={`/${slug}/setup/${next.slug}`} className={buttonVariants()}>
        Continue with {next.title} <ArrowRight />
      </Link>
    </div>
  );
}
