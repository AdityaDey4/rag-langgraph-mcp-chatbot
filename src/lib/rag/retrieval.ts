import { getOpenAI, getQdrant } from "../clients";
import { COLLECTION_NAME, EMBEDDING_MODEL } from "../config";

type Qdrant = ReturnType<typeof getQdrant>;
export type QdrantPoint = Awaited<ReturnType<Qdrant["query"]>>["points"][number];

export type EmbeddingUsage = {
  promptTokens: number;
  totalTokens: number;
};

export type RetrievedChunk = {
  chunkId: string;
  documentId: string | null;
  filename: string | null;
  chunkIndex: number | null;
  section: string | null;
  pageNumbers: number[];
  text: string;
  score: number | null;
};

export type DocumentSummary = {
  documentId: string;
  filename: string | null;
  chunkCount: number;
  /** Distinct section titles, in the order first seen. */
  sections: string[];
};

export async function embedQuery(
  text: string
): Promise<{ embedding: number[]; usage: EmbeddingUsage }> {
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  return {
    embedding: response.data[0].embedding,
    usage: {
      promptTokens: response.usage.prompt_tokens,
      totalTokens: response.usage.total_tokens,
    },
  };
}

/**
 * Dense search returning raw Qdrant points. `/api/ask` uses this directly so
 * its response shape is unchanged; the agent tools use `searchChunks`.
 */
export async function searchPoints(
  query: string,
  limit: number
): Promise<{ points: QdrantPoint[]; usage: EmbeddingUsage }> {
  const { embedding, usage } = await embedQuery(query);

  const result = await getQdrant().query(COLLECTION_NAME, {
    query: embedding,
    limit,
    with_payload: true,
  });

  return { points: result.points, usage };
}

export async function searchChunks(
  query: string,
  limit: number
): Promise<RetrievedChunk[]> {
  const { points } = await searchPoints(query, limit);
  return points.map((point) => toChunk(point.id, point.payload, point.score));
}

export async function getChunkById(
  chunkId: string
): Promise<RetrievedChunk | null> {
  const points = await getQdrant().retrieve(COLLECTION_NAME, {
    ids: [chunkId],
    with_payload: true,
    with_vector: false,
  });

  if (points.length === 0) return null;
  return toChunk(points[0].id, points[0].payload, null);
}

const SCROLL_PAGE_SIZE = 256;
const SCROLL_MAX_POINTS = 20_000;

export async function listDocuments(): Promise<DocumentSummary[]> {
  const qdrant = getQdrant();
  const documents = new Map<string, DocumentSummary>();

  let offset: string | number | Record<string, unknown> | null | undefined;
  let scanned = 0;

  do {
    const page = await qdrant.scroll(COLLECTION_NAME, {
      limit: SCROLL_PAGE_SIZE,
      offset: offset ?? undefined,
      with_payload: ["documentId", "filename", "section", "chunkIndex"],
      with_vector: false,
    });

    for (const point of page.points) {
      const payload = point.payload ?? {};
      const documentId = asString(payload.documentId) ?? "unknown";
      const section = asString(payload.section);
      const existing = documents.get(documentId);

      if (existing) {
        existing.chunkCount += 1;
        if (section && !existing.sections.includes(section)) {
          existing.sections.push(section);
        }
      } else {
        documents.set(documentId, {
          documentId,
          filename: asString(payload.filename),
          chunkCount: 1,
          sections: section ? [section] : [],
        });
      }
    }

    scanned += page.points.length;
    offset = page.next_page_offset;
  } while (offset != null && scanned < SCROLL_MAX_POINTS);

  return [...documents.values()];
}

function toChunk(
  id: string | number,
  payload: QdrantPoint["payload"] | Record<string, unknown> | null | undefined,
  score: number | null
): RetrievedChunk {
  const data = payload ?? {};

  return {
    chunkId: String(id),
    documentId: asString(data.documentId),
    filename: asString(data.filename),
    chunkIndex: typeof data.chunkIndex === "number" ? data.chunkIndex : null,
    section: asString(data.section),
    pageNumbers: Array.isArray(data.pageNumbers)
      ? data.pageNumbers.filter((n): n is number => typeof n === "number")
      : [],
    text: asString(data.text) ?? "",
    score,
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
