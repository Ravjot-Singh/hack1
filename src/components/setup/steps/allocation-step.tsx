"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { saveAllocation } from "@/app/[inst]/setup/actions";
import { Button } from "@/components/ui/button";
import { buildProblem } from "@/lib/solver";
import { lookupsOf, toInstituteInput } from "@/lib/setup/convert";
import { downloadCsv } from "@/lib/setup/files";
import { exportTable, mergeRows, naturalKey } from "@/lib/setup/import";
import { teacherLoads } from "@/lib/setup/loads";
import { newId, type BasketRow, type OfferingRow } from "@/lib/setup/schemas";
import { cn } from "@/lib/utils";
import { EditableTable, type Column } from "../editable-table";
import { ImportDialog } from "../import-dialog";
import { SuggestDialog } from "../suggest-dialog";
import type { StepProps } from "../step-view";

export function AllocationStep({ slug, data: fullData, readOnly, scope }: StepProps) {
  const router = useRouter();
  // HODs allocate only their own department's subjects (to any section).
  const data = useMemo(() => {
    if (!scope) return fullData;
    const own = new Set(fullData.subjects.filter((s) => s.deptId === scope).map((s) => s.id));
    return { ...fullData, subjects: fullData.subjects.filter((s) => own.has(s.id!)), offerings: fullData.offerings.filter((o) => own.has(o.subjectId)) };
  }, [fullData, scope]);
  const lookups = lookupsOf(data);
  const [sectionId, setSectionId] = useState(data.sections[0]?.id ?? "");
  // Unsaved rows for the current section, so the load sidebar reflects edits live.
  const [draft, setDraft] = useState<OfferingRow[] | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [, startImport] = useTransition();

  const inSection = (o: OfferingRow) => o.sectionIds.includes(sectionId);
  const sectionRows = useMemo(() => data.offerings.filter((o) => o.sectionIds.includes(sectionId)), [data.offerings, sectionId]);

  const options = useMemo(() => {
    const dept = new Map(data.departments.map((d) => [d.id, d.code]));
    return {
      subjects: data.subjects.map((s) => ({ value: s.id!, label: `${s.code} · ${s.name}` })),
      teachers: [...data.teachers]
        .sort((a, b) => (dept.get(a.deptId) ?? "").localeCompare(dept.get(b.deptId) ?? "") || a.name.localeCompare(b.name))
        .map((t) => ({ value: t.id!, label: `${t.name} (${dept.get(t.deptId)})` })),
      sections: data.sections.map((s) => ({ value: s.id!, label: s.name })),
      baskets: data.baskets.map((b) => ({ value: b.id!, label: b.name })),
    };
  }, [data]);

  // Live teacher loads across the whole college, using the real lesson expansion (L-T-P, batches, baskets).
  const loads = useMemo(() => {
    const replaced = new Set(draft ? data.offerings.filter(inSection).map((o) => o.id) : []);
    const offerings = draft ? [...fullData.offerings.filter((o) => !replaced.has(o.id)), ...draft] : fullData.offerings;
    try {
      return teacherLoads(buildProblem(toInstituteInput({ ...fullData, offerings })))
        .filter((t) => t.load > 0)
        .sort((a, b) => b.load / b.maxPerWeek - a.load / a.maxPerWeek);
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullData, data, draft, sectionId]);

  if (!data.sections.length || !data.subjects.length || !data.teachers.length) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Add sections, subjects and teachers first. Allocation connects them.
      </p>
    );
  }

  const columns: Column<OfferingRow>[] = [
    { key: "subjectId", label: "Subject", type: "select", options: options.subjects, className: "min-w-56" },
    { key: "teacherIds", label: "Teacher(s)", type: "multiselect", options: options.teachers },
    { key: "labTeacherIds", label: "Lab teacher(s)", type: "multiselect", options: options.teachers },
    { key: "batchwiseLab", label: "Labs per batch", type: "checkbox" },
    { key: "sectionIds", label: "Sections (combined class)", type: "multiselect", options: options.sections },
    {
      key: "basketId",
      label: "Elective basket",
      type: "select",
      options: options.baskets,
      emptyLabel: "—",
      // A basket elective is offered to all of the basket's sections.
      derive: (v) => {
        const b = data.baskets.find((x) => x.id === v);
        return b ? { sectionIds: b.sectionIds } : {};
      },
    },
    { key: "expectedSize", label: "Expected size", type: "number" },
  ];

  const onImport = (result: { rows: Record<string, unknown>[]; baskets?: BasketRow[] }, mode: "merge" | "replace") =>
    startImport(async () => {
      const baskets = mergeBaskets(data.baskets, result.baskets ?? []);
      const offerings = mergeRows("allocation", data.offerings, result.rows as unknown as OfferingRow[], mode);
      const res = await saveAllocation(slug, { baskets, offerings });
      setImportMsg(res.ok ? `Imported and saved ${result.rows.length} allocation rows.` : res.error);
      if (res.ok) router.refresh();
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_17rem]">
      <div className="min-w-0 space-y-8">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="alloc-section" className="text-sm font-medium">
            Section
          </label>
          <select
            id="alloc-section"
            className="h-8 min-w-40 rounded-lg border bg-background px-2 text-sm"
            value={sectionId}
            onChange={(e) => {
              if (draft && !confirm("Discard unsaved changes for this section?")) return;
              setDraft(null);
              setSectionId(e.target.value);
            }}
          >
            {data.departments.map((d) => (
              <optgroup key={d.id} label={d.code}>
                {data.sections
                  .filter((s) => data.programs.find((p) => p.id === s.programId)?.deptId === d.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({data.offerings.filter((o) => o.sectionIds.includes(s.id!)).length})
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <div className="ml-auto flex gap-2">
            <SuggestDialog slug={slug} fullData={fullData} data={data} sectionId={sectionId} disabled={readOnly} />
            <Button variant="ghost" size="sm" onClick={() => downloadCsv("allocation.csv", exportTable("allocation", data, lookups))} disabled={!data.offerings.length}>
              <Download /> Export all
            </Button>
            <ImportDialog
              entity="allocation"
              noun="allocation rows"
              lookups={lookups}
              disabled={readOnly}
              description="One row per subject per section, for the whole college. Rows matching an existing subject+section are updated; others are added. The import is saved straight away."
              onImport={onImport}
            />
          </div>
        </div>
        {importMsg && <p className="text-sm text-muted-foreground">{importMsg}</p>}

        <EditableTable
          key={sectionId}
          title="Subjects for this section"
          description="A row with several sections is a combined class taught together. Labs per batch runs practicals separately for G1, G2…"
          rows={sectionRows}
          columns={columns}
          newRow={() => ({
            subjectId: "",
            sectionIds: [sectionId],
            teacherIds: [],
            labTeacherIds: [],
            batchwiseLab: true,
            basketId: null,
            expectedSize: null,
          })}
          onRowsChange={setDraft}
          onSave={async (rows) => {
            const res = await saveAllocation(slug, {
              baskets: data.baskets,
              offerings: [...data.offerings.filter((o) => !inSection(o)), ...rows],
            });
            if (res.ok) setDraft(null);
            // Row errors refer to the full list; show them as one message instead.
            return res.ok ? res : { ok: false, error: res.error };
          }}
          readOnly={readOnly}
          emptyText="No subjects allocated to this section yet."
        />

        <EditableTable
          title="Elective baskets"
          description={
            scope
              ? "Electives in a basket run at the same time. Baskets span departments, so the Institute Admin manages them; you can pick one on your electives' rows."
              : "Electives in a basket run at the same time, so each student of the basket's sections attends one of them. Create the basket here, then pick it on each elective's row."
          }
          rows={data.baskets}
          columns={[
            { key: "name", label: "Basket", type: "text", placeholder: "Open Elective (3rd year)", className: "min-w-56" },
            { key: "sectionIds", label: "Sections", type: "multiselect", options: options.sections },
          ]}
          newRow={() => ({ id: newId(), name: "", sectionIds: [] })}
          onSave={async (baskets) => {
            const kept = new Set(baskets.map((b) => b.id));
            const used = data.baskets.find((b) => !kept.has(b.id) && data.offerings.some((o) => o.basketId === b.id));
            if (used) return { ok: false, error: `"${used.name}" still has electives. Clear their basket first.` };
            // Keep basket electives in step with their basket's sections.
            const offerings = data.offerings.map((o) => {
              const b = baskets.find((x) => x.id === o.basketId);
              return b ? { ...o, sectionIds: b.sectionIds } : o;
            });
            return saveAllocation(slug, { baskets, offerings });
          }}
          readOnly={readOnly || !!scope}
          emptyText="No elective baskets."
        />
      </div>

      <aside className="space-y-2 xl:sticky xl:top-4 xl:self-start">
        <h2 className="font-medium">Teacher load</h2>
        <p className="text-xs text-muted-foreground">Periods per week vs. limit, including unsaved edits.</p>
        <ul className="space-y-1.5">
          {loads.map((t) => {
            const pct = Math.min(100, (100 * t.load) / Math.max(1, t.maxPerWeek));
            const over = t.load > t.maxPerWeek;
            return (
              <li key={t.id} className="text-xs">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{t.name}</span>
                  <span className={cn("tabular-nums", over && "font-semibold text-destructive")}>
                    {t.load}/{t.maxPerWeek}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", over ? "bg-destructive" : pct > 85 ? "bg-amber-500" : "bg-foreground/60")} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
          {!loads.length && <li className="text-xs text-muted-foreground">No classes allocated yet.</li>}
        </ul>
      </aside>
    </div>
  );
}

/** Imported baskets update existing ones with the same name. */
function mergeBaskets(current: BasketRow[], imported: BasketRow[]): BasketRow[] {
  const byName = new Map(current.map((b) => [naturalKey("buildings", b), b]));
  const out = [...current];
  for (const b of imported) {
    const match = byName.get(naturalKey("buildings", b));
    if (match) out[out.indexOf(match)] = { ...match, sectionIds: b.sectionIds };
    else out.push(b);
  }
  return out;
}
