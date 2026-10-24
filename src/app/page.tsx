import Link from "next/link";
import { ArrowRight, CalendarRange, Lightbulb, Printer, ShieldCheck, Split, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { createDemoCopy } from "./actions";

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Zero clashes, verified",
    body: "No teacher, room, class or lab batch is ever double-booked. An independent checker re-verifies every timetable before it is saved.",
  },
  {
    icon: Lightbulb,
    title: "Explains what's wrong",
    body: "Instead of 'failed', you get 'Dr. Sharma has 22 hours but the limit is 18', with the fix.",
  },
  {
    icon: Split,
    title: "Built for real colleges",
    body: "L-T-P workloads, lab batches, 3-period lab blocks, open-elective baskets, staggered lunch, half-day Saturdays, walking time between blocks.",
  },
  {
    icon: Users,
    title: "One solve, all departments",
    body: "Shared labs and classrooms are split fairly across departments, and department-owned rooms go to their own classes first.",
  },
  {
    icon: Printer,
    title: "Notice-board ready",
    body: "Section, faculty and room timetables print cleanly on A4 with a subject and faculty key.",
  },
  {
    icon: CalendarRange,
    title: "Works for any college",
    body: "Your own days, bell schedule, departments, rooms and rules. Nothing is hard-coded.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-12 sm:py-20">
      <section className="space-y-6">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CalendarRange className="size-4" /> Scheduling Optimizer
        </div>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Clash-free college timetables in seconds, not weeks.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground text-pretty">
          Enter your sections, teachers, rooms and rules once. Get a timetable for the whole institute that respects
          every constraint, and a plain-English explanation whenever something can&apos;t fit.
        </p>
        <div className="flex flex-wrap gap-3">
          <form action={createDemoCopy}>
            <Button size="lg" type="submit">
              Try it with a sample college <ArrowRight />
            </Button>
          </form>
          <Link href="/new" className={buttonVariants({ size: "lg", variant: "outline" })}>
            Set up your college
          </Link>
          <Link href="/demo" className={buttonVariants({ size: "lg", variant: "ghost" })}>
            View the shared demo
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          The sample has 4 departments, 22 teachers, 10 sections with lab batches, 3 buildings and an open-elective basket.
          You get your own copy to experiment with.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="space-y-2">
            <f.icon className="size-5 text-muted-foreground" />
            <h2 className="font-medium">{f.title}</h2>
            <p className="text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
