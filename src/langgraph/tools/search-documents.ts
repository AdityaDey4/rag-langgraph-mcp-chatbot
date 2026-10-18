import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { wrapToolResult } from "../prompt";
import { searchChunks } from "../retrieval";

const SNIPPET_LENGTH = 1200; // characters of each passage shown to the model

export const searchDocuments = tool(
  // Example return, for { query: "What is Kafka?", topK: 2 } (inside the <tool_result> wrapper), best match first:
  //   [ { "chunkId": "fd04038f-…", "filename": "school.pdf", "section": "Kafka", "pages": [3],
  //       "score": 0.474, "snippet": "Kafka Apache Kafka is a distributed event-streaming platform …" },
  //     { "chunkId": "…", … } ]
  // Nothing found returns the text "No passages found."
  async ({ query, topK }) => {
    const chunks = await searchChunks(query, topK ?? 4);
    if (chunks.length === 0) return wrapToolResult("search_documents", "No passages found.");

    const results = chunks.map((chunk) => ({
      chunkId: chunk.id,
      filename: chunk.filename,
      section: chunk.section,
      pages: chunk.pages,
      score: chunk.score === null ? null : Number(chunk.score.toFixed(3)),
      snippet: chunk.text.length > SNIPPET_LENGTH ? chunk.text.slice(0, SNIPPET_LENGTH) + "…" : chunk.text,
    }));

    return wrapToolResult("search_documents", JSON.stringify(results, null, 2));
  },
  {
    name: "search_documents",
    description:
      "Search the uploaded documents for passages relevant to a query. " +
      "Use a specific, self-contained query that names the subject (no pronouns like 'it' or 'this'). " +
      "Call it again with a different query if the results look irrelevant. " +
      "Returns up to `topK` passages with similarity scores; a low score means the documents probably do not cover the topic. " +
      "Each result has a chunkId you can pass to get_chunk for the full passage. " +
      "Not for arithmetic or dates.",
    schema: z.object({
      query: z.string().min(1).max(300).describe("What to look for, phrased as a standalone search query."),
      topK: z.number().int().min(1).max(8).optional().describe("How many passages to return (1-8, default 4)."),
    }),
    verboseParsingErrors: true,
  }
);
