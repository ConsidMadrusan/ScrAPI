"use client";

import { CircleCheck, Download, ListChecks, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ARCHIVE_FILE_NAME } from "@/lib/archive/names";
import { renderChainedGuide } from "@/lib/guides/chained";
import { GUIDE_FILE_NAME } from "@/lib/guides/markdown";
import { combinationKey, combinationLabel } from "@/lib/targets/catalog";
import { ProblemList } from "./problem-list";
import { StageHeader } from "./stage-header";
import { useRedirect } from "./use-redirect";
import { isSettled, successfulResults, useWorkflow, type DownloadState } from "./workflow-context";

const cardClass =
  "flex flex-col items-start gap-2 rounded-lg border p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const interactiveCardClass = `${cardClass} hover:bg-muted disabled:cursor-wait disabled:opacity-70`;

/** Stage 5: choose between downloading every generated client as one ZIP and the step-by-step guide. */
export function ImplementScreen() {
  const { runs, project, retry, download, downloadErrors, downloadZip } = useWorkflow();
  const results = useMemo(() => successfulResults(runs), [runs]);
  const stepCount = useMemo(
    () =>
      results.length > 0
        ? renderChainedGuide(results, project).sections.reduce((sum, section) => sum + section.guide.steps.length, 0)
        : 0,
    [results, project],
  );

  const running = runs?.some((run) => !isSettled(run)) ?? false;
  useRedirect(runs === null || (results.length === 0 && !running), "/targets");
  if (runs === null || results.length === 0) return null;

  const fileCount = results.reduce((sum, result) => sum + result.files.length, 0);
  const operationCount = results[0]?.operations.length ?? 0;

  return (
    <section className="flex flex-col gap-6">
      <StageHeader stage={3} title="Implement" />
      <p>
        Generated {fileCount} files for {results.length}{" "}
        {results.length === 1 ? "framework combination" : "framework combinations"} from {operationCount} selected
        operations. How do you want to add them to your project?
      </p>

      {runs.map((run) => {
        const key = combinationKey(run.options);
        if (run.status === "failed") {
          return (
            <div key={key} className="flex flex-col gap-2">
              <ProblemList title={`${combinationLabel(run.options)} could not be generated`} problems={run.errors} />
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={running}
                  onClick={() => {
                    retry(key);
                  }}
                >
                  Retry {combinationLabel(run.options)}
                </Button>
              </div>
            </div>
          );
        }
        if (run.status !== "done") {
          return (
            <p key={key} className="text-muted-foreground text-sm">
              Generating {combinationLabel(run.options)} again…
            </p>
          );
        }
        return null;
      })}

      <div className="grid gap-3 sm:grid-cols-2">
        <ZipCard state={download} onDownload={() => void downloadZip()} />
        <Link href="/implement/guide" className={`${cardClass} hover:bg-muted`}>
          <span className="flex items-center gap-2 font-medium">
            <ListChecks aria-hidden className="size-4" />
            Step-by-step guide
          </span>
          <span className="text-muted-foreground text-sm">
            Add the files to your projects one step at a time: {stepCount} steps covering every framework combination.
          </span>
        </Link>
      </div>

      <p role="status" className="sr-only">
        {STATUS_MESSAGES[download]}
      </p>
      {download === "failed" ? (
        <ProblemList title="The ZIP file could not be created" problems={downloadErrors} />
      ) : null}

      <div>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Start over
        </Link>
      </div>
    </section>
  );
}

const STATUS_MESSAGES: Record<DownloadState, string> = {
  idle: "",
  downloading: "Preparing the ZIP file…",
  downloaded: "ZIP downloaded.",
  failed: "",
};

function ZipCard({ state, onDownload }: { state: DownloadState; onDownload: () => void }) {
  if (state === "downloaded") {
    return (
      <div className={`${cardClass} border-emerald-600/50 bg-emerald-50 dark:border-emerald-400/40 dark:bg-emerald-950`}>
        <span className="flex items-center gap-2 font-medium">
          <CircleCheck aria-hidden className="size-4 text-emerald-600 dark:text-emerald-400" />
          ZIP downloaded
        </span>
        <span className="text-muted-foreground text-sm">
          <code className="font-mono">{ARCHIVE_FILE_NAME}</code> is in your downloads folder.
        </span>
        <button
          type="button"
          onClick={onDownload}
          className="text-sm underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Download again
        </button>
      </div>
    );
  }

  const downloading = state === "downloading";
  return (
    <button type="button" className={interactiveCardClass} disabled={downloading} onClick={onDownload}>
      <span className="flex items-center gap-2 font-medium">
        {downloading ? (
          <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
        ) : (
          <Download aria-hidden className="size-4" />
        )}
        {downloading ? "Preparing ZIP…" : "Download ZIP"}
      </span>
      <span className="text-muted-foreground text-sm">
        One folder per framework combination, plus <code className="font-mono">{GUIDE_FILE_NAME}</code> with every
        step.
      </span>
    </button>
  );
}
