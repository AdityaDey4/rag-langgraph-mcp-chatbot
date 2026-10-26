// The MCP server itself: the tools, the resources and the prompt. It does not know how it is reached.
// server.ts serves it over stdio, http-server.ts over HTTP.
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { summarizeSection, summarizeSectionDescription, summarizeSectionSchema } from "./prompts";
import { documentsUri, listSectionResources, readDocumentsResource, readSectionResource, sectionUriTemplate } from "./resources";
import { getChunk, getChunkDescription, getChunkSchema } from "./tools/get-chunk";
import { listDocuments, listDocumentsDescription, listDocumentsSchema } from "./tools/list-documents";
import { searchDocuments, searchDocumentsDescription, searchDocumentsSchema } from "./tools/search-documents";

// Build a server and register the tools, resources and the prompt on it.
// The transports (stdio, HTTP) call this function whenever they need a server, so it must return a new one each time.
export function createServer() {
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

  // Resources: data the host can read. One fixed resource, and one resource for every section.
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

  // A prompt: a message the user picks in the host.
  server.registerPrompt(
    "summarize_section",
    { title: "Summarise a section", description: summarizeSectionDescription, argsSchema: summarizeSectionSchema },
    (args) => summarizeSection(args),
  );

  return server;
}
