"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { HttpMethod } from "@/lib/validation/operation";
import type { GraphqlOperationType } from "@/lib/validation/requests";
import type { GraphqlOperation, OperationGroup, OperationSummary } from "@/lib/validation/responses";

/** An OpenAPI operation (method + path) or a GraphQL root field (query or mutation). */
type SelectableOperation = OperationSummary | GraphqlOperation;

interface OperationSelectorProps {
  operations: readonly SelectableOperation[];
  groups: readonly OperationGroup[];
  /** Selected operation ids (`GET /users`). One id selects the operation in every group. */
  selected: ReadonlySet<string>;
  onSelectedChange: (selected: Set<string>) => void;
}

const BADGE_CLASSES: Record<HttpMethod | GraphqlOperationType, string> = {
  query: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  mutation: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  get: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  post: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  put: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  patch: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  delete: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  head: "bg-muted text-foreground",
  options: "bg-muted text-foreground",
  trace: "bg-muted text-foreground",
};

export function OperationSelector({
  operations,
  groups,
  selected,
  onSelectedChange,
}: OperationSelectorProps) {
  const idPrefix = useId();
  const [query, setQuery] = useState("");

  const byId = useMemo(
    () => new Map(operations.map((operation) => [operation.id, operation])),
    [operations],
  );
  const matches = useMemo(() => matchingIds(operations, query), [operations, query]);

  const setMany = (ids: readonly string[], checked: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    onSelectedChange(next);
  };

  const visibleGroups = groups
    .map((group) => ({ group, visibleIds: group.operationIds.filter((id) => matches.has(id)) }))
    .filter(({ visibleIds }) => visibleIds.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <label htmlFor={`${idPrefix}-search`} className="text-sm font-medium">
            Search operations
          </label>
          <input
            id={`${idPrefix}-search`}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Path, field, summary, or operationId"
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            onSelectedChange(new Set(operations.map((operation) => operation.id)));
          }}
        >
          Select all
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            onSelectedChange(new Set());
          }}
        >
          Clear all
        </Button>
      </div>

      <p role="status" aria-live="polite" className="text-sm font-medium">
        {selected.size} of {operations.length} operations selected
      </p>

      {visibleGroups.length === 0 ? (
        <p className="text-muted-foreground text-sm">No operations match “{query}”.</p>
      ) : null}

      {visibleGroups.map(({ group, visibleIds }, groupIndex) => {
        const selectedInGroup = group.operationIds.filter((id) => selected.has(id)).length;
        const allSelected = selectedInGroup === group.operationIds.length;
        const groupCheckboxId = `${idPrefix}-group-${String(groupIndex)}`;

        return (
          <fieldset key={group.key} className="rounded-lg border">
            <legend className="sr-only">{group.name}</legend>
            <div className="bg-muted/50 flex items-center gap-3 rounded-t-lg border-b px-3 py-2">
              <input
                id={groupCheckboxId}
                type="checkbox"
                checked={allSelected}
                ref={(element) => {
                  if (element) element.indeterminate = selectedInGroup > 0 && !allSelected;
                }}
                onChange={(event) => {
                  setMany(group.operationIds, event.target.checked);
                }}
                aria-label={`Select all in ${group.name}`}
              />
              <label htmlFor={groupCheckboxId} className="font-medium">
                {group.name}
              </label>
              <span className="text-muted-foreground ml-auto text-sm">
                {selectedInGroup}/{group.operationIds.length}
              </span>
            </div>
            <ul className="divide-y">
              {visibleIds.map((id, operationIndex) => {
                const found = byId.get(id);
                if (!found) return null;
                const operation = display(found);
                const checkboxId = `${groupCheckboxId}-op-${String(operationIndex)}`;
                return (
                  <li key={id} className="flex items-start gap-3 px-3 py-2">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={selected.has(id)}
                      onChange={(event) => {
                        setMany([id], event.target.checked);
                      }}
                      aria-label={operation.summary ? `${id} – ${operation.summary}` : id}
                      className="mt-1"
                    />
                    <label htmlFor={checkboxId} className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold uppercase ${BADGE_CLASSES[operation.badge]}`}
                        >
                          {operation.badge}
                        </span>
                        <span className="font-mono text-sm break-all">{operation.title}</span>
                        {operation.deprecated ? (
                          <span className="text-muted-foreground text-xs">(deprecated)</span>
                        ) : null}
                      </span>
                      {operation.summary ? (
                        <span className="text-sm">{operation.summary}</span>
                      ) : null}
                      {operation.detail ? (
                        <span className="text-muted-foreground font-mono text-xs">
                          {operation.detail}
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

interface OperationDisplay {
  badge: HttpMethod | GraphqlOperationType;
  /** The path (OpenAPI) or field name (GraphQL). */
  title: string;
  summary: string | undefined;
  /** The operationId (OpenAPI). */
  detail: string | undefined;
  deprecated: boolean | undefined;
}

function display(operation: SelectableOperation): OperationDisplay {
  if ("operationType" in operation) {
    return {
      badge: operation.operationType,
      title: operation.field,
      summary: operation.description?.split("\n")[0],
      detail: undefined,
      deprecated: operation.deprecated,
    };
  }
  return {
    badge: operation.method,
    title: operation.path,
    summary: operation.summary,
    detail: operation.operationId,
    deprecated: operation.deprecated,
  };
}

function matchingIds(operations: readonly SelectableOperation[], query: string): Set<string> {
  const needle = query.trim().toLowerCase();
  return new Set(
    operations
      .filter((operation) => {
        if (needle.length === 0) return true;
        const { title, summary, detail } = display(operation);
        return [title, summary, detail].some((text) => text?.toLowerCase().includes(needle));
      })
      .map((operation) => operation.id),
  );
}
