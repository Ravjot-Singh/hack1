"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Circle, Loader2, MessageSquareWarning, Send, Undo2, Upload } from "lucide-react";
import { publish, returnToDraft, signOff, submitForReview } from "@/app/[inst]/timetables/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Dept {
  id: string;
  name: string;
  code: string;
  signoff: { status: "APPROVED" | "CHANGES_REQUESTED"; comment: string | null; by: string; at: string } | null;
}

interface Props {
  slug: string;
  versionId: string;
  status: string;
  departments: Dept[];
  /** The viewer's department when they are an HOD. */
  myDepartment: string | null;
  can: { submit: boolean; signoff: boolean; publish: boolean };
}

const STAGES = [
  { key: "DRAFT", label: "Draft" },
  { key: "REVIEW", label: "HOD review" },
  { key: "APPROVED", label: "Approved" },
  { key: "PUBLISHED", label: "Published" },
];

/** Draft → HOD review → approved → published, with the actions the viewer's role allows. */
export function WorkflowPanel({ slug, versionId, status, departments, myDepartment, can }: Props) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stage = STAGES.findIndex((s) => s.key === status);
  const mine = departments.find((d) => d.id === myDepartment);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else {
        setComment("");
        router.refresh();
      }
    });

  const requested = departments.filter((d) => d.signoff?.status === "CHANGES_REQUESTED");

  return (
    <section className="space-y-3 rounded-lg border p-4 print:hidden">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {STAGES.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            {status === "ARCHIVED" || i < stage || status === "PUBLISHED" ? (
              <CheckCircle2 className="size-4 text-emerald-600" />
            ) : i === stage ? (
              <Circle className="size-4 fill-primary text-primary" />
            ) : (
              <Circle className="size-4 text-muted-foreground" />
            )}
            <span className={cn(i === stage ? "font-medium" : "text-muted-foreground")}>{s.label}</span>
            {i < STAGES.length - 1 && <span className="text-muted-foreground">→</span>}
          </li>
        ))}
        {status === "ARCHIVED" && <li className="text-muted-foreground">(archived: a newer timetable was published)</li>}
      </ol>

      {departments.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((d) => (
            <li key={d.id} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{d.code}</span>
                <span
                  className={cn(
                    "text-xs",
                    d.signoff?.status === "APPROVED" && "text-emerald-700 dark:text-emerald-400",
                    d.signoff?.status === "CHANGES_REQUESTED" && "text-amber-700 dark:text-amber-400",
                    !d.signoff && "text-muted-foreground",
                  )}
                >
                  {d.signoff?.status === "APPROVED" ? "Approved" : d.signoff?.status === "CHANGES_REQUESTED" ? "Changes requested" : "Waiting"}
                </span>
              </div>
              {d.signoff && (
                <div className="text-xs text-muted-foreground">
                  {d.signoff.by}
                  {d.signoff.comment && <span className="block text-foreground">“{d.signoff.comment}”</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {departments.length === 0 && status === "DRAFT" && (
        <p className="text-xs text-muted-foreground">No HODs have been invited, so sending for review makes it ready to publish straight away.</p>
      )}

      {status === "DRAFT" && requested.length > 0 && (
        <p className="flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300">
          <MessageSquareWarning className="mt-0.5 size-4 shrink-0" /> {requested.map((d) => d.code).join(", ")} asked for changes. Edit by
          hand or generate a new draft, then send it for review again.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        {can.submit && status === "DRAFT" && (
          <Button size="sm" disabled={pending} onClick={() => run(() => submitForReview(slug, versionId))}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />} Send for review
          </Button>
        )}
        {can.submit && (status === "REVIEW" || status === "APPROVED") && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => returnToDraft(slug, versionId))}>
            <Undo2 /> Back to draft
          </Button>
        )}
        {can.signoff && status === "REVIEW" && mine && (
          <div className="flex w-full flex-wrap items-end gap-2">
            <label className="min-w-64 flex-1 text-sm">
              <span className="text-muted-foreground">Your review for {mine.name}</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Optional comment; required when asking for changes"
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <Button size="sm" disabled={pending} onClick={() => run(() => signOff(slug, versionId, "APPROVED", comment))}>
              <Check /> Approve {mine.code}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => signOff(slug, versionId, "CHANGES_REQUESTED", comment))}>
              Request changes
            </Button>
          </div>
        )}
        {can.publish && status === "APPROVED" && (
          <Button size="sm" disabled={pending} onClick={() => run(() => publish(slug, versionId))}>
            {pending ? <Loader2 className="animate-spin" /> : <Upload />} Publish to everyone
          </Button>
        )}
        {status === "APPROVED" && !can.publish && <p className="text-sm text-muted-foreground">Waiting for the Head of Institute to publish.</p>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
