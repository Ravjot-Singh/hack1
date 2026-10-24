import { cn } from "@/lib/utils";

const STYLE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-muted text-muted-foreground" },
  REVIEW: { label: "In review", className: "bg-sky-500/15 text-sky-800 dark:text-sky-300" },
  APPROVED: { label: "Approved", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  PUBLISHED: { label: "Published", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  ARCHIVED: { label: "Archived", className: "bg-muted text-muted-foreground line-through" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STYLE[status] ?? STYLE.DRAFT;
  return <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", s.className)}>{s.label}</span>;
}
