"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { interpretRuleWithAi } from "@/app/[inst]/setup/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describe, toCustomRule, type RuleDraft } from "@/lib/rules/draft";
import { parseRule } from "@/lib/rules/parse";
import { buildProblem, precheck } from "@/lib/solver";
import { ruleMatches } from "@/lib/solver/custom-rules";
import type { InstituteInput, RuleSettings } from "@/lib/solver/types";
import { cn } from "@/lib/utils";

interface Props {
  slug: string;
  input: InstituteInput;
  rules: RuleSettings;
  readOnly: boolean;
  ai: { label: string; model: string; calls: number } | null | undefined;
  /** Save the rules with this change; resolves to an error message or null. */
  commit: (next: RuleSettings) => Promise<string | null>;
}

type Candidate = { text: string; draft: RuleDraft; source: string; cached: boolean };
type Failure = { text: string; reason: string; triedAi: boolean };

export function CustomRules({ slug, input, rules, readOnly, ai, commit }: Props) {
  const [text, setText] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calls, setCalls] = useState(ai?.calls ?? 0);
  const [asking, startAsking] = useTransition();
  const [saving, startSaving] = useTransition();
  const custom = rules.custom ?? [];

  const problem = useMemo(() => buildProblem(input), [input]);
  const sectionYear = useMemo(() => new Map(input.sections.map((s) => [s.id, s.year])), [input]);

  const read = () => {
    const t = text.trim();
    if (!t) return;
    setError(null);
    const r = parseRule(t, input);
    if (r.ok) {
      setCandidate({ text: t, draft: r.draft, source: "Built-in reader", cached: false });
      setFailure(null);
    } else {
      setCandidate(null);
      setFailure({ text: t, reason: r.reason, triedAi: false });
    }
  };

  const askAi = () => {
    if (!failure) return;
    startAsking(async () => {
      const res = await interpretRuleWithAi(slug, failure.text);
      if (res.calls !== undefined) setCalls(res.calls);
      if (res.ok) {
        setCandidate({ text: failure.text, draft: res.draft, source: res.source, cached: res.cached });
        setFailure(null);
      } else setFailure({ ...failure, reason: res.error, triedAi: true });
    });
  };

  const save = (next: RuleSettings, after: () => void) =>
    startSaving(async () => {
      const err = await commit(next);
      setError(err);
      if (!err) after();
    });

  const add = () => {
    if (!candidate) return;
    const d = candidate.draft;
    const next =
      d.kind === "limit"
        ? { ...rules, [d.who === "teachers" ? "maxConsecutiveTeacher" : "maxConsecutiveSection"]: d.max }
        : { ...rules, custom: [...custom, toCustomRule(d, candidate.text, input, crypto.randomUUID())] };
    save(next, () => {
      setCandidate(null);
      setText("");
    });
  };

  const examples = [
    `${input.teachers[0]?.name ?? "Dr. Sharma"} is not available on Friday afternoons`,
    "No labs on Saturday",
    "First years only have classes in the morning",
    "Avoid classes after 3 pm for 2nd years",
    "Max 3 classes in a row for teachers",
  ];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Rules in your own words</h2>
        <p className="text-sm text-muted-foreground">
          Type a rule the way you would say it. A built-in reader handles common rules for free
          {ai ? `; if it can't, you can ask ${ai.label}` : ""}. You always confirm what was understood before it is saved.
        </p>
      </div>

      {custom.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {custom.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-3 py-2">
              <Badge variant={c.strength === "hard" ? "default" : "secondary"} className="mt-0.5 shrink-0">
                {c.strength === "hard" ? "Must" : "Try to"}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{c.summary}</div>
                <div className="truncate text-xs text-muted-foreground">“{c.text}”</div>
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove rule: ${c.summary}`}
                  disabled={saving}
                  onClick={() => save({ ...rules, custom: custom.filter((x) => x.id !== c.id) }, () => {})}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {custom.length === 0 && readOnly && <p className="text-sm text-muted-foreground">No rules added.</p>}

      {!readOnly && (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              read();
            }}
          >
            <Input
              aria-label="New rule"
              placeholder="e.g. No labs on Saturday"
              value={text}
              maxLength={300}
              onChange={(e) => {
                setText(e.target.value);
                setCandidate(null);
                setFailure(null);
              }}
            />
            <Button type="submit" variant="outline" disabled={!text.trim()}>
              Read rule
            </Button>
          </form>
          {!candidate && !failure && (
            <div className="flex flex-wrap gap-1.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    setText(ex);
                    setCandidate(null);
                    setFailure(null);
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {failure && (
            <div className="space-y-2 rounded-lg border border-dashed p-3 text-sm" role="status">
              <p>
                <span className="font-medium">{failure.triedAi ? `${ai?.label ?? "The AI"} couldn't use that either.` : "The built-in reader couldn't read that."}</span>{" "}
                <span className="text-muted-foreground">{failure.reason}</span>
              </p>
              {ai && !failure.triedAi ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={askAi} disabled={asking}>
                    {asking ? <Loader2 className="animate-spin" /> : <Sparkles />} Ask {ai.label}
                  </Button>
                  <span className="text-xs text-muted-foreground">Uses one AI request (free if this sentence was asked before).</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Try a simpler sentence: who (a teacher, section, year, labs…), never/only/avoid, and when (days, periods, morning, after 2 pm).
                </p>
              )}
            </div>
          )}

          {candidate && (
            <Confirm
              candidate={candidate}
              input={input}
              rules={rules}
              matches={
                candidate.draft.kind === "slots"
                  ? problem.lessons.filter((l) => ruleMatches(toCustomRule(candidate.draft as Extract<RuleDraft, { kind: "slots" }>, "", input, "x"), l, sectionYear)).length
                  : 0
              }
              saving={saving}
              onStrength={(strength) => candidate.draft.kind === "slots" && setCandidate({ ...candidate, draft: { ...candidate.draft, strength } })}
              onAdd={add}
              onCancel={() => {
                // A misread by the built-in reader can still go to the AI.
                if (ai && candidate.source === "Built-in reader") setFailure({ text: candidate.text, reason: "You said that's not what you meant.", triedAi: false });
                setCandidate(null);
              }}
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {ai && (
            <p className="text-xs text-muted-foreground">
              AI: {ai.label} ({ai.model}) · asked {calls} time{calls === 1 ? "" : "s"} for this college. Repeated sentences are answered from memory.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Confirm({
  candidate,
  input,
  rules,
  matches,
  saving,
  onStrength,
  onAdd,
  onCancel,
}: {
  candidate: Candidate;
  input: InstituteInput;
  rules: RuleSettings;
  matches: number;
  saving: boolean;
  onStrength: (s: "hard" | "soft") => void;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const d = candidate.draft;
  // Would this rule leave some class with no time at all?
  const blocked = useMemo(() => {
    if (d.kind !== "slots" || d.strength !== "hard") return null;
    const next = { ...input, rules: { ...rules, custom: [...(rules.custom ?? []), toCustomRule(d, candidate.text, input, "new")] } };
    return precheck(buildProblem(next)).find((i) => i.rule === "custom-rule" && i.message.includes(describe(d, input))) ?? null;
  }, [d, candidate.text, input, rules]);

  const current = d.kind === "limit" ? (d.who === "teachers" ? rules.maxConsecutiveTeacher : rules.maxConsecutiveSection) : null;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" role="status">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        I understood
        <Badge variant="outline">
          {candidate.source}
          {candidate.cached ? " · from memory" : ""}
        </Badge>
      </div>
      <p className="font-medium">{describe(d, input)}</p>
      {d.kind === "slots" ? (
        <>
          <p className="text-xs text-muted-foreground">
            Applies to {matches} class{matches === 1 ? "" : "es"} in the current setup.
            {matches === 0 && " Nothing matches yet, so it has no effect for now."}
          </p>
          <div role="radiogroup" aria-label="Strength" className="flex w-fit rounded-lg border bg-background p-0.5">
            {(
              [
                ["hard", "Must (never broken)"],
                ["soft", "Try to (if possible)"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={d.strength === v}
                onClick={() => onStrength(v)}
                className={cn("rounded-md px-2.5 py-1 text-xs", d.strength === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
              >
                {label}
              </button>
            ))}
          </div>
          {blocked && <p className="text-sm text-destructive">{blocked.message} The timetable can&apos;t be generated with it.</p>}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">This replaces the current setting ({current == null ? "no limit" : `${current} in a row`}).</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={onAdd} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />} {d.kind === "limit" ? "Apply" : "Add rule"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          <X /> Not what I meant
        </Button>
      </div>
    </div>
  );
}
