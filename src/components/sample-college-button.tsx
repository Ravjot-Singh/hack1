"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { createDemoCopy } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** Shows that the copy is being made: it takes a few seconds and must not be clicked twice. */
function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button size="lg" type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" /> Making your copy…
        </>
      ) : (
        <>
          Try it with a sample college <ArrowRight />
        </>
      )}
    </Button>
  );
}

/**
 * "Try it with a sample college". Visitors who aren't signed in are sent to sign up and come
 * back here with ?start=sample; the copy is then made straight away, so they don't have to
 * find and press the button a second time.
 */
export function SampleCollegeButton() {
  const form = useRef<HTMLFormElement>(null);
  const started = useRef(false);
  const resume = useSearchParams().get("start") === "sample";
  useEffect(() => {
    if (resume && !started.current) {
      started.current = true;
      form.current?.requestSubmit();
    }
  }, [resume]);
  return (
    <form ref={form} action={createDemoCopy}>
      <Submit />
    </form>
  );
}
