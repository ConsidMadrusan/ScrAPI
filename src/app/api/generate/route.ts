import { generateClient } from "@/lib/generation/generate";
import { prepareGeneration } from "@/lib/generation/prepare";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";
import { problemsFromZod } from "@/lib/validation/problems";
import { readJsonBody } from "@/lib/validation/read-request";
import { generateRequestSchema } from "@/lib/validation/requests";
import { failure, withProblemHandling } from "@/lib/validation/route-handler";

export const POST = withProblemHandling(
  async (request) => {
    const body = await readJsonBody(request, MAX_REQUEST_BYTES);
    if (!body.ok) return failure(body.status, [body.problem]);

    const input = generateRequestSchema.safeParse(body.value);
    if (!input.success) return failure(400, problemsFromZod(input.error));

    const prepared = await prepareGeneration(input.data);
    if (!prepared.ok) return failure(422, prepared.errors);

    const result = await generateClient(prepared.value, request.signal);
    if (!result.ok) return failure(result.status, result.errors);
    return Response.json(result.value);
  },
  {
    logMessage: "Generation crashed",
    userMessage: "Something went wrong while generating. Try again.",
  },
);
