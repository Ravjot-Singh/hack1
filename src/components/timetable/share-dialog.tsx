"use client";

import { useState, useTransition } from "react";
import QRCode from "qrcode";
import { Check, Copy, ExternalLink, Loader2, Printer, Share2, Trash2 } from "lucide-react";
import { createShareLink, revokeShareLink } from "@/app/[inst]/timetables/actions";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ExplorerContext } from "./timetable-explorer";

const WHAT: Record<ExplorerContext["view"], string> = { section: "class", teacher: "faculty", room: "room" };

/** Create a public read-only link (and QR code) for the timetable being viewed, or the whole college. */
export function ShareDialog({ slug, versionId, current }: { slug: string; versionId: string; current: ExplorerContext }) {
  const [scope, setScope] = useState<"one" | "all">("one");
  const [link, setLink] = useState<{ token: string; url: string; qr: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      setError(null);
      const res = await createShareLink(slug, versionId, scope === "one" ? current.view : null, scope === "one" ? current.entityId : null);
      if (!res.ok) return setError(res.error);
      const url = `${window.location.origin}/s/${res.token}`;
      const qr = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      setLink({ token: res.token, url, qr });
    });

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const revoke = () =>
    start(async () => {
      if (!link) return;
      await revokeShareLink(slug, link.token);
      setLink(null);
    });

  return (
    <Dialog onOpenChange={(open) => !open && (setLink(null), setError(null))}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Share2 /> Share
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share timetable</DialogTitle>
          <DialogDescription>
            Anyone with the link can view it without logging in. Paste it in a WhatsApp group or print the QR code for a
            notice board or classroom door.
          </DialogDescription>
        </DialogHeader>

        {!link ? (
          <div className="space-y-2 text-sm">
            {(
              [
                ["one", `Only ${current.entityName}`, `The ${WHAT[current.view]} timetable you're looking at.`],
                ["all", "The whole college", "Viewers can pick any section, teacher or room."],
              ] as const
            ).map(([value, label, help]) => (
              <label
                key={value}
                className={cn("flex cursor-pointer gap-2 rounded-lg border p-3", scope === value && "border-primary bg-muted/40")}
              >
                <input type="radio" name="scope" className="mt-0.5 accent-primary" checked={scope === value} onChange={() => setScope(value)} />
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="block text-muted-foreground">{help}</span>
                </span>
              </label>
            ))}
            {error && <p className="text-destructive">{error}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input readOnly value={link.url} aria-label="Share link" onFocus={(e) => e.target.select()} />
              <Button variant="outline" size="icon" onClick={copy} aria-label="Copy link">
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <div className="mx-auto w-48 rounded-lg border bg-white p-2" dangerouslySetInnerHTML={{ __html: link.qr }} />
            <div className="flex flex-wrap justify-center gap-2">
              <a className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline" href={link.url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" /> Open
              </a>
              <a
                className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
                href={`/s/${link.token}/poster`}
                target="_blank"
                rel="noreferrer"
              >
                <Printer className="size-3.5" /> Print QR poster
              </a>
            </div>
          </div>
        )}

        <DialogFooter>
          {link ? (
            <Button variant="outline" onClick={revoke} disabled={pending}>
              <Trash2 /> Stop sharing
            </Button>
          ) : (
            <Button onClick={create} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Share2 />} Create link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
