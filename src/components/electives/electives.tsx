"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Save } from "lucide-react";
import { applyCounts, chooseElective, saveWindow, withdrawChoice } from "@/app/[inst]/electives/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface OfferingView {
  id: string;
  code: string;
  name: string;
  teachers: string;
  count: number;
  seats: number | null;
  size: number | null;
}

type Msg = { ok: boolean; text: string; list?: string[] } | null;

function useAction() {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; warnings?: string[] }>) =>
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? (res.message || res.warnings?.length ? { ok: true, text: res.message ?? "", list: res.warnings } : null) : { ok: false, text: res.error ?? "Something went wrong." });
      if (res.ok) router.refresh();
    });
  return { msg, pending, run };
}

function Message({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div className={cn("text-sm", msg.ok ? "text-muted-foreground" : "text-destructive")}>
      {msg.text}
      {msg.list && msg.list.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-amber-700 dark:text-amber-300">
          {msg.list.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WindowEditor({
  slug,
  basketId,
  window,
  offerings,
  total,
  registered,
}: {
  slug: string;
  basketId: string;
  window: { opensOn: string; closesOn: string } | null;
  offerings: OfferingView[];
  total: number;
  registered: number;
}) {
  const [opensOn, setOpensOn] = useState(window?.opensOn ?? "");
  const [closesOn, setClosesOn] = useState(window?.closesOn ?? "");
  const [seats, setSeats] = useState<Record<string, string>>(() => Object.fromEntries(offerings.map((o) => [o.id, o.seats == null ? "" : String(o.seats)])));
  const { msg, pending, run } = useAction();
  const even = Math.ceil(total / Math.max(1, offerings.length));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Opens</span>
          <input type="date" aria-label="Registration opens" className="h-8 rounded-md border bg-background px-2" value={opensOn} onChange={(e) => setOpensOn(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Closes</span>
          <input type="date" aria-label="Registration closes" className="h-8 rounded-md border bg-background px-2" value={closesOn} onChange={(e) => setClosesOn(e.target.value)} />
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSeats(Object.fromEntries(offerings.map((o) => [o.id, String(Math.ceil(even * 1.2))])))}
        >
          Seats: even share + 20%
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">Elective</th>
            <th className="py-1 font-medium">Registered</th>
            <th className="py-1 font-medium">Seats</th>
            <th className="py-1 text-right font-medium">Class size now</th>
          </tr>
        </thead>
        <tbody>
          {offerings.map((o) => {
            const limit = Number(seats[o.id]) || null;
            const share = limit ? Math.min(1, o.count / limit) : total ? o.count / total : 0;
            return (
              <tr key={o.id} className="border-t align-middle">
                <td className="py-1.5 pr-2">
                  <div className="font-medium">
                    {o.code} {o.name}
                  </div>
                  <div className="text-xs text-muted-foreground">{o.teachers || "No teacher yet"}</div>
                </td>
                <td className="py-1.5 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="w-16 tabular-nums">
                      {o.count}
                      {limit ? `/${limit}` : ""}
                    </span>
                    <span className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
                    </span>
                  </div>
                </td>
                <td className="py-1.5 pr-2">
                  <Input
                    aria-label={`Seats for ${o.code}`}
                    type="number"
                    min={1}
                    className="h-8 w-24"
                    placeholder="No limit"
                    value={seats[o.id] ?? ""}
                    onChange={(e) => setSeats((s) => ({ ...s, [o.id]: e.target.value }))}
                  />
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">{o.size ?? `~${even} (even share)`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending || !opensOn || !closesOn}
          onClick={() => run(() => saveWindow(slug, { basketId, opensOn, closesOn, seats: Object.fromEntries(offerings.map((o) => [o.id, Number(seats[o.id]) || null])) }))}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {window ? "Save" : "Open registration"}
        </Button>
        {window && registered > 0 && (
          <>
            <span className="ml-2 text-sm text-muted-foreground">Use the counts as class sizes:</span>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => applyCounts(slug, basketId, "registered"))}>
              As registered ({registered})
            </Button>
            {registered < total && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => applyCounts(slug, basketId, "scaled"))}>
                Scaled to all {total} students
              </Button>
            )}
          </>
        )}
      </div>
      {window && registered > 0 && registered < total && (
        <p className="text-xs text-muted-foreground">Scaled: students who didn&apos;t register are assumed to choose in the same proportions, within the seat limits.</p>
      )}
      <Message msg={msg} />
    </div>
  );
}

export function ChoicePicker({
  slug,
  basketId,
  open,
  offerings,
  current,
}: {
  slug: string;
  basketId: string;
  open: boolean;
  offerings: OfferingView[];
  current: string | null;
}) {
  const { msg, pending, run } = useAction();
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {offerings.map((o) => {
          const mine = current === o.id;
          const full = o.seats != null && o.count >= o.seats && !mine;
          return (
            <div key={o.id} className={cn("flex flex-col gap-2 rounded-lg border p-3", mine && "border-primary ring-1 ring-primary")}>
              <div>
                <div className="font-medium">
                  {o.code} {o.name}
                </div>
                <div className="text-xs text-muted-foreground">{o.teachers}</div>
              </div>
              <div className="text-xs text-muted-foreground">{o.seats != null ? (full ? "Full" : `${o.seats - o.count} of ${o.seats} seats left`) : `${o.count} registered`}</div>
              {mine ? (
                <span className="mt-auto flex items-center gap-1 text-sm font-medium">
                  <Check className="size-4" /> Your choice
                </span>
              ) : (
                <Button size="sm" variant="outline" className="mt-auto" disabled={!open || full || pending} onClick={() => run(() => chooseElective(slug, basketId, o.id))}>
                  {current ? "Switch to this" : "Choose"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {open && current && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => withdrawChoice(slug, basketId))}>
          Withdraw my choice
        </Button>
      )}
      <Message msg={msg} />
    </div>
  );
}
