// The MCP server: it offers the three document tools to any MCP client over stdio.
//   npm run mcp:server      (a host such as Claude Desktop starts it itself, see docs/MCP-SPEC.md)
// stdout is only for protocol messages. Everything we print goes to stderr (see log.ts).
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { log } from "./log";
import { getChunk, getChunkDescription, getChunkSchema } from "./tools/get-chunk";
import { listDocuments, listDocumentsDescription, listDocumentsSchema } from "./tools/list-documents";
import { searchDocuments, searchDocumentsDescription, searchDocumentsSchema } from "./tools/search-documents";

// 1. Build a server and register the tools on it.
// serveStdio calls this function whenever it needs a server, so it must return a new one each time.
function createServer() {
  const server = new McpServer({
    name: "rag-documents",
    version: "1.0.0",
  });

  server.registerTool(
    "search_documents",
    { description: searchDocumentsDescription, inputSchema: searchDocumentsSchema },
    (args) => searchDocuments(args),
  );

  server.registerTool(
    "get_chunk",
    { description: getChunkDescription, inputSchema: getChunkSchema },
    (args) => getChunk(args),
  );

  server.registerTool(
    "list_documents",
    { description: listDocumentsDescription, inputSchema: listDocumentsSchema },
    () => listDocuments(),
  );

  return server;
}

// 2. Serve it over stdio. serveStdio talks to clients of both protocol eras (see fact 14 in docs/MCP-SPEC.md).
serveStdio(createServer, {
  onerror: (error) => log(`error: ${error}`),
});

log("rag-documents server running on stdio");
