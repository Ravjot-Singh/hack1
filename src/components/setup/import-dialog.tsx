"use client";

import { useState } from "react";
import { Download, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { downloadCsv, readTable } from "@/lib/setup/files";
import { FIELDS, mapRows, templateTable, type Entity, type ImportResult, type Lookups } from "@/lib/setup/import";

interface Props {
  entity: Entity;
  /** Human name for the rows, e.g. "teachers". */
  noun: string;
  lookups: Lookups;
  disabled?: boolean;
  onImport: (result: ImportResult<Record<string, unknown>>, mode: "merge" | "replace") => void;
}

/** Upload a CSV/Excel file, check it, and hand the rows to the table (unsaved). */
export function ImportDialog({ entity, noun, lookups, disabled, onImport }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult<Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setResult(null);
    setError(null);
    setFileName("");
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      setResult(mapRows(entity, await readTable(file), lookups));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      setBusy(false);
    }
  };

  const apply = (mode: "merge" | "replace") => {
    if (!result) return;
    onImport(result, mode);
    setOpen(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>
        <FileUp /> Import
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import {noun}</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel (.xlsx) file. The first row must be column headers. Rows land in the table so you can
            review them before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="mb-1 font-medium">Columns</div>
            <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {FIELDS[entity].map((f) => (
                <li key={f.key} className="text-muted-foreground">
                  <code className="text-foreground">{f.header}</code>
                  {f.required ? " *" : ""}
                  {f.help ? ` · ${f.help}` : ""}
                </li>
              ))}
            </ul>
            <Button
              variant="link"
              size="sm"
              className="mt-1 h-auto px-0"
              onClick={() => downloadCsv(`${entity}-template.csv`, templateTable(entity))}
            >
              <Download /> Download template
            </Button>
          </div>

          <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed p-5 text-center hover:bg-muted/40">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <FileUp className="size-5 text-muted-foreground" />}
            <span>{fileName || "Choose a .csv or .xlsx file"}</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv"
              className="sr-only"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>

          {error && <p className="text-destructive">{error}</p>}
          {result && (
            <div className="space-y-2">
              <p>
                <span className="font-medium">{result.rows.length}</span> {noun} ready
                {result.baskets?.length ? `, ${result.baskets.length} elective basket(s)` : ""}
                {result.errors.length ? (
                  <span className="text-destructive">
                    {" "}
                    · {result.errors.length} row{result.errors.length > 1 ? "s" : ""} skipped
                  </span>
                ) : null}
              </p>
              {result.errors.length > 0 && (
                <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-destructive">
                  {result.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={!result?.rows.length} onClick={() => apply("replace")}>
            Replace all
          </Button>
          <Button disabled={!result?.rows.length} onClick={() => apply("merge")}>
            Add / update {noun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
