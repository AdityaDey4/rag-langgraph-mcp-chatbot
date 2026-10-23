// Settings for the MCP server. Reads .env (OPENAI_API_KEY, QDRANT_URL).
import path from "node:path";
import dotenv from "dotenv";

// 1. The .env file is found from this file's location, not from the working directory,
// because a host (Claude Desktop, Claude Code) starts the server from some other folder.
// quiet: true, because dotenv would otherwise print a line to stdout, and stdout is only for protocol messages.
dotenv.config({ path: path.join(__dirname, "..", "..", ".env"), quiet: true });

export const COLLECTION_NAME = "rag_documents"; // the Qdrant collection holding the documents
export const EMBEDDING_MODEL = "text-embedding-3-large"; // must match how the documents were embedded
