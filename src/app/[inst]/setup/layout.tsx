import { Suspense } from "react";
import { Lock } from "lucide-react";
import { createDemoCopy } from "@/app/actions";
import { StepRail } from "@/components/setup/step-rail";
import { Button } from "@/components/ui/button";
import { checkPage, getAccess } from "@/lib/access";
import { getSetup } from "@/lib/setup/load";
import { stepCounts } from "@/lib/setup/steps";

export default function SetupLayout({ children, params }: LayoutProps<"/[inst]/setup">) {
  return (
    <div className="space-y-4">
      <Suspense>
        <ReadOnlyBanner params={params} />
      </Suspense>
      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <Suspense fallback={<div className="hidden h-96 animate-pulse rounded-lg bg-muted lg:block" />}>
          <Rail params={params} />
        </Suspense>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

async function Rail({ params }: Pick<LayoutProps<"/[inst]/setup">, "params">) {
  const { inst: slug } = await params;
  const access = await checkPage(slug, "setup.view");
  if ("denied" in access) return null;
  return <StepRail counts={stepCounts(await getSetup(access.inst.id))} />;
}

async function ReadOnlyBanner({ params }: Pick<LayoutProps<"/[inst]/setup">, "params">) {
  const { inst: slug } = await params;
  if (!(await getAccess(slug)).publicDemo) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <Lock className="size-4 shrink-0" />
      <span className="flex-1">
        This is the shared demo, so it&apos;s read-only. Make your own copy to edit the data, import files and try changes.
      </span>
      <form action={createDemoCopy}>
        <Button size="sm" type="submit">
          Make my own copy
        </Button>
      </form>
    </div>
  );
}
