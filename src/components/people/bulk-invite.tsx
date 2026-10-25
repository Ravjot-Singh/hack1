"use client";

import { useRef, useState, useTransition } from "react";
import { Download, FileUp, Loader2, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { createInvites } from "@/app/[inst]/people/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { draftProblem, duplicates, hodDrafts, INVITE_TEMPLATE, mapInviteTable, teacherDrafts, type InviteDraft, type Taken } from "@/lib/invites";
import { downloadCsv, readTable } from "@/lib/setup/files";
import { cn } from "@/lib/utils";
import { RoleFields, selectClass, type PeopleLookups } from "./role-fields";

type Row = InviteDraft & { key: number };

const SHOWN = 100;
let nextKey = 1;
const blank = (): Row => ({ key: nextKey++, name: "", email: "", role: "TEACHER", departmentId: null, teacherId: null, sectionId: null });

/**
 * Invite several people at once. Rows come from typing, an imported CSV/Excel sheet or a group
 * (teachers of some departments, one HOD per department); the admin reviews them, then creates
 * every invite in one go.
 */
export function BulkInvite({ slug, taken, onCreated, ...lk }: PeopleLookups & { slug: string; taken: Taken; onCreated: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => [blank(), blank(), blank()]);
  const [showAll, setShowAll] = useState(false);
  const [group, setGroup] = useState<"teachers" | "hods">("teachers");
  const [groupDept, setGroupDept] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  // Untouched blank rows are ignored, so the starter rows never block creating.
  const filled = rows.filter((r) => r.name.trim() || r.email.trim() || r.teacherId || r.sectionId || r.departmentId);
  const teacherName = (id: string) => lk.teachers.find((t) => t.id === id)?.name ?? "That teacher";
  const dup = duplicates(filled, taken, teacherName);
  const problems = new Map(filled.map((r, i) => [r.key, draftProblem(r) ?? (dup.has(i) ? `Skipped: ${dup.get(i)}` : null)]));
  const blocking = filled.filter((r) => problems.get(r.key) && !problems.get(r.key)!.startsWith("Skipped")).length;
  const creatable = filled.filter((r) => !problems.get(r.key)).length;

  const add = (more: InviteDraft[]) => {
    // New rows replace the untouched starter rows.
    setRows((cur) => [...cur.filter((r) => filled.includes(r)), ...more.map((d) => ({ ...d, key: nextKey++ }))]);
    setMsg(null);
  };
  const update = (key: number, patch: Partial<InviteDraft>) =>
    setRows((cur) =>
      cur.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // Picking a teacher record fills in an empty name, and an HOD's department.
        const t = patch.teacherId ? lk.teachers.find((x) => x.id === patch.teacherId) : null;
        if (t && (!r.name.trim() || r.name === lk.teachers.find((x) => x.id === r.teacherId)?.name)) next.name = t.name;
        if (t && next.role === "HOD" && !next.departmentId) next.departmentId = t.departmentId;
        return next;
      }),
    );

  const importFile = async (f: File) => {
    try {
      const { rows: imported, errors } = mapInviteTable(await readTable(f), lk);
      add(imported);
      setMsg(
        errors.length
          ? { ok: false, text: `Added ${imported.length} row${imported.length === 1 ? "" : "s"} from ${f.name}; ${errors.length} could not be read:`, list: errors }
          : { ok: true, text: `Added ${imported.length} row${imported.length === 1 ? "" : "s"} from ${f.name}. Check them, then create the invites.` },
      );
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not read that file." });
    }
  };

  const addGroup = () => {
    const depts = groupDept ? [groupDept] : null;
    const more = group === "teachers" ? teacherDrafts(lk, depts, taken) : hodDrafts(lk, depts);
    if (!more.length) return setMsg({ ok: true, text: "Everyone in that group already has an account or an open invite." });
    add(more);
    if (group === "hods") setMsg({ ok: true, text: "Pick who heads each department (the teacher record fills in the name)." });
  };

  const submit = () =>
    start(async () => {
      const res = await createInvites(slug, filled.filter((r) => !problems.get(r.key)?.startsWith("Skipped")).map((r) => ({ name: r.name, email: r.email, role: r.role, departmentId: r.departmentId, teacherId: r.teacherId, sectionId: r.sectionId })));
      if (!res.ok) return setMsg({ ok: false, text: res.error, list: res.rowErrors });
      setRows([blank(), blank(), blank()]);
      setShowAll(false);
      setMsg({
        ok: true,
        text: `Created ${res.created} invite${res.created === 1 ? "" : "s"}. Share them from "Waiting to join" below.`,
        list: res.skipped.length ? res.skipped : undefined,
      });
      onCreated();
    });

  const visible = showAll ? rows : rows.slice(0, SHOWN);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => add([blank()])}>
          <Plus /> Add row
        </Button>
        <Button size="sm" variant="outline" onClick={() => file.current?.click()}>
          <FileUp /> Import CSV / Excel
        </Button>
        <input
          ref={file}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          aria-label="Invite list file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
        <Button size="sm" variant="ghost" onClick={() => downloadCsv("invite-template.csv", INVITE_TEMPLATE)}>
          <Download /> Template
        </Button>
        <span className="mx-1 hidden h-5 border-l sm:inline" />
        <span className="flex flex-wrap items-center gap-1">
          <select aria-label="Group" className={selectClass} value={group} onChange={(e) => setGroup(e.target.value as "teachers" | "hods")}>
            <option value="teachers">Teachers not yet invited</option>
            <option value="hods">One HOD per department</option>
          </select>
          <select aria-label="Group department" className={selectClass} value={groupDept} onChange={(e) => setGroupDept(e.target.value)}>
            <option value="">All departments</option>
            {lk.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={addGroup}>
            <Users /> Add group
          </Button>
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-2 py-1.5">#</th>
              <th className="px-2 py-1.5">Name</th>
              <th className="px-2 py-1.5">Email (optional)</th>
              <th className="px-2 py-1.5">Role and link</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map((r, i) => {
              const problem = filled.includes(r) ? problems.get(r.key) : null;
              return (
                <tr key={r.key} className="align-top">
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1">
                    <Input aria-label={`Name, row ${i + 1}`} className="h-8 min-w-40" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <Input aria-label={`Email, row ${i + 1}`} type="email" className="h-8 min-w-44" value={r.email} onChange={(e) => update(r.key, { email: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-1">
                      <RoleFields value={r} onChange={(v) => update(r.key, v)} {...lk} />
                    </div>
                    {problem && <p className={cn("mt-0.5 text-xs", problem.startsWith("Skipped") ? "text-muted-foreground" : "text-destructive")}>{problem}</p>}
                  </td>
                  <td className="px-1 py-1">
                    <Button size="xs" variant="ghost" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > SHOWN && !showAll && (
          <button className="w-full border-t px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50" onClick={() => setShowAll(true)}>
            {rows.length - SHOWN} more rows (all of them will be invited). Show all
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || !creatable || blocking > 0} onClick={submit}>
          {pending ? <Loader2 className="animate-spin" /> : <UserPlus />} Create {creatable || ""} invite{creatable === 1 ? "" : "s"}
        </Button>
        {filled.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => (setRows([blank(), blank(), blank()]), setMsg(null))}>
            Clear
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {blocking > 0
            ? `${blocking} row${blocking === 1 ? " needs" : "s need"} fixing first.`
            : "Teachers without an email get the one from their teacher record. People who already have an account or an open invite are skipped."}
        </span>
      </div>
      {msg && (
        <div className={cn("text-sm", msg.ok ? "text-muted-foreground" : "text-destructive")}>
          <p>{msg.text}</p>
          {msg.list && (
            <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-xs">
              {msg.list.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
