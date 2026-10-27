"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface CopyButtonProps {
  text: string;
  /** Accessible name, e.g. "Copy index.ts". */
  label: string;
}

export function CopyButton({ text, label }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" aria-label={label} onClick={() => void copy()}>
        Copy
      </Button>
      <span role="status" className="text-muted-foreground text-xs">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed: select the text and copy it manually" : ""}
      </span>
    </span>
  );
}
