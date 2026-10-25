"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Loader2, MessageCircle, Trash2, UserPlus, Users } from "lucide-react";
import { changeRole, createInvite, inviteAllTeachers, removeMember, revokeInvite } from "@/app/[inst]/people/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadCsv } from "@/lib/setup/files";
import { ROLE_HELP, ROLE_LABEL, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface Link {
  departmentId: string | null;
  teacherId: string | null;
  sectionId: string | null;
}
interface MemberRow extends Link {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
}
interface InviteRow extends Link {
  id: string;
  token: string;
  name: string;
  email: string | null;
  role: Role;
  expired: boolean;
}
interface Props {
  slug: string;
  me: string;
  members: MemberRow[];
  invites: InviteRow[];
  departments: { id: string; name: string; code: string }[];
  teachers: { id: string; name: string; departmentId: string }[];
  sections: { id: string; name: string }[];
}

const ROLES = Object.keys(ROLE_LABEL) as Role[];
const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

export function PeopleManager({ slug, me, members, invites, departments, teachers, sections }: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const inviteUrl = (token: string) => `${origin}/invite/${token}`;

  const describe = (l: Link & { role: Role }) =>
    [
      l.departmentId && departments.find((d) => d.id === l.departmentId)?.code,
      l.teacherId && `as ${teachers.find((t) => t.id === l.teacherId)?.name ?? "teacher"}`,
      l.sectionId && sections.find((s) => s.id === l.sectionId)?.name,
    ]
      .filter(Boolean)
      .join(" · ");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? (done ? { ok: true, text: done } : null) : { ok: false, text: res.error ?? "Something went wrong." });
      if (res.ok) router.refresh();
    });

  return (
    <div className="space-y-8">
      <InviteForm
        slug={slug}
        departments={departments}
        teachers={teachers}
        sections={sections}
        inviteUrl={inviteUrl}
        onCreated={() => router.refresh()}
      />

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Waiting to join ({invites.length})</h2>
            <p className="text-sm text-muted-foreground">Invite links work once and expire after 14 days.</p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !teachers.length}
              onClick={() =>
                start(async () => {
                  const res = await inviteAllTeachers(slug);
                  setMsg(res.ok ? { ok: true, text: `Created ${res.created} teacher invite${res.created === 1 ? "" : "s"}.` } : { ok: false, text: res.error });
                  router.refresh();
                })
              }
            >
              <Users /> Invite all teachers
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!invites.length}
              onClick={() =>
                downloadCsv("invite-links.csv", [
                  ["name", "email", "role", "link"],
                  ...invites.map((i) => [i.name, i.email ?? "", ROLE_LABEL[i.role], inviteUrl(i.token)]),
                ])
              }
            >
              <Download /> Export links
            </Button>
          </div>
        </div>
        {msg && <p className={cn("text-sm", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</p>}
        {invites.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium">{i.name}</span>
                <span className="text-muted-foreground">
                  {ROLE_LABEL[i.role]}
                  {describe(i) && ` · ${describe(i)}`}
                </span>
                {i.expired && <span className="text-xs text-destructive">expired</span>}
                <span className="ml-auto flex gap-1">
                  <CopyButton text={inviteUrl(i.token)} />
                  <a
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs hover:bg-muted"
                    href={`https://wa.me/?text=${encodeURIComponent(`Join our college timetable as ${ROLE_LABEL[i.role]}: ${inviteUrl(i.token)}`)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle className="size-3.5" /> WhatsApp
                  </a>
                  <Button size="xs" variant="ghost" aria-label={`Revoke invite for ${i.name}`} onClick={() => run(() => revokeInvite(slug, i.id))}>
                    <Trash2 />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Members ({members.length})</h2>
        <ul className="divide-y rounded-lg border">
          {members.map((m) => (
            <MemberItem
              key={m.id}
              m={m}
              isMe={m.userId === me}
              departments={departments}
              teachers={teachers}
              sections={sections}
              pending={pending}
              onSave={(link) => run(() => changeRole(slug, m.id, link), `Updated ${m.name}.`)}
              onRemove={() => confirm(`Remove ${m.name} from this college?`) && run(() => removeMember(slug, m.id), `Removed ${m.name}.`)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function RoleFields({
  value,
  onChange,
  departments,
  teachers,
  sections,
}: {
  value: Link & { role: Role };
  onChange: (v: Link & { role: Role }) => void;
  departments: Props["departments"];
  teachers: Props["teachers"];
  sections: Props["sections"];
}) {
  return (
    <>
      <select
        aria-label="Role"
        className={selectClass}
        value={value.role}
        onChange={(e) => onChange({ ...value, role: e.target.value as Role })}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      {(value.role === "HOD" || value.role === "LAB_ASSISTANT") && (
        <select aria-label="Department" className={selectClass} value={value.departmentId ?? ""} onChange={(e) => onChange({ ...value, departmentId: e.target.value || null })}>
          <option value="">{value.role === "HOD" ? "Department…" : "Common labs (no department)"}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} · {d.name}
            </option>
          ))}
        </select>
      )}
      {(value.role === "TEACHER" || value.role === "HOD") && (
        <select aria-label="Teacher record" className={selectClass} value={value.teacherId ?? ""} onChange={(e) => onChange({ ...value, teacherId: e.target.value || null })}>
          <option value="">{value.role === "HOD" ? "Also teaches as… (optional)" : "Which teacher…"}</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {value.role === "STUDENT" && (
        <select aria-label="Section" className={selectClass} value={value.sectionId ?? ""} onChange={(e) => onChange({ ...value, sectionId: e.target.value || null })}>
          <option value="">Section…</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

function InviteForm({
  slug,
  departments,
  teachers,
  sections,
  inviteUrl,
  onCreated,
}: Pick<Props, "slug" | "departments" | "teachers" | "sections"> & { inviteUrl: (t: string) => string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<Link & { role: Role }>({ role: "TEACHER", departmentId: null, teacherId: null, sectionId: null });
  const [created, setCreated] = useState<{ name: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const res = await createInvite(slug, { name, email, ...link });
      if (!res.ok) return setError(res.error);
      setCreated({ name, url: inviteUrl(res.token) });
      setName("");
      setEmail("");
      onCreated();
    });
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <UserPlus className="size-5" /> Invite someone
      </h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="inv-name">Name</Label>
          <Input id="inv-name" className="h-8 w-52" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-email">Email (optional)</Label>
          <Input id="inv-email" type="email" className="h-8 w-56" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <RoleFields
          value={link}
          onChange={(v) => {
            setLink(v);
            // Picking a teacher record fills in the name.
            const t = teachers.find((x) => x.id === v.teacherId);
            if (t && v.teacherId !== link.teacherId) setName(t.name);
          }}
          departments={departments}
          teachers={teachers}
          sections={sections}
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <UserPlus />} Create invite link
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">{ROLE_HELP[link.role]}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {created && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-sm">
          <span>Link for {created.name}:</span>
          <code className="min-w-0 flex-1 truncate">{created.url}</code>
          <CopyButton text={created.url} />
        </div>
      )}
    </section>
  );
}

function MemberItem({
  m,
  isMe,
  departments,
  teachers,
  sections,
  pending,
  onSave,
  onRemove,
}: {
  m: MemberRow;
  isMe: boolean;
  departments: Props["departments"];
  teachers: Props["teachers"];
  sections: Props["sections"];
  pending: boolean;
  onSave: (v: Link & { role: Role }) => void;
  onRemove: () => void;
}) {
  const initial = { role: m.role, departmentId: m.departmentId, teacherId: m.teacherId, sectionId: m.sectionId };
  const [value, setValue] = useState(initial);
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <span className="min-w-48">
        <span className="font-medium">{m.name}</span>
        {isMe && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
        <span className="block text-xs text-muted-foreground">{m.email}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <RoleFields value={value} onChange={setValue} departments={departments} teachers={teachers} sections={sections} />
      </span>
      <span className="ml-auto flex gap-1">
        {changed && (
          <Button size="xs" disabled={pending} onClick={() => onSave(value)}>
            <Check /> Save
          </Button>
        )}
        <Button size="xs" variant="ghost" aria-label={`Remove ${m.name}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </span>
    </li>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check /> : <Copy />} {done ? "Copied" : "Copy link"}
    </Button>
  );
}
