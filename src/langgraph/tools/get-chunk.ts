import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { wrapToolResult } from "../prompt";
import { getChunkById } from "../retrieval";

export const getChunk = tool(
  // Example return, for { chunkId: "fd04038f-…" } (inside the <tool_result> wrapper), with the FULL text:
  //   { "chunkId": "fd04038f-…", "filename": "school.pdf", "section": "Kafka", "pages": [3], "text": "Kafka Apache Kafka is …" }
  // An id that does not exist throws Error(No passage found with chunkId "…").
  async ({ chunkId }) => {
    const chunk = await getChunkById(chunkId);
    if (!chunk) throw new Error(`No passage found with chunkId "${chunkId}".`);

    const details = {
      chunkId: chunk.id,
      filename: chunk.filename,
      section: chunk.section,
      pages: chunk.pages,
      text: chunk.text,
    };
    return wrapToolResult("get_chunk", JSON.stringify(details, null, 2));
  },
  {
    name: "get_chunk",
    description:
      "Fetch the full text of one document passage by its chunkId (as returned by search_documents). " +
      "Use it when a search snippet is cut off or you need the complete passage before answering. " +
      "Do not guess chunkIds.",
    schema: z.object({
      chunkId: z.string().min(1).max(64).describe("A chunkId returned by search_documents."),
    }),
    verboseParsingErrors: true,
  }
);
