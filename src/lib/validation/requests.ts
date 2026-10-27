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
