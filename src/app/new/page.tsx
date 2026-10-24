import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { NewCollegeForm } from "./new-college-form";

export const metadata = { title: "Set up your college · Scheduling Optimizer" };

export default function NewCollegePage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-10">
      <Link href="/" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <CalendarRange className="size-4" /> Scheduling Optimizer
      </Link>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Set up your college</h1>
        <p className="mt-1 text-muted-foreground">
          Start with your week and bell schedule. Next you&apos;ll add departments, rooms, teachers, sections and subjects,
          typed in or imported from Excel.
        </p>
      </div>
      <NewCollegeForm />
    </main>
  );
}
