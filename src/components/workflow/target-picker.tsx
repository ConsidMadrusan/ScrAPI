"use client";

import { useId } from "react";
import { HTTP_CLIENT_LABELS, TARGETS } from "@/lib/targets/catalog";
import { HTTP_CLIENTS, type HttpClient, type TargetId } from "@/lib/validation/requests";

interface TargetPickerProps {
  target: TargetId;
  httpClient: HttpClient;
  onTargetChange: (target: TargetId) => void;
  onHttpClientChange: (httpClient: HttpClient) => void;
}

const optionClass =
  "has-checked:border-primary has-checked:bg-muted has-focus-visible:ring-ring/50 flex cursor-pointer gap-3 rounded-lg border p-3 has-focus-visible:ring-3";

export function TargetPicker({
  target: selectedTarget,
  httpClient,
  onTargetChange,
  onHttpClientChange,
}: TargetPickerProps) {
  const name = useId();
  const clientName = useId();

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium">Output target</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TARGETS.map((target) => (
            <label key={target.id} className={optionClass}>
              <input
                type="radio"
                name={name}
                value={target.id}
                checked={selectedTarget === target.id}
                onChange={() => {
                  onTargetChange(target.id);
                }}
                className="mt-1"
              />
              <span className="flex flex-col">
                <span className="font-medium">{target.label}</span>
                <span className="text-muted-foreground text-sm">{target.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {TARGETS.find((target) => target.id === selectedTarget)?.hasHttpClient ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">HTTP client</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {HTTP_CLIENTS.map((client) => (
              <label key={client} className={optionClass}>
                <input
                  type="radio"
                  name={clientName}
                  value={client}
                  checked={httpClient === client}
                  onChange={() => {
                    onHttpClientChange(client);
                  }}
                  className="mt-1"
                />
                <span className="flex flex-col">
                  <span className="font-mono font-medium">{HTTP_CLIENT_LABELS[client].label}</span>
                  <span className="text-muted-foreground text-sm">
                    {HTTP_CLIENT_LABELS[client].description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
