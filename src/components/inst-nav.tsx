"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
}

/**
 * Institute navigation; items are filtered by role on the server. Phones get a Menu button
 * that opens the pages as a two-column list; wider screens get one row of tabs that scrolls
 * sideways when it doesn't fit (never wrapping into several rows).
 */
export function InstNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [prevPath, setPrevPath] = useState(path);
  const strip = useRef<HTMLElement>(null);
  const isActive = (i: NavItem) => (i.exact ? path === i.href : path.startsWith(i.href));
  const current = items.find(isActive);

  // Close the phone menu after navigating.
  if (prevPath !== path) {
    setPrevPath(path);
    setOpen(false);
  }

  // Keep the current tab in view in the sideways-scrolling strip.
  useEffect(() => {
    const box = strip.current;
    const el = box?.querySelector<HTMLElement>("[aria-current=page]");
    if (box && el && box.scrollWidth > box.clientWidth) {
      box.scrollLeft += el.getBoundingClientRect().left - box.getBoundingClientRect().left - (box.clientWidth - el.offsetWidth) / 2;
    }
  }, [path]);

  if (!items.length) return null;
  const link = (i: NavItem, extra?: string) => (
    <Link
      key={i.href}
      href={i.href}
      aria-current={isActive(i) ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-2 whitespace-nowrap transition-colors hover:bg-muted md:py-1.5",
        isActive(i) ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
        extra,
      )}
    >
      {i.label}
    </Link>
  );

  return (
    <>
      <button
        type="button"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm md:hidden"
        aria-expanded={open}
        aria-controls="inst-nav-menu"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
        <span className="max-w-28 truncate">{open ? "Close" : (current?.label ?? "Menu")}</span>
      </button>
      {open && (
        <nav id="inst-nav-menu" aria-label="Pages" className="grid basis-full grid-cols-2 gap-1 pb-1 text-sm md:hidden">
          {items.map((i) => link(i))}
        </nav>
      )}
      <nav
        ref={strip}
        aria-label="Pages"
        className="-mx-4 hidden basis-full gap-1 overflow-x-auto px-4 text-sm [scrollbar-width:none] md:flex [&::-webkit-scrollbar]:hidden"
      >
        {items.map((i) => link(i, "shrink-0"))}
      </nav>
    </>
  );
}
