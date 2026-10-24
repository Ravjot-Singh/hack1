"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { STEPS, type StepSlug } from "@/lib/setup/steps";
import { cn } from "@/lib/utils";

/** Wizard step list: vertical on desktop, horizontal scroller on phones. */
export function StepRail({ counts }: { counts: Partial<Record<StepSlug, number>> }) {
  const path = usePathname();
  const [, slug] = path.split("/");
  const current = path.split("/")[3];
  return (
    <nav aria-label="Setup steps" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ol className="flex gap-1 lg:sticky lg:top-4 lg:flex-col">
        {STEPS.map((s, i) => {
          const active = current === s.slug;
          const count = counts[s.slug];
          return (
            <li key={s.slug} className="shrink-0">
              <Link
                href={`/${slug}/setup/${s.slug}`}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-muted",
                  active ? "bg-muted font-medium" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border text-[11px] tabular-nums",
                    active && "border-foreground",
                    count ? "bg-foreground text-background" : "",
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex-1">{s.title}</span>
                {count !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
