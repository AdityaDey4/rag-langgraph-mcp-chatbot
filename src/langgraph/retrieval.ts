// Talking to the document store (Qdrant). The tools in ./tools use these.
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { COLLECTION_NAME, EMBEDDING_MODEL } from "./config";

// A passage of a document.
export type Chunk = {
  id: string;
  filename: string | null;
  section: string | null;
  pages: number[];
  text: string;
  score: number | null; // similarity to the query (only when found by a search)
};

// Created on first use, so importing this file never needs the environment variables.
let embeddings: OpenAIEmbeddings | undefined;
let qdrant: QdrantClient | undefined;

// Example return: the embeddings helper, OpenAIEmbeddings { model: "text-embedding-3-large" }.
// It is created once; every later call returns the same object.
function getEmbeddings() {
  return (embeddings ??= new OpenAIEmbeddings({ model: EMBEDDING_MODEL }));
}

// Example return: the Qdrant connection, QdrantClient pointed at http://localhost:6333.
// It is created once; every later call returns the same object.
function getQdrant() {
  return (qdrant ??= new QdrantClient({ url: process.env.QDRANT_URL! }));
}

// The `limit` passages most similar in meaning to the query.
// Example: searchChunks("What is Kafka?", 2) returns the 2 best matches, best first (illustrative values):
//   [
//     { id: "fd04038f-…", filename: "school.pdf", section: "Kafka", pages: [3], text: "Kafka Apache Kafka is a distributed …", score: 0.47 },
//     { id: "acfa72b7-…", filename: "school.pdf", section: "Java",  pages: [1], text: "Java Java is a general-purpose …",    score: 0.21 },
//   ]   (score: higher means closer in meaning to the question)
export async function searchChunks(query: string, limit: number): Promise<Chunk[]> {
  const vector = await getEmbeddings().embedQuery(query);

  const result = await getQdrant().query(COLLECTION_NAME, {
    query: vector,
    limit,
    with_payload: true,
  });

  return result.points.map((point) => toChunk(point.id, point.payload, point.score));
}

// One passage by its id, or null if there is none.
// Example: getChunkById("fd04038f-…") returns that one passage (score is null, because nothing was searched):
//   { id: "fd04038f-…", filename: "school.pdf", section: "Kafka", pages: [3], text: "Kafka Apache Kafka is …", score: null }
// An id that does not exist returns null.
export async function getChunkById(id: string): Promise<Chunk | null> {
  const points = await getQdrant().retrieve(COLLECTION_NAME, { ids: [id], with_payload: true });
  return points.length > 0 ? toChunk(points[0].id, points[0].payload, null) : null;
}

// Which documents exist, with their section titles and how many passages each has.
// Example return (one entry per document):
//   [ { documentId: "document_001", filename: "school.pdf",
//       sections: ["DBMS", "Redis", "AI", "Java", "n8n", "Kafka"], chunkCount: 9 } ]
// With nothing indexed it returns [].
export async function listDocuments() {
  const documents = new Map<string, { filename: string | null; sections: string[]; chunkCount: number }>();

  // Read every point (without vectors), a page at a time.
  let offset: string | number | Record<string, unknown> | null | undefined;
  do {
    const page = await getQdrant().scroll(COLLECTION_NAME, {
      limit: 256,
      offset: offset ?? undefined,
      with_payload: ["documentId", "filename", "section"],
      with_vector: false,
    });

    for (const point of page.points) {
      const payload = point.payload ?? {};
      const documentId = asText(payload.documentId) ?? "unknown";
      const section = asText(payload.section);

      const doc = documents.get(documentId) ?? { filename: asText(payload.filename), sections: [], chunkCount: 0 };
      doc.chunkCount += 1;
      if (section && !doc.sections.includes(section)) doc.sections.push(section);
      documents.set(documentId, doc);
    }
    offset = page.next_page_offset;
  } while (offset != null);

  return [...documents.entries()].map(([documentId, doc]) => ({ documentId, ...doc }));
}

// Qdrant stores each passage's details in a loose "payload"; read it safely.
// Example: toChunk("fd04…", { filename: "school.pdf", section: "Kafka", pageNumbers: [3], text: "Kafka …" }, 0.47) returns
//   { id: "fd04…", filename: "school.pdf", section: "Kafka", pages: [3], text: "Kafka …", score: 0.47 }
// Missing payload fields become null (filename, section), [] (pages) or "" (text).
function toChunk(id: string | number, payload: Record<string, unknown> | null | undefined, score: number | null): Chunk {
  const data = payload ?? {};
  return {
    id: String(id),
    filename: asText(data.filename),
    section: asText(data.section),
    pages: Array.isArray(data.pageNumbers) ? data.pageNumbers.filter((n) => typeof n === "number") : [],
    text: asText(data.text) ?? "",
    score,
  };
}

// Examples: asText("Kafka") returns "Kafka"; asText(42) returns null; asText(undefined) returns null.
function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
