import { getInstitution } from "@/lib/inst";
import { loadInstituteInput } from "@/lib/institute";
import { SolvePanel } from "@/components/solve-panel";

export default async function SolvePage({ params }: PageProps<"/[inst]/solve">) {
  const { inst: slug } = await params;
  const inst = await getInstitution(slug);
  const input = await loadInstituteInput(inst.id);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Generate timetable</h1>
        <p className="text-muted-foreground">
          One solve for the whole institute, so shared rooms and labs are split fairly between departments. It runs in
          your browser, and the server checks every rule again before saving.
        </p>
      </div>
      <SolvePanel slug={slug} input={input} />
    </div>
  );
}
