"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
}

/** Institute navigation; items are filtered by role on the server. */
export function InstNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="ml-auto flex flex-wrap gap-1 text-sm">
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
