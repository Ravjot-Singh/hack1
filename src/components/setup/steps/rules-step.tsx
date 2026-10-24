"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { saveRules } from "@/app/[inst]/setup/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SoftWeights } from "@/lib/solver/types";
import { cn } from "@/lib/utils";
import type { StepProps } from "../step-view";

const GOALS: { key: keyof SoftWeights; label: string; help: string }[] = [
  { key: "teacherPrefs", label: "Teacher preferences", help: "Use slots teachers prefer; avoid their 'rather not' slots." },
  { key: "balancedDays", label: "Balanced days", help: "Spread each class's and teacher's load evenly over the week." },
  { key: "idleGaps", label: "Fewer free gaps", help: "Avoid empty periods between classes for students." },
  { key: "subjectSpread", label: "Spread each subject", help: "Avoid the same subject twice on one day." },
  { key: "roomUtilization", label: "Room use", help: "Pack into fewer rooms (or spread evenly, see below)." },
];
const LEVELS = ["Off", "Low", "Med", "High"];

export function RulesStep({ slug, data, readOnly }: StepProps) {
  const router = useRouter();
  const [r, setR] = useState(data.rules);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<typeof r>) => {
    setR((x) => ({ ...x, ...patch }));
    setMsg(null);
  };

  const limit = (key: "maxConsecutiveSection" | "maxConsecutiveTeacher", label: string, help: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <div className="flex items-center gap-3">
        <Input
          id={key}
          type="number"
          min={1}
          max={12}
          className="w-20"
          disabled={readOnly || r[key] === null}
          value={r[key] ?? ""}
          onChange={(e) => set({ [key]: Number(e.target.value) || 1 })}
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            disabled={readOnly}
            checked={r[key] === null}
            onChange={(e) => set({ [key]: e.target.checked ? null : 3 })}
          />
          No limit
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );

  return (
    <div className="max-w-3xl space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Hard rules</h2>
          <p className="text-sm text-muted-foreground">
            Never broken. No double-booking, room types, capacities, teacher limits and blocked slots always apply.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {limit("maxConsecutiveSection", "Max periods in a row for students", "A break or free period must follow. Lab blocks count.")}
          {limit("maxConsecutiveTeacher", "Max periods in a row for teachers", "Must be at least your longest lab block.")}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            disabled={readOnly}
            checked={r.travelTimeHard}
            onChange={(e) => set({ travelTimeHard: e.target.checked })}
          />
          <span>
            Respect walking time between buildings
            <span className="block text-xs text-muted-foreground">
              No back-to-back classes in buildings further apart than the gap between periods allows.
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">What makes a timetable better</h2>
          <p className="text-sm text-muted-foreground">These shape the quality score and are traded off against each other.</p>
        </div>
        <ul className="space-y-3">
          {GOALS.map((g) => (
            <li key={g.key} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="text-sm font-medium">{g.label}</span>
                <span className="block text-xs text-muted-foreground">{g.help}</span>
              </span>
              <div role="radiogroup" aria-label={g.label} className="flex rounded-lg border p-0.5">
                {LEVELS.map((label, v) => {
                  const on = r.weights[g.key] === v;
                  return (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={readOnly}
                      onClick={() => set({ weights: { ...r.weights, [g.key]: v } })}
                      className={cn("rounded-md px-2.5 py-1 text-xs", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="util">Room use style</Label>
          <select
            id="util"
            disabled={readOnly}
            className="h-8 rounded-lg border bg-background px-2"
            value={r.roomUtilizationMode}
            onChange={(e) => set({ roomUtilizationMode: e.target.value as "compact" | "spread" })}
          >
            <option value="compact">Compact: free up whole rooms for events</option>
            <option value="spread">Spread: use all rooms evenly</option>
          </select>
        </div>
      </section>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveRules(slug, r);
                setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
                if (res.ok) router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Save />} Save rules
          </Button>
          {msg && <span className={cn("text-sm", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}
