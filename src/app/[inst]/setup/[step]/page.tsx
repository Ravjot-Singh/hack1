import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageSkeleton } from "@/components/page-skeleton";
import { StepView } from "@/components/setup/step-view";
import { getInstitution } from "@/lib/inst";
import { getSetup, isReadOnly } from "@/lib/setup/load";
import { isStep } from "@/lib/setup/steps";

export default function SetupStepPage({ params }: PageProps<"/[inst]/setup/[step]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Step params={params} />
    </Suspense>
  );
}

async function Step({ params }: Pick<PageProps<"/[inst]/setup/[step]">, "params">) {
  const { inst: slug, step } = await params;
  if (!isStep(step)) notFound();
  const inst = await getInstitution(slug);
  const data = await getSetup(inst.id);
  return <StepView step={step} slug={slug} data={data} readOnly={isReadOnly(inst)} />;
}
