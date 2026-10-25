import { z } from "zod";
import { log } from "../log";
import { wrapToolResult } from "../prompt";
import { searchChunks, type Chunk } from "../retrieval";

const SNIPPET_LENGTH = 1200; // characters of each passage that are returned

export const searchDocumentsDescription =
  "Search the uploaded documents for passages relevant to a query. " +
  "Use a specific, self-contained query that names the subject (no pronouns like 'it' or 'this'). " +
  "Call it again with a different query if the results look irrelevant. " +
  "Returns up to `topK` passages with similarity scores; a low score means the documents probably do not cover the topic. " +
  "Each result has a chunkId you can pass to get_chunk for the full passage. " +
  "Not for arithmetic or dates.";

export const searchDocumentsSchema = z.object({
  query: z.string().min(1).max(300).describe("What to look for, phrased as a standalone search query."),
  topK: z.number().int().min(1).max(8).optional().describe("How many passages to return (1-8, default 4)."),
});

// Example: searchDocuments({ query: "What is Kafka?", topK: 2 }) returns { content: [{ type: "text", text: "<tool_result …>[ { chunkId: …, section: Kafka, score: 0.474, snippet: … } ]</tool_result>" }] }
// A failure (for example Qdrant is not running) is returned as a result with isError: true, not thrown.
export async function searchDocuments(
  { query, topK }: z.infer<typeof searchDocumentsSchema>,
  search: (query: string, limit: number) => Promise<Chunk[]> = searchChunks,
) {
  log("server", `← tools/call search_documents ${JSON.stringify({ query, topK })}`);

  try {
    // Embed the query and search Qdrant.
    log("server", `  searching Qdrant for "${query}" (top ${topK ?? 4})`);
    const chunks = await search(query, topK ?? 4);

    if (chunks.length === 0) {
      log("server", "  found no passages");
      return { content: [{ type: "text" as const, text: wrapToolResult("search_documents", "No passages found.") }] };
    }

    const best = chunks[0];
    log("server", `  found ${chunks.length} passages, the best is "${best.section}" (score ${best.score?.toFixed(3)})`);

    const results = chunks.map((chunk) => ({
      chunkId: chunk.id,
      filename: chunk.filename,
      section: chunk.section,
      pages: chunk.pages,
      score: chunk.score === null ? null : Number(chunk.score.toFixed(3)),
      snippet: chunk.text.length > SNIPPET_LENGTH ? chunk.text.slice(0, SNIPPET_LENGTH) + "…" : chunk.text,
    }));

    const text = wrapToolResult("search_documents", JSON.stringify(results, null, 2));
    log("server", `→ result: ${text.length} characters`);
    return { content: [{ type: "text" as const, text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("server", `→ error result: ${message}`);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}
