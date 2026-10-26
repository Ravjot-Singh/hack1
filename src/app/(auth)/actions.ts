"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";

export type AuthState = { error?: string; email?: string; name?: string } | undefined;

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(128),
});

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({ name: form.get("name"), email: form.get("email"), password: form.get("password") });
  const echo = { email: String(form.get("email") ?? ""), name: String(form.get("name") ?? "") };
  if (!parsed.success) return { error: parsed.error.issues[0].message, ...echo };
  try {
    await auth.api.signUpEmail({ body: parsed.data, headers: await headers() });
  } catch (e) {
    const msg = e instanceof APIError ? e.message : "Couldn't create the account. Try again.";
    return { error: /exist/i.test(msg) ? "An account with this email already exists. Sign in instead." : msg, ...echo };
  }
  redirect(safeNext(form.get("next")));
}

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch {
    return { error: "Wrong email or password.", email };
  }
  redirect(safeNext(form.get("next")));
}

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}
