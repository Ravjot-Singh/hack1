"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { acceptInvite } from "@/app/invite/[token]/actions";
import { Button } from "@/components/ui/button";

export function AcceptInvite({ token, userName }: { token: string; userName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await acceptInvite(token);
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />} Join as {userName}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
