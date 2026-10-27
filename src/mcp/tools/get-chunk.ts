import { z } from "zod";
import { log } from "../log";
import { wrapToolResult } from "../prompt";
import { getChunkById, type Chunk } from "../retrieval";

export const getChunkDescription =
  "Fetch the full text of one document passage by its chunkId (as returned by search_documents). " +
  "Use it when a search snippet is cut off or you need the complete passage before answering. " +
  "Do not guess chunkIds.";

export const getChunkSchema = z.object({
  chunkId: z.string().min(1).max(64).describe("A chunkId returned by search_documents."),
});

// Example: getChunk({ chunkId: "fd04…" }) returns { content: [{ type: "text", text: "<tool_result …>{ chunkId: fd04…, section: Kafka, text: Kafka Apache Kafka is … }</tool_result>" }] }
// An unknown id, or a failure, is returned as a result with isError: true, not thrown.
export async function getChunk(
  { chunkId }: z.infer<typeof getChunkSchema>,
  fetchChunk: (id: string) => Promise<Chunk | null> = getChunkById,
) {
  log("server", `← tools/call get_chunk ${JSON.stringify({ chunkId })}`);

  try {
    const chunk = await fetchChunk(chunkId);

    if (!chunk) {
      log("server", "→ error result: no passage with that id");
      return { content: [{ type: "text" as const, text: `Error: No passage found with chunkId "${chunkId}".` }], isError: true };
    }

    const details = {
      chunkId: chunk.id,
      filename: chunk.filename,
      section: chunk.section,
      pages: chunk.pages,
      text: chunk.text,
    };

    const text = wrapToolResult("get_chunk", JSON.stringify(details, null, 2));
    log("server", `→ result: ${text.length} characters (the passage of "${chunk.section}")`);
    return { content: [{ type: "text" as const, text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("server", `→ error result: ${message}`);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}
