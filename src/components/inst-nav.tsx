"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function InstNav({ slug }: { slug: string }) {
  const path = usePathname();
  const items = [
    { href: `/${slug}`, label: "Overview", exact: true },
    { href: `/${slug}/solve`, label: "Generate" },
    { href: `/${slug}/timetables`, label: "Timetables" },
  ];
  return (
    <nav className="ml-auto flex gap-1 text-sm">
      {items.map((i) => {
        const active = i.exact ? path === i.href : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={cn(
              "rounded-md px-3 py-1.5 transition-colors hover:bg-muted",
              active ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
