"use client";

import { useId, useState, type ChangeEvent, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { formatMegabytes, MAX_SPEC_BYTES } from "@/lib/validation/limits";

interface SpecInputProps {
  value: string;
  onChange: (value: string) => void;
  onValidate: () => void;
  isValidating: boolean;
}

export function SpecInput({ value, onChange, onValidate, isValidating }: SpecInputProps) {
  const textareaId = useId();
  const fileId = useId();
  const hintId = useId();
  const [fileError, setFileError] = useState<string | undefined>();

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".json")) {
      setFileError("Choose a .json file. YAML and other formats are not supported.");
      return;
    }
    if (file.size > MAX_SPEC_BYTES) {
      setFileError(`The file is larger than ${formatMegabytes(MAX_SPEC_BYTES)}.`);
      return;
    }
    try {
      const text = await file.text();
      setFileError(undefined);
      onChange(text);
    } catch {
      setFileError("The file could not be read.");
    }
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    onValidate();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor={textareaId} className="font-medium">
        OpenAPI specification (JSON)
      </label>
      <p id={hintId} className="text-muted-foreground text-sm">
        Paste an OpenAPI 3.0.x document in JSON, or upload a .json file (up to{" "}
        {formatMegabytes(MAX_SPEC_BYTES)}). It is only used for this generation and never stored.
      </p>
      <textarea
        id={textareaId}
        aria-describedby={hintId}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        spellCheck={false}
        rows={12}
        placeholder='{ "openapi": "3.0.3", ... }'
        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-48 w-full rounded-lg border p-3 font-mono text-sm outline-none focus-visible:ring-3"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isValidating}>
          {isValidating ? "Validating…" : "Validate specification"}
        </Button>
        <label htmlFor={fileId} className="text-sm">
          or upload a file:
        </label>
        <input
          id={fileId}
          type="file"
          accept=".json,application/json"
          onChange={(event) => void handleFile(event)}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-2.5 file:py-1 file:text-sm"
        />
      </div>
      {fileError ? (
        <p role="alert" className="text-destructive text-sm">
          {fileError}
        </p>
      ) : null}
    </form>
  );
}
