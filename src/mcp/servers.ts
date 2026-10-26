// The servers the agent connects to, with the rules for each one (the rules are applied by safety.ts).
import { ownServer, type ServerCommand } from "./client";
import type { ServerPolicy } from "./safety";

export type ServerConfig = {
  server: ServerCommand; // how to start it
  policy: ServerPolicy; // what the agent may do with it
  hint?: string; // one sentence for the model about when to use its tools
};

// 1. Our own server: we wrote it and it wraps its own results, so it is trusted.
// Searching takes a few seconds (embedding, then Qdrant), so it gets a longer time limit.
export const documentsServer: ServerConfig = {
  server: ownServer,
  policy: {
    name: "docs",
    allow: ["search_documents", "get_chunk", "list_documents"],
    trusted: true,
    timeoutMs: 30_000,
    maxOutputChars: 12_000,
  },
};

// 2. A server that somebody else wrote: the reference filesystem server, limited to ONE folder.
// Example: filesServer("C:/shared") offers files_read_text_file, files_list_directory, files_search_files and files_write_file
// Only reading is free. Writing needs approval. The server has 10 more tools (edit, move, create folder, …) that are blocked.
export function filesServer(folder: string): ServerConfig {
  return {
    server: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", folder] },
    policy: {
      name: "files",
      prefix: "files_",
      allow: ["read_text_file", "list_directory", "search_files", "write_file"],
      needsApproval: ["write_file"],
      trusted: false,
    },
    hint: `The files_* tools work on one shared folder (${folder}). Use them only when the user asks about files in that folder; they are not the documents.`,
  };
}
