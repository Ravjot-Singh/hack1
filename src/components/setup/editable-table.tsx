"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Plus, Save, Trash2, Undo2, X } from "lucide-react";
import type { SaveResult } from "@/app/[inst]/setup/actions";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/setup/files";
import { mergeRows, type Entity, type ImportResult, type Lookups } from "@/lib/setup/import";
import { newId } from "@/lib/setup/schemas";
import { cn } from "@/lib/utils";
import { ImportDialog } from "./import-dialog";

export interface Option {
  value: string;
  label: string;
}

export interface Column<T> {
  key: keyof T & string;
  label: string;
  type: "text" | "number" | "select" | "multiselect" | "checkbox";
  options?: Option[];
  /** Select: allow an empty choice shown with this label (stored as null). */
  emptyLabel?: string;
  placeholder?: string;
  /** Datalist id for free-text suggestions. */
  list?: string;
  className?: string;
  /** Extra fields to update when this cell changes (e.g. designation -> load limits). */
  derive?: (value: unknown, row: T) => Partial<T>;
}

interface Item<T> {
  key: string;
  row: T;
}

interface Props<T extends { id?: string }> {
  title: string;
  description?: ReactNode;
  rows: T[];
  columns: Column<T>[];
  newRow: () => T;
  onSave: (rows: T[]) => Promise<SaveResult>;
  readOnly?: boolean;
  /** Enables Import / Export for this table. */
  importer?: { entity: Entity; noun: string; lookups: Lookups; exportTable: () => string[][] };
  rowActions?: (row: T, update: (patch: Partial<T>) => void) => ReactNode;
  /** Called with the current (unsaved) rows, e.g. to drive a live sidebar. */
  onRowsChange?: (rows: T[]) => void;
  emptyText?: string;
}

const wrap = <T extends { id?: string }>(rows: T[]): Item<T>[] => rows.map((row) => ({ key: row.id ?? newId(), row }));

