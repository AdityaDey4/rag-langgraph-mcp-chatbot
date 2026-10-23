import { z } from "zod";
import { wrapToolResult } from "../prompt";
import { listDocuments as fetchDocuments } from "../retrieval";

export const listDocumentsDescription =
  "List the documents available to search, with the number of passages in each and the section titles (topics) each one covers. " +
  "Use it when the user asks what documents or topics are available, or to check what exists before searching. " +
  "Takes no arguments.";

export const listDocumentsSchema = z.object({});

// Example: listDocuments() returns { content: [{ type: "text", text: "<tool_result …>[ { documentId: document_001, filename: school.pdf, sections: [DBMS, Redis, …], chunkCount: 9 } ]</tool_result>" }] }
// A failure (for example Qdrant is not running) is returned as a result with isError: true, not thrown.
export async function listDocuments(fetchAll: typeof fetchDocuments = fetchDocuments) {
  try {
    const documents = await fetchAll();
    const text = documents.length === 0 ? "No documents have been indexed yet." : JSON.stringify(documents, null, 2);

    return { content: [{ type: "text" as const, text: wrapToolResult("list_documents", text) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}
