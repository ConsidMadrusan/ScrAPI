import { z } from "zod";
import { MAX_COMBINATIONS, MAX_OUTPUT_FILES } from "./limits";
import { httpMethodSchema } from "./operation";
import { generationOptionsSchema, graphqlOperationTypeSchema, projectModeSchema } from "./requests";

/** A user-facing problem. Never contains stack traces or server details. */
export const problemSchema = z.object({
  code: z.string(),
  message: z.string(),
  /** Where the problem is, e.g. `paths › /users › get` or `selection › 0`. */
  location: z.string().optional(),
});
export type Problem = z.infer<typeof problemSchema>;

/** One operation as shown in the selector. `id` is the canonical key, e.g. `GET /users`. */
export const operationSummarySchema = z.object({
  id: z.string(),
  method: httpMethodSchema,
  path: z.string(),
  tags: z.array(z.string()),
  /** Whether a call needs arguments (required parameters or a required body). */
  requiresInput: z.boolean(),
  summary: z.string().optional(),
  operationId: z.string().optional(),
  deprecated: z.boolean().optional(),
});
export type OperationSummary = z.infer<typeof operationSummarySchema>;

export const operationGroupSchema = z.object({
  /** Stable key; distinct from tag names so a tag called "Other" cannot collide. */
  key: z.string(),
  name: z.string(),
  operationIds: z.array(z.string()),
});
export type OperationGroup = z.infer<typeof operationGroupSchema>;

export const failureResponseSchema = z.object({
  ok: z.literal(false),
  errors: z.array(problemSchema).min(1),
});
export type FailureResponse = z.infer<typeof failureResponseSchema>;

/** What the server converted before validating: YAML to JSON, Swagger 2.0 to OpenAPI 3.0. */
export const conversionSchema = z.enum(["yaml", "swagger-2"]);
export type Conversion = z.infer<typeof conversionSchema>;

export const validateSuccessSchema = z.object({
  ok: z.literal(true),
  /** OpenAPI results may omit it (they predate GraphQL support); GraphQL results always set it. */
  kind: z.literal("openapi").optional(),
  /**
   * The specification as OpenAPI JSON, the one the client sends for
   * generation: the input itself, or its conversion from YAML or Swagger 2.0.
   */
  spec: z.string(),
  conversions: z.array(conversionSchema),
  info: z.object({
    title: z.string(),
    version: z.string(),
    openapi: z.string(),
  }),
  operations: z.array(operationSummarySchema),
  groups: z.array(operationGroupSchema),
});
export type ValidateSuccess = z.infer<typeof validateSuccessSchema>;

export const validateResponseSchema = z.discriminatedUnion("ok", [
  validateSuccessSchema,
  failureResponseSchema,
]);
export type ValidateResponse = z.infer<typeof validateResponseSchema>;

/** One generated file, with its path in the ZIP and in the supported project layout. */
export const generatedFileSchema = z.object({
  archivePath: z.string(),
  destinationPath: z.string(),
  content: z.string(),
});
export type GeneratedFile = z.infer<typeof generatedFileSchema>;

/** One root field of a GraphQL schema, offered for selection. `id` is e.g. `query books`. */
export const graphqlOperationSchema = z.object({
  id: z.string(),
  operationType: graphqlOperationTypeSchema,
  field: z.string(),
  /** Name of the operation ScrAPI builds for the field, e.g. `Books`; the generated method has this name. */
  name: z.string(),
  /** Whether the field has required arguments without defaults. */
  requiresInput: z.boolean(),
  description: z.string().optional(),
  deprecated: z.boolean().optional(),
});
export type GraphqlOperation = z.infer<typeof graphqlOperationSchema>;

/** A valid GraphQL schema, with the root fields that can be selected. */
export const graphqlValidateSuccessSchema = z.object({
  ok: z.literal(true),
  kind: z.literal("graphql"),
  /** The schema as SDL, the one the client sends for generation. */
  schema: z.string(),
  info: z.object({
    title: z.string(),
    typeCount: z.number().int(),
    /** Subscription fields, which are not generated. */
    subscriptionCount: z.number().int(),
  }),
  operations: z.array(graphqlOperationSchema),
  groups: z.array(operationGroupSchema),
});
export type GraphqlValidateSuccess = z.infer<typeof graphqlValidateSuccessSchema>;

export const graphqlValidateResponseSchema = z.discriminatedUnion("ok", [
  graphqlValidateSuccessSchema,
  failureResponseSchema,
]);
export type GraphqlValidateResponse = z.infer<typeof graphqlValidateResponseSchema>;

/** The OpenAPI generation result that both the ZIP and the guide are built from. */
export const openApiGenerateSuccessSchema = z.object({
  ok: z.literal(true),
  kind: z.literal("openapi").optional(),
  options: generationOptionsSchema,
  archiveRoot: z.string(),
  destinationRoot: z.string(),
  operations: z.array(operationSummarySchema),
  files: z.array(generatedFileSchema).min(1).max(MAX_OUTPUT_FILES),
});
export type OpenApiGenerateSuccess = z.infer<typeof openApiGenerateSuccessSchema>;

/** The GraphQL generation result that both the ZIP and the guide are built from. */
export const graphqlGenerateSuccessSchema = z.object({
  ok: z.literal(true),
  kind: z.literal("graphql"),
  options: generationOptionsSchema,
  archiveRoot: z.string(),
  destinationRoot: z.string(),
  operations: z.array(graphqlOperationSchema),
  files: z.array(generatedFileSchema).min(1).max(MAX_OUTPUT_FILES),
});
export type GraphqlGenerateSuccess = z.infer<typeof graphqlGenerateSuccessSchema>;

/** Either kind of generation result. Fields shared by both are all the ZIP needs. */
export const generateSuccessSchema = z.union([graphqlGenerateSuccessSchema, openApiGenerateSuccessSchema]);
export type GenerateSuccess = z.infer<typeof generateSuccessSchema>;

export const generateResponseSchema = z.union([generateSuccessSchema, failureResponseSchema]);
export type GenerateResponse = z.infer<typeof generateResponseSchema>;

/** A ZIP request: the successful results of one generation run, one per framework combination. */
export const archiveRequestSchema = z.object({
  results: z
    .array(generateSuccessSchema)
    .min(1, "There is nothing to archive.")
    .max(MAX_COMBINATIONS, "Too many framework combinations."),
  /** Which guide INTEGRATION.md contains: for an existing project or a new one. */
  project: projectModeSchema,
});
export type ArchiveRequest = z.infer<typeof archiveRequestSchema>;

/** The answer of a URL that ScrAPI's server loaded for the browser: status, content type, and text. */
export const fetchSourceSuccessSchema = z.object({
  ok: z.literal(true),
  status: z.number().int(),
  contentType: z.string(),
  body: z.string(),
});
export type FetchSourceSuccess = z.infer<typeof fetchSourceSuccessSchema>;

export const fetchSourceResponseSchema = z.discriminatedUnion("ok", [fetchSourceSuccessSchema, failureResponseSchema]);
export type FetchSourceResponse = z.infer<typeof fetchSourceResponseSchema>;
