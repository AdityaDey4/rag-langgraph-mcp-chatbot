// Settings used across the LangGraph agent. Reads .env (OPENAI_API_KEY, QDRANT_URL).
import "dotenv/config";

export const COLLECTION_NAME = "rag_documents"; // the Qdrant collection holding the documents
export const EMBEDDING_MODEL = "text-embedding-3-large"; // must match how the documents were embedded
export const CHAT_MODEL = process.env.AGENT_MODEL || "gpt-4o-mini";
