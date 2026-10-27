// The MCP server over stdio: a host (or our client) starts this file as a subprocess.
//   npm run mcp:server      (a host such as Claude Desktop starts it itself, see docs/MCP-SPEC.md)
// stdout is only for protocol messages. Everything we print goes to stderr (see log.ts).
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./create-server";
import { log } from "./log";

// serveStdio talks to clients of both protocol eras (see fact 14 in docs/MCP-SPEC.md).
serveStdio(createServer, {
  onerror: (error) => log("server", `error: ${error}`),
});

log("server", "rag-documents server running on stdio");
