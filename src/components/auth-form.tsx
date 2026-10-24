"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { signIn, signUp } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode, google }: { mode: "sign-in" | "sign-up"; google: boolean }) {
  const next = useSearchParams().get("next") ?? "/";
  const [state, action, pending] = useActionState(mode === "sign-in" ? signIn : signUp, undefined);
  const other = mode === "sign-in" ? "sign-up" : "sign-in";

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        {mode === "sign-up" && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Your name</Label>
            <Input id="name" name="name" autoComplete="name" required defaultValue={state?.name} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          />
          {mode === "sign-up" && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
        </div>
        {state?.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} {mode === "sign-in" ? "Sign in" : "Create account"}
        </Button>
      </form>

      {google && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}
        >
          Continue with Google
        </Button>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {mode === "sign-in" ? "New here? " : "Already have an account? "}
        <Link href={`/${other}?next=${encodeURIComponent(next)}`} className="font-medium text-foreground underline-offset-2 hover:underline">
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </div>
  );
}
