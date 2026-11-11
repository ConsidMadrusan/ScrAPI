import { createMcpHandler, originValidationResponse } from "@modelcontextprotocol/server";
import { createScrapiMcpServer } from "@/lib/mcp/server";
import { MAX_REQUEST_BYTES } from "@/lib/validation/limits";

/**
 * The MCP endpoint (Streamable HTTP, stateless) that lets AI agents validate
 * API descriptions and generate clients. Each request gets a fresh server;
 * nothing is kept between requests, and GET/DELETE (sessions) answer 405.
 */
const handler = createMcpHandler(() => createScrapiMcpServer(), {
  legacy: "stateless",
  responseMode: "json",
  maxRequestBodySize: MAX_REQUEST_BYTES,
  onerror: (error) => {
    console.error("MCP request failed", { error: error.name });
  },
});

async function serve(request: Request): Promise<Response> {
  // Browsers send Origin; agents do not. Only this server's own origin may call it (DNS rebinding).
  const rejected = originValidationResponse(request, [new URL(request.url).hostname]);
  if (rejected) return rejected;
  return handler.fetch(request);
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
