import { z } from "zod";

/** HTTP methods that can hold an operation in an OpenAPI 3.0 path item. */
export const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

export const httpMethodSchema = z.enum(HTTP_METHODS);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

/** Identifies one operation by method and path, never by operationId. */
export const operationKeySchema = z.object({
  method: httpMethodSchema,
  path: z.string().startsWith("/"),
});
export type OperationKey = z.infer<typeof operationKeySchema>;

/** Canonical string form, e.g. `GET /users`. */
export function formatOperationKey(key: OperationKey): string {
  return `${key.method.toUpperCase()} ${key.path}`;
}
