"use client";

import { useRouter } from "next/navigation";
import type { SourceKind } from "@/lib/source-kind";
import { ProblemList } from "./problem-list";
import { SpecInput } from "./spec-input";
import { StageHeader } from "./stage-header";
import { useWorkflow } from "./workflow-context";

/**
 * Stage 1: choose how to provide the API description (paste, upload, or URL),
 * then provide it. A valid one opens endpoint selection.
 */
export function SpecScreen() {
  const router = useRouter();
  const { inputMethod, setInputMethod, resetInput, specText, setSpecText, validate, validation } = useWorkflow();

  const submit = async (text: string, kind?: SourceKind) => {
    if (await validate(text, kind)) router.push("/select");
  };

  return (
    <section className="flex flex-col gap-4">
      <StageHeader stage={0} title="Provide an API description" />
      <SpecInput
        method={inputMethod}
        onChooseMethod={setInputMethod}
        onBack={resetInput}
        value={specText}
        onChange={setSpecText}
        onSubmit={(text, kind) => void submit(text, kind)}
        isValidating={validation.status === "validating"}
      />
      {inputMethod !== null && validation.status === "invalid" ? (
        <ProblemList title="The specification cannot be used" problems={validation.errors} />
      ) : null}
    </section>
  );
}
