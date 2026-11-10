"use client";

import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ARCHIVE_FILE_NAME } from "@/lib/archive/names";
import { needsServerConversion } from "@/lib/openapi/convertible";
import { parseSpecification } from "@/lib/openapi/parse";
import { detectSourceKind, type SourceKind } from "@/lib/source-kind";
import { combinationKey, sortCombinations } from "@/lib/targets/catalog";
import type { GenerationOptions, ProjectMode } from "@/lib/validation/requests";
import type { GenerateResponse, GenerateSuccess, GraphqlValidateSuccess, Problem, ValidateSuccess } from "@/lib/validation/responses";
import {
  requestArchive,
  requestGeneration,
  requestGraphqlGeneration,
  requestGraphqlValidation,
  requestValidation,
} from "./api";

export type ValidationState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "invalid"; errors: Problem[] }
  | { status: "valid"; result: ValidateSuccess | GraphqlValidateSuccess };

/** The generation of one framework combination. */
export type Run =
  | { options: GenerationOptions; status: "pending" | "running" }
  | { options: GenerationOptions; status: "done"; result: GenerateSuccess }
  | { options: GenerationOptions; status: "failed"; errors: Problem[] };

/** How the user provides the API description on the first stage. */
export type InputMethod = "paste" | "upload" | "url";

/** The ZIP of the latest successful results. */
export type DownloadState = "idle" | "downloading" | "downloaded" | "failed";

export interface WorkflowState {
  /** The input method chosen on the first stage, or null while the user is choosing. */
  inputMethod: InputMethod | null;
  setInputMethod: (method: InputMethod) => void;
  /** Back to the method choice: clears the text and everything derived from it. */
  resetInput: () => void;
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
  /** Why the last ZIP download failed, as reported by the server; empty otherwise. */
  downloadErrors: readonly Problem[];
  /** Builds the ZIP of the successful results on the server and saves it. */
  downloadZip: () => Promise<void>;
  /** Replaces the specification and clears everything derived from it. */
  setSpecText: (text: string) => void;
  /**
   * Validates `text` (the current specification or GraphQL schema) and reports
   * whether it is valid. The kind is detected from the text unless given.
   */
  validate: (text: string, kind?: SourceKind) => Promise<boolean>;
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

/** How long the ZIP's object URL stays valid after the download starts. */
const OBJECT_URL_LIFETIME_MS = 60_000;

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
  const [inputMethod, setInputMethodState] = useState<InputMethod | null>(null);
  const [specText, setSpecTextState] = useState("");
  const [validation, setValidation] = useState<ValidationState>({ status: "idle" });
  const [selected, setSelectedState] = useState<ReadonlySet<string>>(new Set());
  const [combinations, setCombinationsState] = useState<readonly GenerationOptions[]>([]);
  const [project, setProjectState] = useState<ProjectMode>("existing");
  const [runs, setRuns] = useState<readonly Run[] | null>(null);
  const [download, setDownloadState] = useState<DownloadState>("idle");
  const [downloadErrors, setDownloadErrors] = useState<readonly Problem[]>([]);
  /** Sets the download state; only a failure carries problems. */
  const setDownload = useCallback((next: DownloadState, errors: readonly Problem[] = []) => {
    setDownloadState(next);
    setDownloadErrors(errors);
  }, []);
  const pendingValidation = useRef<AbortController | null>(null);
  const pendingGeneration = useRef<AbortController | null>(null);

  /** Any change to the inputs makes generation results stale. */
  const clearRuns = useCallback(() => {
    pendingGeneration.current?.abort();
    pendingGeneration.current = null;
    setRuns(null);
    setDownload("idle");
  }, [setDownload]);

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

  const setInputMethod = useCallback((method: InputMethod) => {
    setInputMethodState(method);
  }, []);

  const resetInput = useCallback(() => {
    setInputMethodState(null);
    setSpecText("");
  }, [setSpecText]);

  const validate = useCallback(
    async (text: string, kind: SourceKind = detectSourceKind(text)): Promise<boolean> => {
      clearRuns();
      // A newer check replaces any check still in progress, also when it fails
      // locally: an older answer arriving later must not overwrite it.
      pendingValidation.current?.abort();
      pendingValidation.current = null;

      // Quick local checks first; the server's validation is authoritative.
      // YAML and Swagger 2.0 are converted on the server, and GraphQL schemas
      // are only checked there, so they go there directly.
      if (kind === "openapi" && !needsServerConversion(text)) {
        const local = parseSpecification(text);
        if (!local.ok) {
          setValidation({ status: "invalid", errors: local.errors });
          return false;
        }
      }

      const controller = new AbortController();
      pendingValidation.current = controller;
      setValidation({ status: "validating" });
      setSelectedState(new Set());

      try {
        const response =
          kind === "graphql"
            ? await requestGraphqlValidation(text, controller.signal)
            : await requestValidation(text, controller.signal);
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

  /**
   * Generates the given combinations one at a time; the server runs one generator at once.
   *
   * `pendingGeneration` is the lock between `runSequence`, `retry`, and
   * `clearRuns`: it holds the controller of the sequence in progress and is
   * null exactly when none runs. `retry` is refused while it is set;
   * `clearRuns` aborts it, and an aborted sequence stops after its current
   * request without updating the runs.
   */
  const runSequence = useCallback(
    (targets: readonly GenerationOptions[]) => {
      if (validation.status !== "valid") return;
      const source = validation.result;
      /** Generates one combination from the server's normalized input: OpenAPI JSON or GraphQL SDL. */
      const generateOne = (options: GenerationOptions, signal: AbortSignal): Promise<GenerateResponse> =>
        source.kind === "graphql"
          ? requestGraphqlGeneration(
              {
                schema: source.schema,
                options,
                selection: source.operations
                  .filter((operation) => selected.has(operation.id))
                  .map(({ operationType, field }) => ({ operationType, field })),
              },
              signal,
            )
          : requestGeneration(
              {
                spec: source.spec,
                options,
                selection: source.operations
                  .filter((operation) => selected.has(operation.id))
                  .map(({ method, path }) => ({ method, path })),
              },
              signal,
            );
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
            const response = await generateOne(options, controller.signal);
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
    [validation, selected],
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
    [runs, runSequence, setDownload],
  );

  const downloadZip = useCallback(async () => {
    const results = successfulResults(runs);
    if (results.length === 0) return;
    setDownload("downloading");
    try {
      const response = await requestArchive(results, project);
      if (!response.ok) {
        setDownload("failed", response.errors);
        return;
      }
      const url = URL.createObjectURL(response.zip);
      const link = document.createElement("a");
      link.href = url;
      link.download = ARCHIVE_FILE_NAME;
      link.click();
      // Revoking right after click() can cancel the download in some browsers.
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, OBJECT_URL_LIFETIME_MS);
      setDownload("downloaded");
    } catch {
      setDownload("failed", NETWORK_ERROR);
    }
  }, [runs, project, setDownload]);

  const value = useMemo<WorkflowState>(
    () => ({
      inputMethod,
      setInputMethod,
      resetInput,
      specText,
      validation,
      selected,
      combinations,
      project,
      runs,
      download,
      downloadErrors,
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
      inputMethod,
      setInputMethod,
      resetInput,
      specText,
      validation,
      selected,
      combinations,
      project,
      runs,
      download,
      downloadErrors,
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
