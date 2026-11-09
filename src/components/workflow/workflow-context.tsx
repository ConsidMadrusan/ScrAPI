"use client";

import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ARCHIVE_FILE_NAME } from "@/lib/archive/names";
import { parseSpecification } from "@/lib/openapi/parse";
import { combinationKey, sortCombinations } from "@/lib/targets/catalog";
import type { GenerationOptions, ProjectMode } from "@/lib/validation/requests";
import type { GenerateSuccess, Problem, ValidateSuccess } from "@/lib/validation/responses";
import { requestArchive, requestGeneration, requestValidation } from "./api";

export type ValidationState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "invalid"; errors: Problem[] }
  | { status: "valid"; result: ValidateSuccess };

/** The generation of one framework combination. */
export type Run =
  | { options: GenerationOptions; status: "pending" | "running" }
  | { options: GenerationOptions; status: "done"; result: GenerateSuccess }
  | { options: GenerationOptions; status: "failed"; errors: Problem[] };

/** The ZIP of the latest successful results. */
export type DownloadState = "idle" | "downloading" | "downloaded" | "failed";

export interface WorkflowState {
  specText: string;
  validation: ValidationState;
  /** Selected operation ids (`GET /users`). */
  selected: ReadonlySet<string>;
  combinations: readonly GenerationOptions[];
  /** Whether the guide adds the code to existing projects or creates new ones. */
  project: ProjectMode;
  /** One run per combination of the latest generation, or null before generating. */
  runs: readonly Run[] | null;
  /** Reset whenever the results change, since the ZIP changes with them. */
  download: DownloadState;
  /** Builds the ZIP of the successful results on the server and saves it. */
  downloadZip: () => Promise<void>;
  /** Replaces the specification and clears everything derived from it. */
  setSpecText: (text: string) => void;
  /** Validates `text` (the current specification) and reports whether it is valid. */
  validate: (text: string) => Promise<boolean>;
  setSelected: (selected: ReadonlySet<string>) => void;
  setCombinations: (combinations: readonly GenerationOptions[]) => void;
  /** Changes the guide, so the ZIP must be downloaded again. */
  setProject: (project: ProjectMode) => void;
  /** Generates every chosen combination, one after another. */
  generate: () => void;
  /** Generates one combination of the latest run again. */
  retry: (key: string) => void;
  /** Stops a running generation and discards its runs. */
  cancelGeneration: () => void;
}

const NETWORK_ERROR: Problem[] = [
  { code: "network", message: "The server could not be reached. Check your connection and try again." },
];

const WorkflowContext = createContext<WorkflowState | null>(null);

export function useWorkflow(): WorkflowState {
  const state = use(WorkflowContext);
  if (state === null) throw new Error("useWorkflow must be used inside WorkflowProvider.");
  return state;
}

export function isSettled(run: Run): boolean {
  return run.status === "done" || run.status === "failed";
}

export function successfulResults(runs: readonly Run[] | null): GenerateSuccess[] {
  return (runs ?? []).flatMap((run) => (run.status === "done" ? [run.result] : []));
}

/**
 * Holds the workflow state in memory across the workflow routes. Nothing is
 * persisted: reloading the page starts again.
 */
