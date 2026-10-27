"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { parseSpecification } from "@/lib/openapi/parse";
import { DEFAULT_HTTP_CLIENT, DEFAULT_TARGET, optionsFor } from "@/lib/targets/catalog";
import type { HttpClient, TargetId } from "@/lib/validation/requests";
import type { GenerateSuccess, Problem, ValidateSuccess } from "@/lib/validation/responses";
import { requestGeneration, requestValidation } from "./api";
import { GenerationResult } from "./generation-result";
import { OperationSelector } from "./operation-selector";
import { ProblemList } from "./problem-list";
import { SpecInput } from "./spec-input";
import { TargetPicker } from "./target-picker";

type ValidationState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "invalid"; errors: Problem[] }
  | { status: "valid"; result: ValidateSuccess };

type GenerationState =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "failed"; errors: Problem[] }
  | { status: "done"; result: GenerateSuccess };

const NETWORK_ERROR: Problem[] = [
  { code: "network", message: "The server could not be reached. Check your connection and try again." },
];

export function Workflow() {
  const [specText, setSpecText] = useState("");
  const [validation, setValidation] = useState<ValidationState>({ status: "idle" });
  const [target, setTarget] = useState<TargetId>(DEFAULT_TARGET);
  // Kept separately so the choice survives switching to a target without one.
  const [httpClient, setHttpClient] = useState<HttpClient>(DEFAULT_HTTP_CLIENT);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [generation, setGeneration] = useState<GenerationState>({ status: "idle" });
  const pendingValidation = useRef<AbortController | null>(null);
  const pendingGeneration = useRef<AbortController | null>(null);

  /** Any change to the inputs makes a generation result stale. */
  const clearGeneration = () => {
    pendingGeneration.current?.abort();
    pendingGeneration.current = null;
    setGeneration({ status: "idle" });
  };

  const handleSpecChange = (text: string) => {
    // A changed specification also invalidates the validation result and the selection.
    pendingValidation.current?.abort();
    pendingValidation.current = null;
    setSpecText(text);
    setValidation({ status: "idle" });
    setSelected(new Set());
    clearGeneration();
  };

  const handleValidate = async () => {
    clearGeneration();
    // Quick local checks first; the server's validation is authoritative.
    const local = parseSpecification(specText);
    if (!local.ok) {
      setValidation({ status: "invalid", errors: local.errors });
      return;
    }

    pendingValidation.current?.abort();
    const controller = new AbortController();
    pendingValidation.current = controller;
    setValidation({ status: "validating" });
    setSelected(new Set());

    try {
      const response = await requestValidation(specText, controller.signal);
      if (controller.signal.aborted) return;
      setValidation(
        response.ok ? { status: "valid", result: response } : { status: "invalid", errors: response.errors },
      );
    } catch {
      if (controller.signal.aborted) return;
      setValidation({ status: "invalid", errors: NETWORK_ERROR });
    } finally {
      if (pendingValidation.current === controller) pendingValidation.current = null;
    }
  };

  const handleGenerate = async (operations: ValidateSuccess["operations"]) => {
    clearGeneration();
    const controller = new AbortController();
    pendingGeneration.current = controller;
    setGeneration({ status: "generating" });

    try {
      const response = await requestGeneration(
        {
          spec: specText,
          options: optionsFor(target, httpClient),
          selection: operations
            .filter((operation) => selected.has(operation.id))
            .map(({ method, path }) => ({ method, path })),
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setGeneration(
        response.ok ? { status: "done", result: response } : { status: "failed", errors: response.errors },
      );
    } catch {
      if (controller.signal.aborted) return;
      setGeneration({ status: "failed", errors: NETWORK_ERROR });
    } finally {
      if (pendingGeneration.current === controller) pendingGeneration.current = null;
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="step-spec" className="flex flex-col gap-4">
        <h2 id="step-spec" className="text-xl font-semibold">
          1. Provide a specification
        </h2>
        <SpecInput
          value={specText}
          onChange={handleSpecChange}
          onValidate={() => void handleValidate()}
          isValidating={validation.status === "validating"}
        />
        {validation.status === "invalid" ? (
          <ProblemList title="The specification cannot be used" problems={validation.errors} />
        ) : null}
        {validation.status === "valid" ? (
          <p className="text-sm">
            <span className="font-medium">{validation.result.info.title}</span>{" "}
            {validation.result.info.version} · OpenAPI {validation.result.info.openapi} ·{" "}
            {validation.result.operations.length} operations
          </p>
        ) : null}
      </section>

      {validation.status === "valid" ? (
        <>
          <section aria-labelledby="step-target" className="flex flex-col gap-4">
            <h2 id="step-target" className="text-xl font-semibold">
              2. Choose a target
            </h2>
            <TargetPicker
              target={target}
              httpClient={httpClient}
              onTargetChange={(next) => {
                setTarget(next);
                clearGeneration();
              }}
              onHttpClientChange={(next) => {
                setHttpClient(next);
                clearGeneration();
              }}
            />
          </section>

          <section aria-labelledby="step-operations" className="flex flex-col gap-4">
            <h2 id="step-operations" className="text-xl font-semibold">
              3. Select operations
            </h2>
            <OperationSelector
              operations={validation.result.operations}
              groups={validation.result.groups}
              selected={selected}
              onSelectedChange={(next) => {
                setSelected(next);
                clearGeneration();
              }}
            />
          </section>

          <section aria-labelledby="step-generate" className="flex flex-col gap-4">
            <h2 id="step-generate" className="text-xl font-semibold">
              4. Generate
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void handleGenerate(validation.result.operations)}
                disabled={selected.size === 0 || generation.status === "generating"}
              >
                {generation.status === "generating" ? "Generating…" : "Generate code"}
              </Button>
              {selected.size === 0 ? (
                <span className="text-muted-foreground text-sm">Select at least one operation.</span>
              ) : null}
            </div>
            {generation.status === "failed" ? (
              <ProblemList title="Generation failed" problems={generation.errors} />
            ) : null}
            {generation.status === "done" ? <GenerationResult result={generation.result} /> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
