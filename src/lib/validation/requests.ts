import { z } from "zod";
import {
  formatMegabytes,
  MAX_SELECTED_OPERATIONS,
  MAX_SPEC_BYTES,
  utf8ByteLength,
} from "./limits";
import { operationKeySchema } from "./operation";

export const TARGET_IDS = [
  "csharp",
  "typescript-next",
  "typescript-nuxt",
  "typescript-angular",
] as const;
export const targetIdSchema = z.enum(TARGET_IDS);
export type TargetId = z.infer<typeof targetIdSchema>;

export const HTTP_CLIENTS = ["axios", "fetch"] as const;
export const httpClientSchema = z.enum(HTTP_CLIENTS);
export type HttpClient = z.infer<typeof httpClientSchema>;

/**
 * Whether the generated code goes into an existing project or a new one. It
 * changes only the guide (and INTEGRATION.md), never the generated files.
 */
export const PROJECT_MODES = ["existing", "new"] as const;
export const projectModeSchema = z.enum(PROJECT_MODES);
export type ProjectMode = z.infer<typeof projectModeSchema>;

/** Per-target options. Only the shared TypeScript targets choose an HTTP client. */
export const generationOptionsSchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("csharp") }),
  z.object({ target: z.literal("typescript-next"), httpClient: httpClientSchema }),
  z.object({ target: z.literal("typescript-nuxt"), httpClient: httpClientSchema }),
  z.object({ target: z.literal("typescript-angular") }),
]);
export type GenerationOptions = z.infer<typeof generationOptionsSchema>;

export const specTextSchema = z
  .string()
  .refine((text) => text.trim().length > 0, "Paste or upload a specification.")
  .refine(
    (text) => utf8ByteLength(text) <= MAX_SPEC_BYTES,
    `The specification is larger than ${formatMegabytes(MAX_SPEC_BYTES)}.`,
  );

export const validateRequestSchema = z.object({ spec: specTextSchema });
export type ValidateRequest = z.infer<typeof validateRequestSchema>;

export const generateRequestSchema = z.object({
  spec: specTextSchema,
  options: generationOptionsSchema,
  selection: z
    .array(operationKeySchema)
    .min(1, "Select at least one operation.")
    .max(MAX_SELECTED_OPERATIONS, "Too many operations selected."),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

/** GraphQL root operation types ScrAPI generates. Subscriptions are not generated. */
export const GRAPHQL_OPERATION_TYPES = ["query", "mutation"] as const;
export const graphqlOperationTypeSchema = z.enum(GRAPHQL_OPERATION_TYPES);
export type GraphqlOperationType = z.infer<typeof graphqlOperationTypeSchema>;

/** Identifies one GraphQL operation by its root type and field name. */
export const graphqlOperationKeySchema = z.object({
  operationType: graphqlOperationTypeSchema,
  field: z.string().regex(/^[_A-Za-z][_0-9A-Za-z]*$/, "Must be a GraphQL field name."),
});
export type GraphqlOperationKey = z.infer<typeof graphqlOperationKeySchema>;

/** A GraphQL schema as SDL or introspection JSON, within the specification size limit. */
export const graphqlSchemaTextSchema = z
  .string()
  .refine((text) => text.trim().length > 0, "Paste, upload, or load a GraphQL schema.")
  .refine(
    (text) => utf8ByteLength(text) <= MAX_SPEC_BYTES,
    `The schema is larger than ${formatMegabytes(MAX_SPEC_BYTES)}.`,
  );

export const graphqlValidateRequestSchema = z.object({ schema: graphqlSchemaTextSchema });
export type GraphqlValidateRequest = z.infer<typeof graphqlValidateRequestSchema>;

export const graphqlGenerateRequestSchema = z.object({
  schema: graphqlSchemaTextSchema,
  options: generationOptionsSchema,
  selection: z
    .array(graphqlOperationKeySchema)
    .min(1, "Select at least one operation.")
    .max(MAX_SELECTED_OPERATIONS, `Select at most ${String(MAX_SELECTED_OPERATIONS)} operations.`),
});
export type GraphqlGenerateRequest = z.infer<typeof graphqlGenerateRequestSchema>;

/**
 * A server-side load of a URL, used only when the browser cannot read it
 * (CORS). `kind` picks one of two fixed requests; there is no method or body.
 */
/** A URL ScrAPI's server may load (checked further by `fetchUrl`). */
export const sourceUrlSchema = z.string().max(2048, "The URL is too long.");

/** Request headers sent along when ScrAPI's server loads a URL (checked further by `fetchUrl`). */
export const sourceHeadersSchema = z
  .record(z.string().max(256), z.string().max(8192))
  .refine((headers) => Object.keys(headers).length <= 20, "Add at most 20 request headers.");

export const fetchSourceRequestSchema = z.object({
  url: sourceUrlSchema,
  kind: z.enum(["document", "introspection"]),
  headers: sourceHeadersSchema,
});
export type FetchSourceRequest = z.infer<typeof fetchSourceRequestSchema>;
