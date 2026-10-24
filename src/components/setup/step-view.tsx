"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { SetupData } from "@/lib/setup/convert";
import { STEPS, type StepSlug } from "@/lib/setup/steps";
import { AllocationStep } from "./steps/allocation-step";
import { GridsStep } from "./steps/grids-step";
import { InstituteStep } from "./steps/institute-step";
import { ReviewStep } from "./steps/review-step";
import { RulesStep } from "./steps/rules-step";
import { DepartmentsStep, RoomsStep, SectionsStep, SubjectsStep, TeachersStep } from "./steps/table-steps";

export interface StepProps {
  slug: string;
  data: SetupData;
  readOnly: boolean;
}

const VIEWS: Record<StepSlug, (p: StepProps) => React.ReactNode> = {
  institute: InstituteStep,
  grids: GridsStep,
  departments: DepartmentsStep,
  rooms: RoomsStep,
  teachers: TeachersStep,
  sections: SectionsStep,
  subjects: SubjectsStep,
  allocation: AllocationStep,
  rules: RulesStep,
  review: ReviewStep,
};

export function StepView({ step, ...props }: StepProps & { step: StepSlug }) {
  const i = STEPS.findIndex((s) => s.slug === step);
  const meta = STEPS[i];
  const next = STEPS[i + 1];
  const View = VIEWS[step];
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium text-muted-foreground">
          Step {i + 1} of {STEPS.length}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{meta.title}</h1>
        <p className="text-muted-foreground">{meta.help}</p>
      </div>
      <View {...props} />
      {next && (
        <div className="flex justify-end border-t pt-4">
          <Link href={`/${props.slug}/setup/${next.slug}`} className={buttonVariants({ variant: "outline" })}>
            Next: {next.title} <ArrowRight />
          </Link>
        </div>
      )}
    </div>
  );
}
