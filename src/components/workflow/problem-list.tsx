import type { Problem } from "@/lib/validation/responses";

interface ProblemListProps {
  title: string;
  problems: readonly Problem[];
}

/** Announces problems to assistive technology as soon as they appear. */
export function ProblemList({ title, problems }: ProblemListProps) {
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/5 rounded-lg border p-4 text-sm"
    >
      <p className="text-destructive font-medium">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {problems.map((problem, index) => (
          <li key={`${problem.code}-${String(index)}`}>
            {problem.message}
            {problem.location ? (
              <span className="text-muted-foreground"> ({problem.location})</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
