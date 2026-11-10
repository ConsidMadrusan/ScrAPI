"use client";

import { ArrowLeft, ClipboardPaste, FileUp, Link as LinkIcon, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SubmitEvent,
} from "react";
import { usePrefersReducedMotion } from "@/components/guide/use-prefers-reduced-motion";
import { Button } from "@/components/ui/button";
import type { SourceKind } from "@/lib/source-kind";
import { formatMegabytes, MAX_SPEC_BYTES } from "@/lib/validation/limits";
import { loadSource, parseHeaderLines, type SourceMode } from "./fetch-source";
import type { InputMethod } from "./workflow-context";

interface SpecInputProps {
  /** The chosen input method, or null while choosing. */
  method: InputMethod | null;
  onChooseMethod: (method: InputMethod) => void;
  /** Back to the choice; the caller resets the text and everything derived from it. */
  onBack: () => void;
  value: string;
  onChange: (value: string) => void;
  /**
   * Called with the text to check: after a paste, an upload, a URL load, or
   * "Continue". The kind is given when it is known (a loaded URL); otherwise it is detected.
   */
  onSubmit: (value: string, kind?: SourceKind) => void;
  isValidating: boolean;
}

const METHODS: readonly { method: InputMethod; title: string; description: string; icon: LucideIcon }[] = [
  {
    method: "paste",
    title: "Paste",
    description: "OpenAPI or Swagger (JSON or YAML), or a GraphQL schema (SDL or introspection JSON).",
    icon: ClipboardPaste,
  },
  {
    method: "upload",
    title: "Upload a file",
    description: `A .json, .yaml, .yml, .graphql, or .gql file, up to ${formatMegabytes(MAX_SPEC_BYTES)}.`,
    icon: FileUp,
  },
  {
    method: "url",
    title: "Load from a URL",
    description: "The address of a document, or a GraphQL endpoint.",
    icon: LinkIcon,
  },
];

/**
 * The first stage: choose how to provide the API description, then use only
 * that form. Each form keeps its fields in its own state, so leaving it with
 * Back (which unmounts it) resets them; the caller clears the shared text.
 */