export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [specText, setSpecTextState] = useState("");
  const [validation, setValidation] = useState<ValidationState>({ status: "idle" });
  const [selected, setSelectedState] = useState<ReadonlySet<string>>(new Set());
  const [combinations, setCombinationsState] = useState<readonly GenerationOptions[]>([]);
  const [project, setProjectState] = useState<ProjectMode>("existing");
  const [runs, setRuns] = useState<readonly Run[] | null>(null);
  const [download, setDownload] = useState<DownloadState>("idle");
  const pendingValidation = useRef<AbortController | null>(null);
  const pendingGeneration = useRef<AbortController | null>(null);

  /** Any change to the inputs makes generation results stale. */
  const clearRuns = useCallback(() => {
    pendingGeneration.current?.abort();
    pendingGeneration.current = null;
    setRuns(null);
    setDownload("idle");
  }, []);

  const setSpecText = useCallback(
    (text: string) => {
      // A changed specification also invalidates the validation result and the selection.
      pendingValidation.current?.abort();
      pendingValidation.current = null;
      setSpecTextState(text);
      setValidation({ status: "idle" });
      setSelectedState(new Set());
      clearRuns();
    },
    [clearRuns],
  );

  const validate = useCallback(
    async (text: string): Promise<boolean> => {
      clearRuns();
      // Quick local checks first; the server's validation is authoritative.
      const local = parseSpecification(text);
      if (!local.ok) {
        setValidation({ status: "invalid", errors: local.errors });
        return false;
      }

      pendingValidation.current?.abort();
      const controller = new AbortController();
      pendingValidation.current = controller;
      setValidation({ status: "validating" });
      setSelectedState(new Set());

      try {
        const response = await requestValidation(text, controller.signal);
        if (controller.signal.aborted) return false;
        setValidation(
          response.ok ? { status: "valid", result: response } : { status: "invalid", errors: response.errors },
        );
        return response.ok;
      } catch {
        if (controller.signal.aborted) return false;
        setValidation({ status: "invalid", errors: NETWORK_ERROR });
        return false;
      } finally {
        if (pendingValidation.current === controller) pendingValidation.current = null;
      }
    },
    [clearRuns],
  );

  const setSelected = useCallback(
    (next: ReadonlySet<string>) => {
      setSelectedState(next);
      clearRuns();
    },
    [clearRuns],
  );

  const setCombinations = useCallback(
    (next: readonly GenerationOptions[]) => {
      setCombinationsState(sortCombinations(next));
      clearRuns();
    },
    [clearRuns],
  );

  const setProject = useCallback(
    (next: ProjectMode) => {
      setProjectState(next);
      clearRuns();
    },
    [clearRuns],
  );

  /** Generates the given combinations one at a time; the server runs one generator at once. */
  const runSequence = useCallback(
    (targets: readonly GenerationOptions[]) => {
      if (validation.status !== "valid") return;
      const selection = validation.result.operations
        .filter((operation) => selected.has(operation.id))
        .map(({ method, path }) => ({ method, path }));
      const controller = new AbortController();
      pendingGeneration.current = controller;

      const update = (run: Run) => {
        const key = combinationKey(run.options);
        setRuns((previous) =>
          previous?.map((candidate) => (combinationKey(candidate.options) === key ? run : candidate)) ?? null,
        );
      };

      const work = async () => {
        // Each iteration stops after its request if the run was cancelled meanwhile.
        for (const options of targets) {
          update({ options, status: "running" });
          let run: Run;
          try {
            const response = await requestGeneration(
              { spec: specText, options, selection },
              controller.signal,
            );
            run = response.ok
              ? { options, status: "done", result: response }
              : { options, status: "failed", errors: response.errors };
          } catch {
            run = { options, status: "failed", errors: NETWORK_ERROR };
          }
          if (controller.signal.aborted) return;
          update(run);
        }
        if (pendingGeneration.current === controller) pendingGeneration.current = null;
      };
      void work();
    },
    [validation, selected, specText],
  );

  const generate = useCallback(() => {
    clearRuns();
    setRuns(combinations.map((options) => ({ options, status: "pending" })));
    runSequence(combinations);
  }, [clearRuns, combinations, runSequence]);

  const retry = useCallback(
    (key: string) => {
      const run = runs?.find((candidate) => combinationKey(candidate.options) === key);
      if (run?.status !== "failed" || pendingGeneration.current !== null) return;
      setRuns(
        (previous) =>
          previous?.map((candidate) =>
            candidate === run ? { options: run.options, status: "pending" } : candidate,
          ) ?? null,
      );
      setDownload("idle");
      runSequence([run.options]);
    },
    [runs, runSequence],
  );

  const downloadZip = useCallback(async () => {
    const results = successfulResults(runs);
    if (results.length === 0) return;
    setDownload("downloading");
    try {
      const zip = await requestArchive(results, project);
      if (zip === undefined) {
        setDownload("failed");
        return;
      }
      const url = URL.createObjectURL(zip);
      const link = document.createElement("a");
      link.href = url;
      link.download = ARCHIVE_FILE_NAME;
      link.click();
      URL.revokeObjectURL(url);
      setDownload("downloaded");
    } catch {
      setDownload("failed");
    }
  }, [runs, project]);

  const value = useMemo<WorkflowState>(
    () => ({
      specText,
      validation,
      selected,
      combinations,
      project,
      runs,
      download,
      downloadZip,
      setSpecText,
      validate,
      setSelected,
      setCombinations,
      setProject,
      generate,
      retry,
      cancelGeneration: clearRuns,
    }),
    [
      specText,
      validation,
      selected,
      combinations,
      project,
      runs,
      download,
      downloadZip,
      setSpecText,
      validate,
      setSelected,
      setCombinations,
      setProject,
      generate,
      retry,
      clearRuns,
    ],
  );

  return <WorkflowContext value={value}>{children}</WorkflowContext>;
}
