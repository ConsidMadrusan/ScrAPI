const STAGES = ["Specification", "Endpoints", "Frameworks", "Implement"] as const;

interface StageHeaderProps {
  /** Index into the workflow stages. */
  stage: number;
  title: string;
}

/** The page heading of a workflow stage, with the list of stages. */
export function StageHeader({ stage, title }: StageHeaderProps) {
  return (
    <div className="flex flex-col gap-3">
      <ol aria-label="Workflow progress" className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {STAGES.map((name, index) => (
          <li
            key={name}
            aria-current={index === stage ? "step" : undefined}
            className={index === stage ? "text-foreground font-medium" : undefined}
          >
            {index + 1}. {name}
          </li>
        ))}
      </ol>
      <h2 className="text-xl font-semibold">{title}</h2>
    </div>
  );
}
