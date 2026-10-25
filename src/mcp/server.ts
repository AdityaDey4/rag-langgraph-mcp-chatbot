// The MCP server: it offers the document tools, two kinds of resources and a prompt to any MCP client over stdio.
//   npm run mcp:server      (a host such as Claude Desktop starts it itself, see docs/MCP-SPEC.md)
// stdout is only for protocol messages. Everything we print goes to stderr (see log.ts).
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { log } from "./log";
import { summarizeSection, summarizeSectionDescription, summarizeSectionSchema } from "./prompts";
import { documentsUri, listSectionResources, readDocumentsResource, readSectionResource, sectionUriTemplate } from "./resources";
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

  // 2. Resources: data the host can read. One fixed resource, and one resource for every section.
  server.registerResource(
    "documents",
    documentsUri,
    { title: "Documents", description: "The list of documents with their sections.", mimeType: "application/json" },
    (uri) => readDocumentsResource(uri),
  );

  server.registerResource(
    "sections",
    new ResourceTemplate(sectionUriTemplate, { list: () => listSectionResources() }),
    { title: "Document sections", description: "The text of one section of the documents." },
    (uri, variables) => readSectionResource(uri, decodeURIComponent(String(variables.section))),
  );

  // 3. A prompt: a message the user picks in the host.
  server.registerPrompt(
    "summarize_section",
    { title: "Summarise a section", description: summarizeSectionDescription, argsSchema: summarizeSectionSchema },
    (args) => summarizeSection(args),
  );

  return server;
}

// 4. Serve it over stdio. serveStdio talks to clients of both protocol eras (see fact 14 in docs/MCP-SPEC.md).
serveStdio(createServer, {
  onerror: (error) => log("server", `error: ${error}`),
});

log("server", "rag-documents server running on stdio");
