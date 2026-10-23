import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { getInstitution } from "@/lib/inst";
import { InstNav } from "@/components/inst-nav";

export default async function InstituteLayout({ children, params }: LayoutProps<"/[inst]">) {
  const { inst: slug } = await params;
  const inst = await getInstitution(slug);
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b bg-background/80 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <CalendarRange className="size-5" />
            <span className="hidden sm:inline">Scheduling Optimizer</span>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="truncate font-medium">{inst.name}</span>
          <InstNav slug={slug} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
