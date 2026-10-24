import { Suspense } from "react";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { googleEnabled } from "@/lib/auth";

export const metadata = { title: "Create account · Scheduling Optimizer" };

export default function SignUpPage() {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 space-y-6 px-4 py-16">
      <Link href="/" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <CalendarRange className="size-4" /> Scheduling Optimizer
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">One account works for every college you belong to.</p>
      </div>
      <Suspense>
        <AuthForm mode="sign-up" google={googleEnabled} />
      </Suspense>
    </main>
  );
}
