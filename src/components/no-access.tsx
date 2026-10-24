import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { AccessDenied } from "@/lib/access";

/** Shown instead of a page the visitor may not see. */
export function NoAccess({ reason, next }: { reason: AccessDenied["denied"]; next: string }) {
  const text = {
    signin: "Sign in to see this college.",
    member: "You aren't a member of this college. Ask its admin for an invite link.",
    role: "Your role doesn't include this page.",
  }[reason];
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <Lock className="size-6 text-muted-foreground" />
      <p className="text-lg font-medium">{text}</p>
      {reason === "signin" ? (
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className={buttonVariants()}>
          Sign in
        </Link>
      ) : (
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Go to my colleges
        </Link>
      )}
    </div>
  );
}