/** Spreadsheet-style editor: edit cells, add/remove rows, import a file, save once. */
export function EditableTable<T extends { id?: string }>({
  title,
  description,
  rows,
  columns,
  newRow,
  onSave,
  readOnly,
  importer,
  rowActions,
  onRowsChange,
  emptyText = "Nothing here yet.",
}: Props<T>) {
  const router = useRouter();
  const [items, setItems] = useState(() => wrap(rows));
  const [prevRows, setPrevRows] = useState(rows);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // Fresh server data (after save or elsewhere) replaces the table unless there are unsaved edits.
  if (rows !== prevRows) {
    setPrevRows(rows);
    if (!dirty) setItems(wrap(rows));
  }

  const commit = (next: Item<T>[]) => {
    setItems(next);
    setDirty(true);
    setNotice(null);
    onRowsChange?.(next.map((i) => i.row));
  };
  const update = (key: string, patch: Partial<T>) =>
    commit(items.map((i) => (i.key === key ? { ...i, row: { ...i.row, ...patch } } : i)));

  const save = () =>
    startSaving(async () => {
      setError(null);
      setRowErrors({});
      const res = await onSave(items.map((i) => i.row));
      if (res.ok) {
        setDirty(false);
        setNotice("Saved.");
        router.refresh();
      } else {
        setError(res.error);
        if (res.rowErrors) {
          const byKey: Record<string, string> = {};
          for (const [idx, msg] of Object.entries(res.rowErrors)) {
            const item = items[Number(idx)];
            if (item) byKey[item.key] = msg;
          }
          setRowErrors(byKey);
        }
      }
    });

  const discard = () => {
    setItems(wrap(rows));
    setDirty(false);
    setError(null);
    setRowErrors({});
    onRowsChange?.(rows);
  };

  const onImport = (result: ImportResult<Record<string, unknown>>, mode: "merge" | "replace") => {
    if (!importer) return;
    const merged = mergeRows(importer.entity, items.map((i) => i.row), result.rows as unknown as T[], mode);
    commit(wrap(merged));
    setNotice(`Imported ${result.rows.length} ${importer.noun}. Review, then Save.`);
  };

  const colCount = columns.length + 1 + (rowActions ? 1 : 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {importer && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadCsv(`${importer.entity}.csv`, importer.exportTable())}
              disabled={!rows.length}
            >
              <Download /> Export
            </Button>
            <ImportDialog
              entity={importer.entity}
              noun={importer.noun}
              lookups={importer.lookups}
              disabled={readOnly}
              onImport={onImport}
            />
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="px-2 py-2 font-medium">
                  {c.label}
                </th>
              ))}
              {rowActions && <th className="px-2 py-2" />}
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-3 py-6 text-center text-muted-foreground">
                  {emptyText}
                </td>
              </tr>
            )}
            {items.map((item) => (
              <RowView
                key={item.key}
                item={item}
                columns={columns}
                readOnly={readOnly}
                error={rowErrors[item.key]}
                colCount={colCount}
                onChange={(patch) => update(item.key, patch)}
                onDelete={() => commit(items.filter((i) => i.key !== item.key))}
                actions={rowActions?.(item.row, (patch) => update(item.key, patch))}
              />
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => commit([...items, { key: newId(), row: { ...newRow(), id: newId() } }])}
          >
            <Plus /> Add row
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {dirty && <span className="text-xs text-amber-700 dark:text-amber-400">Unsaved changes</span>}
            {!dirty && notice && <span className="text-xs text-muted-foreground">{notice}</span>}
            {dirty && notice && <span className="text-xs text-muted-foreground">{notice}</span>}
            <Button variant="ghost" size="sm" onClick={discard} disabled={!dirty || saving}>
              <Undo2 /> Discard
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Save {title.toLowerCase()}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function RowView<T>({
  item,
  columns,
  readOnly,
  error,
  colCount,
  onChange,
  onDelete,
  actions,
}: {
  item: Item<T>;
  columns: Column<T>[];
  readOnly?: boolean;
  error?: string;
  colCount: number;
  onChange: (patch: Partial<T>) => void;
  onDelete: () => void;
  actions?: ReactNode;
}) {
  const set = (c: Column<T>, value: unknown) =>
    onChange({ [c.key]: value, ...(c.derive?.(value, item.row) ?? {}) } as Partial<T>);
  return (
    <>
      <tr className={cn("border-t align-top", error && "bg-destructive/5")}>
        {columns.map((c) => (
          <td key={c.key} className={cn("px-1.5 py-1", c.className)}>
            <Cell column={c} value={item.row[c.key]} readOnly={readOnly} onChange={(v) => set(c, v)} />
          </td>
        ))}
        {actions !== undefined && <td className="px-1.5 py-1 whitespace-nowrap">{actions}</td>}
        <td className="px-1.5 py-1">
          {!readOnly && (
            <Button variant="ghost" size="icon-xs" aria-label="Delete row" onClick={onDelete}>
              <Trash2 />
            </Button>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={colCount} className="px-3 pb-2 text-xs text-destructive">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

const inputClass =
  "h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none hover:border-input focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-70";

function Cell<T>({
  column: c,
  value,
  readOnly,
  onChange,
}: {
  column: Column<T>;
  value: unknown;
  readOnly?: boolean;
  onChange: (v: unknown) => void;
}) {
  switch (c.type) {
    case "text":
      return (
        <input
          className={inputClass}
          value={String(value ?? "")}
          placeholder={c.placeholder}
          list={c.list}
          disabled={readOnly}
          aria-label={c.label}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          min={0}
          className={cn(inputClass, "w-20 tabular-nums")}
          value={value === null || value === undefined ? "" : String(value)}
          disabled={readOnly}
          aria-label={c.label}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          className="mt-2 size-4 accent-primary"
          checked={!!value}
          disabled={readOnly}
          aria-label={c.label}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "select":
      return (
        <select
          className={cn(inputClass, "pr-6")}
          value={(value as string | null) ?? ""}
          disabled={readOnly}
          aria-label={c.label}
          onChange={(e) => onChange(e.target.value === "" ? (c.emptyLabel !== undefined ? null : "") : e.target.value)}
        >
          {(c.emptyLabel !== undefined || !value) && <option value="">{c.emptyLabel ?? "Choose…"}</option>}
          {c.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "multiselect": {
      const ids = (value as string[] | undefined) ?? [];
      const label = (id: string) => c.options?.find((o) => o.value === id)?.label ?? "?";
      return (
        <div className="flex min-w-48 flex-wrap items-center gap-1 py-0.5">
          {ids.map((id) => (
            <span key={id} className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-xs">
              {label(id)}
              {!readOnly && (
                <button type="button" aria-label={`Remove ${label(id)}`} onClick={() => onChange(ids.filter((x) => x !== id))}>
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
          {!readOnly && (
            <select
              className="h-7 max-w-36 rounded-md border border-dashed bg-transparent px-1 text-xs text-muted-foreground"
              value=""
              aria-label={`Add ${c.label}`}
              onChange={(e) => e.target.value && onChange([...ids, e.target.value])}
            >
              <option value="">+ add</option>
              {c.options
                ?.filter((o) => !ids.includes(o.value))
                .map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
            </select>
          )}
        </div>
      );
    }
  }
}
