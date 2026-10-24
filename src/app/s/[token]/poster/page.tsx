import { Suspense } from "react";
import { headers } from "next/headers";
import QRCode from "qrcode";
import type { Metadata } from "next";
import { PrintButton } from "@/components/print-button";
import { getShared } from "@/lib/share";

export const metadata: Metadata = { title: "Timetable QR poster", robots: { index: false, follow: false } };

export default function PosterPage({ params }: PageProps<"/s/[token]/poster">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <Suspense fallback={<div className="size-72 animate-pulse rounded-xl bg-muted" />}>
        <Poster params={params} />
      </Suspense>
    </main>
  );
}

async function Poster({ params }: Pick<PageProps<"/s/[token]/poster">, "params">) {
  const { token } = await params;
  const s = await getShared(token);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = `${proto}://${host}/s/${token}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <>
      <div>
        <div className="text-lg text-muted-foreground">{s.collegeName}</div>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">{s.version?.title ?? "Timetable"}</h1>
      </div>
      <div className="w-full max-w-sm rounded-2xl border-2 bg-white p-4" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="space-y-1">
        <p className="text-xl font-medium">
          {s.follows ? "Scan for the latest timetable" : "Scan to see this timetable on your phone"}
        </p>
        <p className="break-all text-sm text-muted-foreground">{url}</p>
      </div>
      <PrintButton />
    </>
  );
}
