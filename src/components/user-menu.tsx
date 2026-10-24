import Link from "next/link";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { getUser } from "@/lib/access";

/** Signed-in user's name with Sign out, or Sign in for visitors. */
export async function UserMenu({ next = "/" }: { next?: string }) {
  const user = await getUser();
  if (!user) {
    return (
      <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
        Sign in
      </Link>
    );
  }
  return (
    <form action={signOut} className="flex items-center gap-2 text-sm">
      <span className="hidden max-w-40 truncate text-muted-foreground sm:inline" title={user.email}>
        {user.name}
      </span>
      <Button type="submit" size="sm" variant="ghost" aria-label="Sign out" title="Sign out">
        <LogOut />
      </Button>
    </form>
  );
}
