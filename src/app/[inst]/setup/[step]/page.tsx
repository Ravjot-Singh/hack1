import { Suspense } from "react";
import { notFound } from "next/navigation";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { StepView } from "@/components/setup/step-view";
import { checkPage } from "@/lib/access";
import { getSetup } from "@/lib/setup/load";
import { DEPARTMENT_STEPS, isStep } from "@/lib/setup/steps";

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
  const access = await checkPage(slug, "setup.view");
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/setup/${step}`} />;
  const data = await getSetup(access.inst.id);
  const departmentStep = DEPARTMENT_STEPS.includes(step);
  const readOnly = !access.can(departmentStep ? "setup.department" : "setup.institute");
  // HODs see and edit only their own department's rows on department steps.
  const scope = access.member?.role === "HOD" ? access.member.departmentId : null;
  const note = access.publicDemo
    ? null
    : readOnly
      ? "Only the Institute Admin can change this step."
      : scope && departmentStep
        ? `You're editing ${data.departments.find((d) => d.id === scope)?.name ?? "your department"} only.`
        : null;
  return <StepView step={step} slug={slug} data={data} readOnly={readOnly} scope={scope} note={note} />;
}
