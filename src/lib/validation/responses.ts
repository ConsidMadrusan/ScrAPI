import { z } from "zod";
import { MAX_OUTPUT_FILES } from "./limits";
import { httpMethodSchema } from "./operation";
import { generationOptionsSchema } from "./requests";

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

export const validateSuccessSchema = z.object({
  ok: z.literal(true),
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

/** The single generation result that both the ZIP and the guide are built from. */
export const generateSuccessSchema = z.object({
  ok: z.literal(true),
  options: generationOptionsSchema,
  archiveRoot: z.string(),
  destinationRoot: z.string(),
  operations: z.array(operationSummarySchema),
  files: z.array(generatedFileSchema).min(1).max(MAX_OUTPUT_FILES),
});
export type GenerateSuccess = z.infer<typeof generateSuccessSchema>;

export const generateResponseSchema = z.discriminatedUnion("ok", [
  generateSuccessSchema,
  failureResponseSchema,
]);
export type GenerateResponse = z.infer<typeof generateResponseSchema>;
