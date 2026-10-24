import { Suspense } from "react";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { AcceptInvite } from "@/components/accept-invite";
import { buttonVariants } from "@/components/ui/button";
import { getUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { ROLE_HELP, ROLE_LABEL } from "@/lib/permissions";

export const metadata = { title: "Join a college · Scheduling Optimizer", robots: { index: false, follow: false } };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-16">
      <Link href="/" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <CalendarRange className="size-4" /> Scheduling Optimizer
      </Link>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-muted" />}>
        <Invite params={params} />
      </Suspense>
    </main>
  );
}

async function Invite({ params }: Pick<PageProps<"/invite/[token]">, "params">) {
  const { token } = await params;
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { institution: { select: { name: true } }, department: { select: { name: true } } },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">This invite can&apos;t be used</h1>
        <p className="text-muted-foreground">It has expired, was already used, or was withdrawn. Ask your college admin for a new link.</p>
      </div>
    );
  }
  const user = await getUser();
  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">You&apos;ve been invited to</p>
        <h1 className="text-2xl font-semibold tracking-tight">{invite.institution.name}</h1>
        <p className="mt-2">
          as <span className="font-medium">{ROLE_LABEL[invite.role]}</span>
          {invite.department && <> of {invite.department.name}</>}
        </p>
        <p className="text-sm text-muted-foreground">{ROLE_HELP[invite.role]}</p>
      </div>
      {user ? (
        <AcceptInvite token={token} userName={user.name} />
      ) : (
        <div className="flex flex-col gap-2">
          <Link href={`/sign-up?next=${next}`} className={buttonVariants()}>
            Create an account to join
          </Link>
          <Link href={`/sign-in?next=${next}`} className={buttonVariants({ variant: "outline" })}>
            I already have an account
          </Link>
        </div>
      )}
    </div>
  );
}
