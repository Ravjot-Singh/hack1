"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { markAllRead } from "@/app/[inst]/notifications/actions";
import { Button } from "@/components/ui/button";

/** Marks notifications read once the list has been seen (and offers a manual button). */
export function MarkRead({ slug, unread }: { slug: string; unread: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const mark = () =>
    start(async () => {
      await markAllRead(slug);
      router.refresh();
    });
  useEffect(() => {
    if (unread) mark();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);
  if (!unread) return null;
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={mark}>
      <CheckCheck /> Mark all as read
    </Button>
  );
}
