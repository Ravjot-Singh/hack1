import { Suspense } from "react";
import Link from "next/link";
import { MarkRead } from "@/components/mark-read";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { checkPage } from "@/lib/access";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";

export default function NotificationsPage({ params }: PageProps<"/[inst]/notifications">) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
      <Suspense fallback={<PageSkeleton rows={1} />}>
        <List params={params} />
      </Suspense>
    </div>
  );
}

async function List({ params }: Pick<PageProps<"/[inst]/notifications">, "params">) {
  const { inst: slug } = await params;
  const access = await checkPage(slug);
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/notifications`} />;
  const items = await prisma.notification.findMany({
    where: { userId: access.user!.id, institutionId: access.inst.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  if (!items.length) return <p className="text-muted-foreground">Nothing yet. Substitutions and cancellations that affect you will show up here.</p>;
  return (
    <>
      <MarkRead slug={slug} unread={items.some((n) => !n.readAt)} />
      <ul className="divide-y rounded-lg border">
        {items.map((n) => (
          <li key={n.id} className={cn("flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-sm", !n.readAt && "bg-sky-500/5")}>
            {!n.readAt && <span className="size-2 rounded-full bg-sky-500" aria-label="Unread" />}
            {n.link ? (
              <Link href={n.link} className="flex-1 hover:underline">
                {n.text}
              </Link>
            ) : (
              <span className="flex-1">{n.text}</span>
            )}
            <span className="text-xs text-muted-foreground">{n.createdAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
