import { Suspense } from "react";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { googleEnabled } from "@/lib/auth";

export const metadata = { title: "Sign in · Scheduling Optimizer" };

export default function SignInPage() {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 space-y-6 px-4 py-16">
      <Link href="/" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <CalendarRange className="size-4" /> Scheduling Optimizer
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <Suspense>
        <AuthForm mode="sign-in" google={googleEnabled} />
      </Suspense>
    </main>
  );
}
