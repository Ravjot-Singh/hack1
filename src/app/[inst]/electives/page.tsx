import { Suspense } from "react";
import { ChoicePicker, WindowEditor, type OfferingView } from "@/components/electives/electives";
import { NoAccess } from "@/components/no-access";
import { PageSkeleton } from "@/components/page-skeleton";
import { Badge } from "@/components/ui/badge";
import { checkPage } from "@/lib/access";
import { todayIso } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { countChoices, windowState } from "@/lib/electives";

export default function ElectivesPage({ params }: PageProps<"/[inst]/electives">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Electives</h1>
        <p className="text-muted-foreground">
          Each elective basket runs its electives at the same time, and every student of its sections takes one. Open registration with
          seat limits; when it closes, the counts become the class sizes the timetable plans rooms for.
        </p>
      </div>
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Baskets params={params} />
      </Suspense>
    </div>
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const STATE = { upcoming: "Opens soon", open: "Open", closed: "Closed" } as const;

async function Baskets({ params }: Pick<PageProps<"/[inst]/electives">, "params">) {
  const { inst: slug } = await params;
  const access = await checkPage(slug);
  if ("denied" in access) return <NoAccess reason={access.denied} next={`/${slug}/electives`} />;
  const configure = access.can("electives.configure");
  const register = access.can("electives.register");
  if (!configure && !register) return <NoAccess reason="role" next={`/${slug}/electives`} />;
  const m = access.member!;
  const today = todayIso();

  const baskets = await prisma.electiveBasket.findMany({
    where: { institutionId: access.inst.id },
    include: {
      sections: { select: { id: true, name: true, size: true, departmentId: true }, orderBy: { name: "asc" } },
      offerings: { include: { subject: { select: { code: true, name: true } }, teachers: { select: { name: true } } } },
      window: true,
      choices: { select: { offeringId: true, studentId: true, sectionId: true } },
    },
    orderBy: { name: "asc" },
  });
  const visible = baskets.filter((b) =>
    configure
      ? m.role === "INSTITUTE_ADMIN" || (!!m.departmentId && b.sections.length > 0 && b.sections.every((s) => s.departmentId === m.departmentId))
      : !!m.sectionId && b.sections.some((s) => s.id === m.sectionId) && !!b.window,
  );
  if (!visible.length) {
    return (
      <p className="text-muted-foreground">
        {configure
          ? m.role === "HOD"
            ? "No elective basket is limited to your department; the Institute Admin runs cross-department baskets."
            : "No elective baskets yet. Create one in Setup → Allocation."
          : "No elective registration for your section right now."}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {visible.map((b) => {
        const counts = countChoices(b.choices);
        const seats = (b.window?.seats ?? {}) as Record<string, number>;
        const offerings: OfferingView[] = b.offerings
          .map((o) => ({
            id: o.id,
            code: o.subject.code,
            name: o.subject.name,
            teachers: o.teachers.map((t) => t.name).join(", "),
            count: counts[o.id] ?? 0,
            seats: seats[o.id] ?? null,
            size: o.expectedSize,
          }))
          .sort((x, y) => x.code.localeCompare(y.code));
        const total = b.sections.reduce((n, s) => n + s.size, 0);
        const state = b.window ? windowState({ opensOn: iso(b.window.opensOn), closesOn: iso(b.window.closesOn), seats }, today) : null;
        const header = (
          <header className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{b.name}</h2>
            {state && <Badge variant={state === "open" ? "default" : "outline"}>{STATE[state]}</Badge>}
            {b.window && (
              <span className="text-sm text-muted-foreground">
                {iso(b.window.opensOn)} to {iso(b.window.closesOn)}
              </span>
            )}
          </header>
        );

        if (!configure) {
          const current = b.choices.find((c) => c.studentId === access.user!.id)?.offeringId ?? null;
          return (
            <article key={b.id} className="space-y-3 rounded-lg border p-4">
              {header}
              {state === "upcoming" && <p className="text-sm text-muted-foreground">You can choose from {iso(b.window!.opensOn)}.</p>}
              {state === "closed" && <p className="text-sm text-muted-foreground">Registration is closed{current ? "" : " and you didn't choose; the department will assign you"}.</p>}
              <ChoicePicker slug={slug} basketId={b.id} open={state === "open"} offerings={offerings} current={current} />
            </article>
          );
        }

        const registered = b.choices.length;
        const bySection = b.sections.map((s) => ({ ...s, done: b.choices.filter((c) => c.sectionId === s.id).length }));
        return (
          <article key={b.id} className="space-y-4 rounded-lg border p-4">
            {header}
            <p className="text-sm text-muted-foreground">
              {registered} of {total} students registered ·{" "}
              {bySection.map((s) => (
                <span key={s.id} className="mr-2 inline-block">
                  {s.name} {s.done}/{s.size}
                </span>
              ))}
              {b.window?.appliedAt && <span className="block text-xs">Class sizes last updated from the counts on {iso(b.window.appliedAt)}.</span>}
            </p>
            <WindowEditor
              slug={slug}
              basketId={b.id}
              window={b.window ? { opensOn: iso(b.window.opensOn), closesOn: iso(b.window.closesOn) } : null}
              offerings={offerings}
              total={total}
              registered={registered}
            />
          </article>
        );
      })}
    </div>
  );
}
