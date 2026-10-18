import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { wrapToolResult } from "../prompt";
import { listDocuments as fetchDocuments } from "../retrieval";

export const listDocuments = tool(
  // Example: returns [ { "documentId": "document_001", "filename": "school.pdf", "sections": ["DBMS", "Redis", …], "chunkCount": 9 } ]
  async () => {
    const documents = await fetchDocuments();
    const text = documents.length === 0 ? "No documents have been indexed yet." : JSON.stringify(documents, null, 2);
    return wrapToolResult("list_documents", text);
  },
  {
    name: "list_documents",
    description:
      "List the documents available to search, with the number of passages in each and the section titles (topics) each one covers. " +
      "Use it when the user asks what documents or topics are available, or to check what exists before searching. " +
      "Takes no arguments.",
    schema: z.object({}),
  }
);
