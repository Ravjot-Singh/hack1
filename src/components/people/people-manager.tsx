"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Check, ClipboardList, Copy, Download, Loader2, MessageCircle, Send, Trash2, UserPlus } from "lucide-react";
import { changeRole, createInvite, markSent, removeMember, resendInvites, revokeInvite } from "@/app/[inst]/people/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { linksTable, shareText } from "@/lib/invites";
import { downloadCsv } from "@/lib/setup/files";
import { ROLE_HELP, ROLE_LABEL } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { BulkInvite } from "./bulk-invite";
import { RoleFields, type PeopleLookups, type RoleLink } from "./role-fields";

interface MemberRow extends RoleLink {
  id: string;
  userId: string;
  name: string;
  email: string;
}
interface InviteRow extends RoleLink {
  id: string;
  token: string;
  name: string;
  email: string | null;
  expired: boolean;
  /** ISO time the link was last handed out; null = never sent. */
  sentAt: string | null;
}
interface Props extends PeopleLookups {
  slug: string;
  me: string;
  members: MemberRow[];
  invites: InviteRow[];
}

export function PeopleManager({ slug, me, members, invites, departments, teachers, sections }: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mode, setMode] = useState<"one" | "many">("one");
  const [pending, start] = useTransition();
  // Read after hydration so server and client render the same links.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const inviteUrl = (token: string) => `${origin}/invite/${token}`;
  const lk = { departments, teachers, sections };

  const taken = {
    emails: new Set([...members.map((m) => m.email.toLowerCase()), ...invites.flatMap((i) => (i.email ? [i.email.toLowerCase()] : []))]),
    teacherIds: new Set([...members, ...invites].flatMap((x) => (x.teacherId ? [x.teacherId] : []))),
  };
  const unsent = invites.filter((i) => !i.sentAt);
  const sent = invites.filter((i) => i.sentAt);

  const describe = (l: RoleLink) =>
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

  /** Hand out a batch of links: as a CSV for mail merge, or copied as ready-to-paste messages. */
  const share = (list: InviteRow[], how: "csv" | "copy", file = "invite-links.csv") =>
    start(async () => {
      if (how === "csv") downloadCsv(file, linksTable(list, inviteUrl));
      else if (!(await copyText(list.map((i) => `${i.name}: ${shareText(i.role, inviteUrl(i.token))}`).join("\n")))) {
        return setMsg({ ok: false, text: "This browser blocked copying. Use Download new links instead." });
      }
      const res = await markSent(slug, list.map((i) => i.id));
      setMsg(
        res.ok
          ? { ok: true, text: `${how === "csv" ? "Downloaded" : "Copied"} ${list.length} link${list.length === 1 ? "" : "s"}; they now count as sent.` }
          : { ok: false, text: res.error },
      );
      router.refresh();
    });

  const resend = () =>
    confirm(`Send a reminder to the ${sent.length} people who were sent a link but haven't joined? Their links get a fresh 14 days.`) &&
    start(async () => {
      const res = await resendInvites(slug);
      if (!res.ok) return setMsg({ ok: false, text: res.error });
      downloadCsv("invite-reminders.csv", linksTable(res.invites, inviteUrl));
      setMsg({ ok: true, text: `Renewed ${res.invites.length} link${res.invites.length === 1 ? "" : "s"} for 14 days and downloaded them as invite-reminders.csv.` });
      router.refresh();
    });

  return (
    <div className="space-y-8">
      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UserPlus className="size-5" /> Invite people
          </h2>
          <div className="inline-flex rounded-md border p-0.5 text-sm" role="tablist">
            {(["one", "many"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                className={cn("rounded px-3 py-1", mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                onClick={() => setMode(m)}
              >
                {m === "one" ? "One person" : "Several people"}
              </button>
            ))}
          </div>
        </div>
        {mode === "one" ? (
          <InviteForm slug={slug} {...lk} inviteUrl={inviteUrl} onCreated={() => router.refresh()} />
        ) : (
          <BulkInvite slug={slug} {...lk} taken={taken} onCreated={() => router.refresh()} />
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Waiting to join ({invites.length})</h2>
            <p className="text-sm text-muted-foreground">
              {unsent.length} not sent yet · {sent.length} sent. Links work once and expire after 14 days.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || !unsent.length} onClick={() => share(unsent, "csv", "new-invite-links.csv")}>
              <Send /> Download new links ({unsent.length})
            </Button>
            <Button size="sm" variant="outline" disabled={pending || !unsent.length} onClick={() => share(unsent, "copy")}>
              <ClipboardList /> Copy new links
            </Button>
            <Button size="sm" variant="outline" disabled={pending || !sent.length} onClick={resend}>
              <BellRing /> Remind not joined ({sent.length})
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!invites.length}
              title="All open links, without changing what counts as sent"
              onClick={() => downloadCsv("invite-links.csv", linksTable(invites, inviteUrl))}
            >
              <Download /> Export all
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The CSV has each person&apos;s name, email, link and a ready message, for a mail merge (e.g. Gmail or Outlook) or a WhatsApp broadcast.
        </p>
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
                {i.expired ? (
                  <span className="text-xs text-destructive">expired</span>
                ) : (
                  <span className="text-xs text-muted-foreground">{i.sentAt ? `sent ${new Date(i.sentAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "not sent"}</span>
                )}
                <span className="ml-auto flex gap-1">
                  <CopyButton text={inviteUrl(i.token)} onCopied={() => {
                      if (!i.sentAt) void markSent(slug, [i.id]).then(() => router.refresh());
                    }}
                  />
                  <a
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs hover:bg-muted"
                    href={`https://wa.me/?text=${encodeURIComponent(shareText(i.role, inviteUrl(i.token)))}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => void markSent(slug, [i.id]).then(() => router.refresh())}
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
              lk={lk}
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

function InviteForm({ slug, inviteUrl, onCreated, ...lk }: PeopleLookups & { slug: string; inviteUrl: (t: string) => string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<RoleLink>({ role: "TEACHER", departmentId: null, teacherId: null, sectionId: null });
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
    <>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="w-full space-y-1 sm:w-auto">
          <Label htmlFor="inv-name">Name</Label>
          <Input id="inv-name" className="h-8 w-full sm:w-52" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-full space-y-1 sm:w-auto">
          <Label htmlFor="inv-email">Email (optional)</Label>
          <Input id="inv-email" type="email" className="h-8 w-full sm:w-56" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <RoleFields
          value={link}
          onChange={(v) => {
            setLink(v);
            // Picking a teacher record fills in the name.
            const t = lk.teachers.find((x) => x.id === v.teacherId);
            if (t && v.teacherId !== link.teacherId) setName(t.name);
          }}
          {...lk}
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
    </>
  );
}

function MemberItem({
  m,
  isMe,
  lk,
  pending,
  onSave,
  onRemove,
}: {
  m: MemberRow;
  isMe: boolean;
  lk: PeopleLookups;
  pending: boolean;
  onSave: (v: RoleLink) => void;
  onRemove: () => void;
}) {
  const initial: RoleLink = { role: m.role, departmentId: m.departmentId, teacherId: m.teacherId, sectionId: m.sectionId };
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
        <RoleFields value={value} onChange={setValue} {...lk} />
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

/** Copy to the clipboard; falls back to the older copy command where the Clipboard API is blocked. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function CopyButton({ text, onCopied }: { text: string; onCopied?: () => void }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "done" : "failed");
        if (ok) onCopied?.();
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "done" ? <Check /> : <Copy />} {state === "done" ? "Copied" : state === "failed" ? "Copy blocked" : "Copy link"}
    </Button>
  );
}
