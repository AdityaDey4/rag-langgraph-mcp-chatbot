// Reads the documents from Qdrant. The tools in ./tools use these functions. (A copy of src/langgraph/retrieval.ts, so this folder stands alone.)
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { COLLECTION_NAME, EMBEDDING_MODEL } from "./config";

// A passage of a document. `score` is only set when found by a search.
export type Chunk = {
  id: string;
  filename: string | null;
  section: string | null;
  pages: number[];
  text: string;
  score: number | null;
};

// Created on first use, so importing this file doesn't need the environment variables.
let embeddings: OpenAIEmbeddings | undefined;
let qdrant: QdrantClient | undefined;

// Example: returns the embeddings helper, created once and reused
function getEmbeddings() {
  return (embeddings ??= new OpenAIEmbeddings({ model: EMBEDDING_MODEL }));
}

// Example: returns the Qdrant connection (http://localhost:6333), created once and reused
function getQdrant() {
  return (qdrant ??= new QdrantClient({ url: process.env.QDRANT_URL! }));
}

// Example: searchChunks("What is Kafka?", 2) returns the 2 closest passages, best first: [ { id: "fd04…", section: "Kafka", score: 0.47, … }, … ]
export async function searchChunks(query: string, limit: number): Promise<Chunk[]> {
  const vector = await getEmbeddings().embedQuery(query);

  const result = await getQdrant().query(COLLECTION_NAME, {
    query: vector,
    limit,
    with_payload: true,
  });

  return result.points.map((point) => toChunk(point.id, point.payload, point.score));
}

// Example: getChunkById("fd04…") returns { id: "fd04…", section: "Kafka", score: null, … }, or null if there is no such id
export async function getChunkById(id: string): Promise<Chunk | null> {
  const points = await getQdrant().retrieve(COLLECTION_NAME, { ids: [id], with_payload: true });
  return points.length > 0 ? toChunk(points[0].id, points[0].payload, null) : null;
}

// Example: listDocuments() returns [ { documentId: "document_001", filename: "school.pdf", sections: ["DBMS", "Redis", …], chunkCount: 9 } ]
export async function listDocuments() {
  const documents = new Map<string, { filename: string | null; sections: string[]; chunkCount: number }>();

  // Qdrant returns the points in pages; keep asking until there is no next page.
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

// Example: getSectionChunks("DBMS") returns the 2 passages of the section DBMS in document order: [ { id: "…", section: "DBMS", pages: [1], … }, { id: "…", section: "DBMS", pages: [2], … } ]
// An unknown section returns an empty list. (Added in M3; the LangGraph copy does not have it.)
export async function getSectionChunks(section: string): Promise<Chunk[]> {
  const page = await getQdrant().scroll(COLLECTION_NAME, {
    limit: 64,
    with_payload: true,
    with_vector: false,
    filter: { must: [{ key: "section", match: { value: section } }] },
  });

  // The passages come back in any order, so they are put in the order of the document.
  const inOrder = [...page.points].sort((a, b) => Number(a.payload?.chunkIndex ?? 0) - Number(b.payload?.chunkIndex ?? 0));

  return inOrder.map((point) => toChunk(point.id, point.payload, null));
}

// Example: toChunk("fd04…", { filename: "school.pdf", section: "Kafka", pageNumbers: [3], text: "…" }, 0.47) returns { id: "fd04…", filename: "school.pdf", section: "Kafka", pages: [3], text: "…", score: 0.47 }
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

// Example: asText("Kafka") returns "Kafka"; asText(42) and asText(undefined) return null
function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
