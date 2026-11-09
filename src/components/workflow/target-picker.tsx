"use client";

import {
  combinationKey,
  DEFAULT_HTTP_CLIENT,
  HTTP_CLIENT_LABELS,
  optionsFor,
  TARGETS,
} from "@/lib/targets/catalog";
import { HTTP_CLIENTS, type GenerationOptions, type HttpClient, type TargetId } from "@/lib/validation/requests";

interface TargetPickerProps {
  /** The chosen framework combinations. */
  value: readonly GenerationOptions[];
  onChange: (value: GenerationOptions[]) => void;
}

const optionClass =
  "has-checked:border-primary has-checked:bg-muted has-focus-visible:ring-ring/50 flex cursor-pointer gap-3 rounded-lg border p-3 has-focus-visible:ring-3";

/**
 * Checkboxes for every target. Targets with an HTTP client show one checkbox
 * per client once checked; each checked client is a separate combination.
 */
export function TargetPicker({ value, onChange }: TargetPickerProps) {
  const chosen = new Set(value.map(combinationKey));
  const isChosen = (target: TargetId, client: HttpClient) => chosen.has(combinationKey(optionsFor(target, client)));
  const without = (target: TargetId) => value.filter((options) => options.target !== target);

  const toggleTarget = (target: TargetId, checked: boolean) => {
    onChange(checked ? [...without(target), optionsFor(target, DEFAULT_HTTP_CLIENT)] : without(target));
  };

  const toggleClient = (target: TargetId, client: HttpClient, checked: boolean) => {
    const key = combinationKey(optionsFor(target, client));
    // Unchecking the last client leaves the target unchecked.
    onChange(
      checked
        ? [...value, optionsFor(target, client)]
        : value.filter((options) => combinationKey(options) !== key),
    );
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">Frameworks</legend>
      <p className="text-muted-foreground mb-2 text-sm">
        Choose one or more. Each framework and HTTP client combination gets its own folder in the ZIP and its own
        part of the guide.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {TARGETS.map((target) => {
          const targetChecked = value.some((options) => options.target === target.id);
          return (
            <div key={target.id} className="flex flex-col gap-2">
              <label className={optionClass}>
                <input
                  type="checkbox"
                  checked={targetChecked}
                  onChange={(event) => {
                    toggleTarget(target.id, event.target.checked);
                  }}
                  className="mt-1"
                />
                <span className="flex flex-col">
                  <span className="font-medium">{target.label}</span>
                  <span className="text-muted-foreground text-sm">{target.description}</span>
                </span>
              </label>
              {target.hasHttpClient && targetChecked ? (
                <fieldset className="ml-6 flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">
                    HTTP client for {target.label}
                  </legend>
                  {HTTP_CLIENTS.map((client) => (
                    <label key={client} className={optionClass}>
                      <input
                        type="checkbox"
                        checked={isChosen(target.id, client)}
                        onChange={(event) => {
                          toggleClient(target.id, client, event.target.checked);
                        }}
                        className="mt-1"
                      />
                      <span className="flex flex-col">
                        <span className="font-mono font-medium">{HTTP_CLIENT_LABELS[client].label}</span>
                        <span className="text-muted-foreground text-sm">{HTTP_CLIENT_LABELS[client].description}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
