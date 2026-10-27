// The MCP server over HTTP (Streamable HTTP): the same tools, resources and prompt as over stdio, but reached by an address
// instead of being started by the client. Because anyone who can reach the address could call the tools, every request is checked first.
import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { createServer } from "./create-server";
import { log } from "./log";

const MAX_BODY_BYTES = 64 * 1024; // a tool call is a few hundred bytes, so this is generous
const MIN_TOKEN_CHARS = 16;

// Example: tokenIsValid("Bearer abc123…", "abc123…") returns true; a missing header or a wrong token returns false
function tokenIsValid(authorization: string | null, token: string): boolean {
  const given = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  // Both are hashed first so that they have the same length, then compared in constant time (a plain === leaks how much matched).
  const givenHash = createHash("sha256").update(given).digest();
  const expectedHash = createHash("sha256").update(token).digest();

  return timingSafeEqual(givenHash, expectedHash);
}

// Example: startHttpServer({ port: 3333, token: "a-long-secret-token" }) returns { url: "http://127.0.0.1:3333/mcp", close }
// Port 0 picks a free port (used by the tests).
export async function startHttpServer(options: { port: number; token: string }) {
  if (options.token.length < MIN_TOKEN_CHARS) {
    throw new Error(`The token must have at least ${MIN_TOKEN_CHARS} characters.`);
  }

  // 1. The SDK part: it serves the MCP protocol. It calls createServer() for every request.
  const handler = createMcpHandler(() => createServer());

  // 2. Our part: the checks, in order, before the SDK sees the request. The SDK does no checks of its own.
  const guarded = {
    fetch: async (request: Request, requestOptions?: Parameters<typeof handler.fetch>[1]) => {
      const path = new URL(request.url).pathname;
      let response: Response;

      if (path !== "/mcp") {
        response = Response.json({ error: "Not found." }, { status: 404 });
      } else {
        // Host and Origin must be this computer. This stops a web page in a browser from calling the server (DNS rebinding).
        const rejected =
          hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
          originValidationResponse(request, localhostAllowedOrigins());

        if (rejected) {
          response = rejected;
        } else if (!tokenIsValid(request.headers.get("authorization"), options.token)) {
          response = Response.json({ error: "A valid bearer token is required." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
        } else if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
          response = Response.json({ error: "The request is too large." }, { status: 413 });
        } else {
          response = await handler.fetch(request, requestOptions);
        }
      }

      // One log line per request. It never has the token.
      log("server", `http: ${request.method} ${path} -> ${response.status}`);
      return response;
    },
  };

  // 3. Node's own HTTP server, connected to our checks. It only listens on this computer (127.0.0.1), not on the network.
  const httpServer = http.createServer(toNodeHandler(guarded));
  await new Promise<void>((resolve) => httpServer.listen(options.port, "127.0.0.1", resolve));

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : options.port;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
  };
}
