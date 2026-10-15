import { z } from "zod";
import { getChunkById } from "../../rag/retrieval";
import { defineTool } from "../registry";
import type { SourceRef } from "../types";

export const getChunk = defineTool({
  name: "get_chunk",
  description:
    "Fetch the full text of one document passage by its chunkId (as returned by search_documents). " +
    "Use it when a search snippet is cut off or you need the complete passage before answering. " +
    "Do not guess chunkIds.",
  inputSchema: z.object({
    chunkId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .describe("A chunkId returned by search_documents."),
  }),
  async run({ chunkId }) {
    const chunk = await getChunkById(chunkId);

    if (!chunk) {
      return {
        content: `Error: no passage found with chunkId "${chunkId}".`,
        isError: true,
      };
    }

    return {
      content: JSON.stringify(
        {
          chunkId: chunk.chunkId,
          filename: chunk.filename,
          section: chunk.section,
          pages: chunk.pageNumbers,
          text: chunk.text,
        },
        null,
        2
      ),
      data: {
        sources: [
          {
            chunkId: chunk.chunkId,
            filename: chunk.filename,
            section: chunk.section,
            pages: chunk.pageNumbers,
            snippet: chunk.text.slice(0, 600),
          },
        ] satisfies SourceRef[],
      },
    };
  },
});
