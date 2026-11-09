"use client";

import { useRouter } from "next/navigation";
import { ProblemList } from "./problem-list";
import { SpecInput } from "./spec-input";
import { StageHeader } from "./stage-header";
import { useWorkflow } from "./workflow-context";

/** Stage 1: paste or upload a specification. A valid one opens endpoint selection. */
export function SpecScreen() {
  const router = useRouter();
  const { specText, setSpecText, validate, validation } = useWorkflow();

  const submit = async (text: string) => {
    if (await validate(text)) router.push("/select");
  };

  return (
    <section className="flex flex-col gap-4">
      <StageHeader stage={0} title="Provide a specification" />
      <SpecInput
        value={specText}
        onChange={setSpecText}
        onSubmit={(text) => void submit(text)}
        isValidating={validation.status === "validating"}
      />
      {validation.status === "invalid" ? (
        <ProblemList title="The specification cannot be used" problems={validation.errors} />
      ) : null}
    </section>
  );
}
