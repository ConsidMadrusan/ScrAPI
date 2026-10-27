"use client";

import { useRef, useState } from "react";
import { parseSpecification } from "@/lib/openapi/parse";
import { DEFAULT_HTTP_CLIENT, DEFAULT_TARGET } from "@/lib/targets/catalog";
import type { HttpClient, TargetId } from "@/lib/validation/requests";
import type { Problem, ValidateSuccess } from "@/lib/validation/responses";
import { requestValidation } from "./api";
import { OperationSelector } from "./operation-selector";
import { ProblemList } from "./problem-list";
import { SpecInput } from "./spec-input";
import { TargetPicker } from "./target-picker";

type ValidationState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "invalid"; errors: Problem[] }
  | { status: "valid"; result: ValidateSuccess };

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
  const pending = useRef<AbortController | null>(null);

  const handleSpecChange = (text: string) => {
    // A changed specification invalidates the validation result and the selection.
    pending.current?.abort();
    pending.current = null;
    setSpecText(text);
    setValidation({ status: "idle" });
    setSelected(new Set());
  };

  const handleValidate = async () => {
    // Quick local checks first; the server's validation is authoritative.
    const local = parseSpecification(specText);
    if (!local.ok) {
      setValidation({ status: "invalid", errors: local.errors });
      return;
    }

    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
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
      if (pending.current === controller) pending.current = null;
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
          <p role="status" className="text-sm">
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
              onTargetChange={setTarget}
              onHttpClientChange={setHttpClient}
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
              onSelectedChange={setSelected}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
