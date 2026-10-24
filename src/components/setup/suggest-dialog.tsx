"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { saveAllocation } from "@/app/[inst]/setup/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { SetupData } from "@/lib/setup/convert";
import { suggestTeachers } from "@/lib/setup/suggest";
import { cn } from "@/lib/utils";

interface Props {
  slug: string;
  /** Everything in the college (for current teacher loads). */
  fullData: SetupData;
  /** Offerings the viewer may change (all for admins, own department's for HODs). */
  data: SetupData;
  sectionId: string;
  disabled?: boolean;
}

/** Propose teachers for rows that have none, review them, then apply the ticked ones. */
export function SuggestDialog({ slug, fullData, data, sectionId, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"section" | "all">("section");
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const unassigned = data.offerings.filter((o) => !(o.teacherIds ?? []).length);
  const inSection = unassigned.filter((o) => o.sectionIds.includes(sectionId));
  const targets = scope === "section" ? inSection : unassigned;

  const suggestions = useMemo(
    () => (open ? suggestTeachers(fullData, new Set(targets.map((o) => o.id!))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, fullData, scope, sectionId],
  );
  const name = (id: string | null) => fullData.teachers.find((t) => t.id === id)?.name ?? "";
  const subject = (id: string) => fullData.subjects.find((s) => s.id === id);
  const sections = (ids: string[]) => ids.map((id) => fullData.sections.find((s) => s.id === id)?.name).join(", ");
  const applicable = suggestions.filter((s) => s.teacherId && !skip.has(s.offeringId));

  const apply = () =>
    start(async () => {
      const chosen = new Map(applicable.map((s) => [s.offeringId, s.teacherId!]));
      const offerings = data.offerings.map((o) => (chosen.has(o.id!) ? { ...o, teacherIds: [chosen.get(o.id!)!] } : o));
      const res = await saveAllocation(slug, { baskets: data.baskets, offerings });
      if (!res.ok) return setMsg(res.error);
      setOpen(false);
      setSkip(new Set());
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setMsg(null))}>
      <DialogTrigger render={<Button variant="outline" size="sm" disabled={disabled || !unassigned.length} />}>
        <Sparkles /> Suggest teachers{unassigned.length ? ` (${unassigned.length})` : ""}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Suggest teachers</DialogTitle>
          <DialogDescription>
            For subjects with no teacher yet. Prefers whoever already teaches the subject, then its department, and spreads work
            to the least-loaded teacher without going over anyone&apos;s weekly limit.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 text-sm">
          {(
            [
              ["section", `This section (${inSection.length})`],
              ["all", `Everything unassigned (${unassigned.length})`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => (setScope(value), setSkip(new Set()))}
              className={cn("rounded-md border px-3 py-1", scope === value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {label}
            </button>
          ))}
        </div>

        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every subject here already has a teacher.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-1.5" />
                  <th className="px-2 py-1.5 font-medium">Subject</th>
                  <th className="px-2 py-1.5 font-medium">Suggested teacher</th>
                  <th className="px-2 py-1.5 font-medium">Load after</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => {
                  const o = data.offerings.find((x) => x.id === s.offeringId)!;
                  const subj = subject(o.subjectId);
                  return (
                    <tr key={s.offeringId} className="border-t align-top">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          aria-label={`Apply suggestion for ${subj?.code}`}
                          disabled={!s.teacherId}
                          checked={!!s.teacherId && !skip.has(s.offeringId)}
                          onChange={(e) =>
                            setSkip((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete(s.offeringId);
                              else next.add(s.offeringId);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-medium">{subj?.code}</span> {subj?.name}
                        <span className="block text-xs text-muted-foreground">
                          {sections(o.sectionIds)} · {s.periods} periods/week
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        {s.teacherId ? name(s.teacherId) : <span className="text-destructive">Nobody</span>}
                        <span className="block text-xs text-muted-foreground">{s.reason}</span>
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{s.teacherId ? `${s.loadAfter}/${s.maxPerWeek}` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {msg && <p className="text-sm text-destructive">{msg}</p>}

        <DialogFooter>
          <Button onClick={apply} disabled={pending || !applicable.length}>
            {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} Apply {applicable.length} suggestion{applicable.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
