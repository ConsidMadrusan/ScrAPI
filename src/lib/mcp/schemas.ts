import { z } from "zod";
import { MAX_COMBINATIONS, MAX_SELECTED_OPERATIONS } from "@/lib/validation/limits";
import { projectModeSchema, specTextSchema } from "@/lib/validation/requests";

/**
 * Framework combination keys an agent can request, in `COMBINATIONS` order.
 * A test keeps this list equal to `COMBINATIONS.map(combinationKey)`.
 */
export const COMBINATION_KEYS = [
  "nextjs-axios",
  "nextjs-fetch",
  "nuxt-axios",
  "nuxt-fetch",
  "angular",
  "csharp",
] as const;
export const combinationKeySchema = z.enum(COMBINATION_KEYS);
export type CombinationKey = z.infer<typeof combinationKeySchema>;

const sourceSchema = specTextSchema.describe(
  "The full API description text: an OpenAPI 3.0/3.1 or Swagger 2.0 document (JSON or YAML), or a GraphQL schema (SDL or introspection JSON). Read it from a file or URL yourself and pass its contents; ScrAPI does not load URLs here.",
);

export const validateToolInputSchema = z.object({ source: sourceSchema });
export type ValidateToolInput = z.infer<typeof validateToolInputSchema>;

export const generateToolInputSchema = z
  .object({
    source: sourceSchema,
    combinations: z
      .array(combinationKeySchema)
      .min(1, "Choose at least one framework combination.")
      .max(MAX_COMBINATIONS)
      .describe("Framework combinations to generate, from scrapi_list_targets."),
    operations: z
      .array(z.string().min(1))
      .max(MAX_SELECTED_OPERATIONS, "Too many operations selected.")
      .optional()
      .describe(
        'Operation ids from scrapi_validate, e.g. "GET /users" (OpenAPI) or "query books" (GraphQL). Omit only when allOperations is true.',
      ),
    allOperations: z
      .boolean()
      .optional()
      .describe("Set to true to generate every operation instead of listing them in operations."),
    project: projectModeSchema
      .default("existing")
      .describe('"existing" to add the client to an existing project, "new" for a guide that starts with the official project-creation commands.'),
  })
  .refine((input) => (input.allOperations === true) !== (input.operations !== undefined), {
    message: "Give either operations or allOperations: true, not both and not neither.",
    path: ["operations"],
  });
export type GenerateToolInput = z.infer<typeof generateToolInputSchema>;