export function SpecInput({ method, onChooseMethod, onBack, value, onChange, onSubmit, isValidating }: SpecInputProps) {
  const reduceMotion = usePrefersReducedMotion();
  // The card to focus after Back, so keyboard users return where they were.
  const returnFocusTo = useRef<InputMethod | null>(null);

  const back = () => {
    returnFocusTo.current = method;
    onBack();
  };

  const content =
    method === null ? (
      <MethodChooser
        onChoose={onChooseMethod}
        cardRef={(choice, element) => {
          // After Back, focus the card as soon as it is mounted (the animation mounts it later).
          if (element !== null && returnFocusTo.current === choice) {
            element.focus();
            returnFocusTo.current = null;
          }
        }}
      />
    ) : (
      <MethodPanel method={method} onBack={back}>
        {method === "paste" ? (
          <PasteForm value={value} onChange={onChange} onSubmit={onSubmit} isValidating={isValidating} />
        ) : method === "upload" ? (
          <UploadForm onChange={onChange} onSubmit={onSubmit} />
        ) : (
          <UrlForm onChange={onChange} onSubmit={onSubmit} isValidating={isValidating} />
        )}
      </MethodPanel>
    );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        ScrAPI accepts OpenAPI 3.0.x and 3.1.x, Swagger 2.0, and GraphQL schemas, up to{" "}
        {formatMegabytes(MAX_SPEC_BYTES)}. The description is checked as soon as you provide it, is only used for this
        generation, and is never stored.
      </p>
      {reduceMotion ? (
        content
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={method ?? "chooser"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {content}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

function MethodChooser({
  onChoose,
  cardRef,
}: {
  onChoose: (method: InputMethod) => void;
  cardRef: (method: InputMethod, element: HTMLButtonElement | null) => void;
}) {
  return (
    <div role="group" aria-label="How do you want to provide the API description?" className="grid gap-3 sm:grid-cols-3">
      {METHODS.map(({ method, title, description, icon: Icon }) => (
        <button
          key={method}
          ref={(element) => {
            cardRef(method, element);
          }}
          type="button"
          onClick={() => {
            onChoose(method);
          }}
          className="hover:bg-muted focus-visible:ring-ring/50 flex flex-col items-start gap-2 rounded-lg border p-4 text-left outline-none focus-visible:ring-3"
        >
          <span className="flex items-center gap-2 font-medium">
            <Icon aria-hidden className="size-4" />
            {title}
          </span>
          <span className="text-muted-foreground text-sm">{description}</span>
        </button>
      ))}
    </div>
  );
}

function MethodPanel({ method, onBack, children }: { method: InputMethod; onBack: () => void; children: ReactNode }) {
  const title = METHODS.find((candidate) => candidate.method === method)?.title ?? "";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden className="size-4" />
          Back
        </Button>
        <h3 className="font-medium">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/** Moves focus to an element when the form opens, so keyboard users can start right away. */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

function FormError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  ) : null;
}

/** Pasting submits right away; typed changes are submitted with "Continue". */
function PasteForm({
  value,
  onChange,
  onSubmit,
  isValidating,
}: Pick<SpecInputProps, "value" | "onChange" | "onSubmit" | "isValidating">) {
  const textareaId = useId();
  const textarea = useFocusOnMount<HTMLTextAreaElement>();
  // Set by the paste event, which fires before the textarea's change event.
  const pasted = useRef(false);

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(value);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor={textareaId} className="text-sm">
        API description: OpenAPI, Swagger, or GraphQL
      </label>
      <textarea
        id={textareaId}
        ref={textarea}
        value={value}
        onPaste={() => {
          pasted.current = true;
          // A paste that changes nothing fires no change event; forget it afterwards.
          setTimeout(() => {
            pasted.current = false;
          }, 0);
        }}
        onChange={(event) => {
          const text = event.target.value;
          onChange(text);
          if (pasted.current) {
            pasted.current = false;
            onSubmit(text);
          }
        }}
        spellCheck={false}
        rows={12}
        placeholder='{ "openapi": "3.0.3", ... }'
        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-48 w-full rounded-lg border p-3 font-mono text-sm outline-none focus-visible:ring-3"
      />
      <div>
        <Button type="submit" disabled={isValidating}>
          {isValidating ? "Validating…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}

/** A chosen file is read in the browser and submitted right away. */
function UploadForm({ onChange, onSubmit }: Pick<SpecInputProps, "onChange" | "onSubmit">) {
  const fileId = useId();
  const input = useFocusOnMount<HTMLInputElement>();
  const [error, setError] = useState<string | undefined>();

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!/\.(json|ya?ml|graphqls?|gql)$/i.test(file.name)) {
      setError("Choose a .json, .yaml, .yml, .graphql, or .gql file.");
      return;
    }
    if (file.size > MAX_SPEC_BYTES) {
      setError(`The file is larger than ${formatMegabytes(MAX_SPEC_BYTES)}.`);
      return;
    }
    try {
      const text = await file.text();
      setError(undefined);
      onChange(text);
      onSubmit(text);
    } catch {
      setError("The file could not be read. Try again, or paste its contents instead.");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={fileId} className="text-sm">
        Choose a file
      </label>
      <input
        id={fileId}
        ref={input}
        type="file"
        accept=".json,.yaml,.yml,.graphql,.graphqls,.gql,application/json,application/yaml"
        onChange={(event) => void handleFile(event)}
        className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-2.5 file:py-1 file:text-sm"
      />
      <FormError message={error} />
    </div>
  );
}

/**
 * Loads a document or introspects a GraphQL endpoint. The browser loads the
 * URL, or ScrAPI's server when the browser cannot (CORS); request headers
 * then pass through the server, which never stores or logs them. Leaving the
 * form cancels a load in progress.
 */
function UrlForm({ onChange, onSubmit, isValidating }: Pick<SpecInputProps, "onChange" | "onSubmit" | "isValidating">) {
  const urlId = useId();
  const modeId = useId();
  const headersId = useId();
  const urlInput = useFocusOnMount<HTMLInputElement>();
  const [url, setUrl] = useState("");
  const [headerText, setHeaderText] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("auto");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const pending = useRef<AbortController | null>(null);
  // False while the form animates out after Back: cancel right away, so a load
  // that finishes during the animation cannot submit after the reset.
  const isPresent = useIsPresent();

  useEffect(() => {
    if (!isPresent) pending.current?.abort();
  }, [isPresent]);

  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );

  const load = async () => {
    const headers = parseHeaderLines(headerText);
    if (!headers.ok) {
      setError(headers.errors[0]?.message);
      return;
    }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setIsLoading(true);
    setError(undefined);
    try {
      const result = await loadSource(url, headers.headers, sourceMode, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setError(result.errors[0]?.message);
        return;
      }
      onChange(result.text);
      onSubmit(result.text, result.kind);
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <label htmlFor={urlId} className="text-sm">
            URL
          </label>
          <input
            id={urlId}
            ref={urlInput}
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void load();
              }
            }}
            placeholder="https://api.example.com/openapi.json or https://api.example.com/graphql"
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={modeId} className="text-sm">
            API type
          </label>
          <select
            id={modeId}
            value={sourceMode}
            onChange={(event) => {
              setSourceMode(event.target.value as SourceMode);
            }}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border px-2 text-sm outline-none focus-visible:ring-3"
          >
            <option value="auto">Detect</option>
            <option value="openapi">OpenAPI / Swagger</option>
            <option value="graphql">GraphQL</option>
          </select>
        </div>
        <Button
          type="button"
          disabled={isLoading || isValidating || url.trim() === ""}
          onClick={() => void load()}
        >
          {isLoading ? "Loading…" : "Load"}
        </Button>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer">Request headers for the URL (optional)</summary>
        <div className="mt-2 flex flex-col gap-1">
          <label htmlFor={headersId} className="text-muted-foreground">
            One per line, for example <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>. They are
            sent only with the request to that URL. If your browser cannot load it, ScrAPI&apos;s server makes the
            request instead and forwards them; it never stores or logs them.
          </label>
          <textarea
            id={headersId}
            value={headerText}
            onChange={(event) => {
              setHeaderText(event.target.value);
            }}
            rows={3}
            spellCheck={false}
            autoComplete="off"
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border p-2 font-mono text-sm outline-none focus-visible:ring-3"
          />
        </div>
      </details>
      <FormError message={error} />
    </div>
  );
}
