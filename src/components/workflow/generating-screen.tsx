"use client";

import { CircleCheck, CircleX, Circle, LoaderCircle } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePrefersReducedMotion } from "@/components/guide/use-prefers-reduced-motion";
import { Button } from "@/components/ui/button";
import { combinationKey, combinationLabel } from "@/lib/targets/catalog";
import { ProblemList } from "./problem-list";
import { StageHeader } from "./stage-header";
import { useRedirect } from "./use-redirect";
import { isSettled, useWorkflow, type Run } from "./workflow-context";

/**
 * Stage 4: progress of the generation run. Opens the implementation screen
 * once every combination has finished and at least one succeeded.
 */
export function GeneratingScreen() {
  const router = useRouter();
  const { runs, generate, cancelGeneration } = useWorkflow();
  const settled = runs?.every(isSettled) ?? false;
  const anyDone = runs?.some((run) => run.status === "done") ?? false;

  useRedirect(runs === null, "/targets");
  useEffect(() => {
    if (settled && anyDone) router.replace("/implement");
  }, [settled, anyDone, router]);

  if (runs === null) return null;
  const finished = runs.filter(isSettled).length;
  const allFailed = settled && !anyDone;

  return (
    <section className="flex flex-col gap-4">
      <StageHeader stage={3} title={allFailed ? "Generation failed" : "Generating your clients"} />
      <p role="status" className="text-sm">
        {finished} of {runs.length} {runs.length === 1 ? "combination" : "combinations"} finished
      </p>
      <ul className="flex flex-col gap-2">
        {runs.map((run) => (
          <li key={combinationKey(run.options)} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
            <RunIcon run={run} />
            <span className="flex-1">{combinationLabel(run.options)}</span>
            <span className="text-muted-foreground">{STATUS_TEXT[run.status]}</span>
          </li>
        ))}
      </ul>

      {allFailed ? (
        <>
          {runs.map((run) =>
            run.status === "failed" ? (
              <ProblemList
                key={combinationKey(run.options)}
                title={`${combinationLabel(run.options)} could not be generated`}
                problems={run.errors}
              />
            ) : null,
          )}
          <div className="flex flex-wrap justify-between gap-3">
            <Button
              variant="outline"
              onClick={() => {
                router.push("/targets");
              }}
            >
              Back
            </Button>
            <Button onClick={generate}>Try again</Button>
          </div>
        </>
      ) : (
        <div>
          <Button variant="outline" onClick={cancelGeneration}>
            Cancel
          </Button>
        </div>
      )}
    </section>
  );
}

const STATUS_TEXT: Record<Run["status"], string> = {
  pending: "Waiting",
  running: "Generating…",
  done: "Done",
  failed: "Failed",
};

function RunIcon({ run }: { run: Run }) {
  const reduceMotion = usePrefersReducedMotion();
  switch (run.status) {
    case "pending":
      return <Circle aria-hidden className="text-muted-foreground size-5" />;
    case "running":
      if (reduceMotion) return <LoaderCircle aria-hidden className="size-5" />;
      return (
        <motion.span
          aria-hidden
          className="inline-flex"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <LoaderCircle className="size-5" />
        </motion.span>
      );
    case "done":
      return <CircleCheck aria-hidden className="size-5 text-emerald-600 dark:text-emerald-400" />;
    case "failed":
      return <CircleX aria-hidden className="text-destructive size-5" />;
  }
}
