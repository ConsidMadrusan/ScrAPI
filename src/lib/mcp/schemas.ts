import { z } from "zod";
import { MAX_COMBINATIONS, MAX_SELECTED_OPERATIONS } from "@/lib/validation/limits";
import { projectModeSchema, sourceHeadersSchema, sourceUrlSchema, specTextSchema } from "@/lib/validation/requests";

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

/** Where the API description comes from: its text, or a URL ScrAPI's server loads. */
const sourceFields = {
  source: specTextSchema
    .optional()
    .describe(
      "The full API description text: an OpenAPI 3.0/3.1 or Swagger 2.0 document (JSON or YAML), or a GraphQL schema (SDL or introspection JSON). Give either source or url.",
    ),
  url: sourceUrlSchema
    .optional()
    .describe(
      "A public http(s) URL of the API description, loaded by ScrAPI's server: an OpenAPI/Swagger document, or a GraphQL endpoint (introspected). Use it when you cannot load the URL yourself. Give either source or url.",
    ),
  headers: sourceHeadersSchema
    .optional()
    .describe('Request headers sent with url only, for example {"Authorization": "Bearer <token>"}. Never stored or logged.'),
  kind: z
    .enum(["auto", "openapi", "graphql"])
    .default("auto")
    .describe('How url is loaded: "openapi" GETs a document, "graphql" introspects an endpoint, "auto" (default) tries the document first, then introspection.'),
};

/** Exactly one of `source` and `url`. */
function oneSource(input: { source?: string | undefined; url?: string | undefined }): boolean {
  return (input.source !== undefined) !== (input.url !== undefined);
}
const ONE_SOURCE = { message: "Give either source (the description text) or url, not both and not neither.", path: ["source"] };

export const validateToolInputSchema = z.object(sourceFields).refine(oneSource, ONE_SOURCE);
export type ValidateToolInput = z.infer<typeof validateToolInputSchema>;

export const generateToolInputSchema = z
  .object({
    ...sourceFields,
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
  .refine(oneSource, ONE_SOURCE)
  .refine((input) => (input.allOperations === true) !== (input.operations !== undefined), {
    message: "Give either operations or allOperations: true, not both and not neither.",
    path: ["operations"],
  });
export type GenerateToolInput = z.infer<typeof generateToolInputSchema>;
