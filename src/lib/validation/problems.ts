import type { z } from "zod";
import type { Problem } from "./responses";

export type { Problem };

export function problemsFromZod(error: z.ZodError): Problem[] {
  return error.issues.map((issue) => {
    const problem: Problem = { code: "invalid-request", message: issue.message };
    if (issue.path.length > 0) problem.location = issue.path.map(String).join(" › ");
    return problem;
  });
}
