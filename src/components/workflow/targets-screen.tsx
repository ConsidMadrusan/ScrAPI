"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { PROJECT_MODES, type ProjectMode } from "@/lib/validation/requests";
import { StageHeader } from "./stage-header";
import { TargetPicker } from "./target-picker";
import { useRedirect } from "./use-redirect";
import { useWorkflow } from "./workflow-context";

/** Stage 3: choose the framework combinations and start generating. */
export function TargetsScreen() {
  const router = useRouter();
  const { validation, selected, combinations, setCombinations, project, setProject, generate } = useWorkflow();
  const ready = validation.status === "valid" && selected.size > 0;
  useRedirect(!ready, validation.status === "valid" ? "/select" : "/");
  if (!ready) return null;

  return (
    <section className="flex flex-col gap-4">
      <StageHeader stage={2} title="Choose frameworks" />
      <p className="text-sm">
        {selected.size} {selected.size === 1 ? "operation" : "operations"} selected.
      </p>
      <ProjectPicker value={project} onChange={setProject} />
      <TargetPicker value={combinations} onChange={setCombinations} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/select" className={buttonVariants({ variant: "outline" })}>
          Back
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {combinations.length === 0 ? (
            <span className="text-muted-foreground text-sm">Choose at least one framework.</span>
          ) : null}
          <Button
            disabled={combinations.length === 0}
            onClick={() => {
              generate();
              router.push("/generating");
            }}
          >
            Generate
          </Button>
        </div>
      </div>
    </section>
  );
}

const PROJECT_OPTIONS: Record<ProjectMode, { label: string; description: string }> = {
  existing: {
    label: "Existing project",
    description: "Add the generated code to a project you already have.",
  },
  new: {
    label: "New project",
    description: "Start from scratch: the guide begins with the commands that create the project.",
  },
};

const optionClass =
  "has-checked:border-primary has-checked:bg-muted has-focus-visible:ring-ring/50 flex cursor-pointer gap-3 rounded-lg border p-3 has-focus-visible:ring-3";

function ProjectPicker({ value, onChange }: { value: ProjectMode; onChange: (value: ProjectMode) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">Where will you use the code?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {PROJECT_MODES.map((mode) => (
          <label key={mode} className={optionClass}>
            <input
              type="radio"
              name="project-mode"
              value={mode}
              checked={value === mode}
              onChange={() => {
                onChange(mode);
              }}
              className="mt-1"
            />
            <span className="flex flex-col">
              <span className="font-medium">{PROJECT_OPTIONS[mode].label}</span>
              <span className="text-muted-foreground text-sm">{PROJECT_OPTIONS[mode].description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
