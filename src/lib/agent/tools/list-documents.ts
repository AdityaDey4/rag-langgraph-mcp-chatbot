import { z } from "zod";
import { listDocuments as fetchDocuments } from "../../rag/retrieval";
import { defineTool } from "../registry";

export const listDocuments = defineTool({
  name: "list_documents",
  description:
    "List the documents available to search, with the number of passages in each and the section titles (topics) each one covers. " +
    "Use it when the user asks what documents or topics are available, or to check what exists before searching. " +
    "Takes no arguments.",
  inputSchema: z.object({}),
  async run() {
    const documents = await fetchDocuments();

    if (documents.length === 0) {
      return { content: "No documents have been indexed yet." };
    }

    return { content: JSON.stringify(documents, null, 2) };
  },
});
