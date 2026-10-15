import { z } from "zod";
import { searchChunks } from "../../rag/retrieval";
import { defineTool } from "../registry";
import type { SourceRef } from "../types";

const SNIPPET_CHARS = 1200;

export const searchDocuments = defineTool({
  name: "search_documents",
  description:
    "Search the uploaded documents for passages relevant to a query. " +
    "Use a specific, self-contained query that names the subject (no pronouns like 'it' or 'this'). " +
    "Call it again with a different query if the results look irrelevant. " +
    "Returns up to `topK` passages with similarity scores; a low score means the documents probably do not cover the topic. " +
    "Each result has a chunkId you can pass to get_chunk for the full passage. " +
    "Not for arithmetic or dates.",
  inputSchema: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe("What to look for, phrased as a standalone search query."),
    topK: z
      .number()
      .int()
      .min(1)
      .max(8)
      .default(4)
      .describe("How many passages to return (1-8, default 4)."),
  }),
  async run({ query, topK }) {
    const chunks = await searchChunks(query, topK);

    if (chunks.length === 0) {
      return { content: "No passages found.", data: { sources: [] } };
    }

    const results = chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      filename: chunk.filename,
      section: chunk.section,
      pages: chunk.pageNumbers,
      score: chunk.score === null ? null : Number(chunk.score.toFixed(3)),
      snippet:
        chunk.text.length > SNIPPET_CHARS
          ? chunk.text.slice(0, SNIPPET_CHARS) + "…"
          : chunk.text,
    }));

    const sources: SourceRef[] = results.map((result) => ({
      chunkId: result.chunkId,
      filename: result.filename,
      section: result.section,
      pages: result.pages,
      snippet: result.snippet,
    }));

    return { content: JSON.stringify(results, null, 2), data: { sources } };
  },
});
