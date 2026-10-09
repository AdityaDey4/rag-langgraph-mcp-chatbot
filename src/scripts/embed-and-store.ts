import "dotenv/config";

import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { n8nOutput } from "../data/n8n-output";
import { randomUUID } from "crypto";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
});

const COLLECTION_NAME = "rag_documents";

async function main() {
  const chunks = n8nOutput.pdf_data.chunks;

  console.log(`Found ${chunks.length} chunks`);

  // 1. Extract text from chunks
  const texts = chunks.map((chunk) => chunk.text);

  // 2. Generate embeddings
  console.log("Generating embeddings...");

  const response = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: texts,
  });
  console.log("Prompt Token : ", response.usage.prompt_tokens);
  console.log("Total Toke : ", response.usage.total_tokens);

  console.log("Embeddings generated");

  // 3. Prepare Qdrant points
  const points = chunks.map((chunk, index) => ({
    id: randomUUID(),

    vector: response.data[index].embedding,

    payload: {
      documentId: "document_001",
      filename: "school.pdf",
      chunkIndex: chunk.chunkIndex,
      pageNumbers: chunk.pageNumbers,
      section: chunk.section,
      text: chunk.text,
    },
  }));

  // 4. Store points in Qdrant
  console.log("Storing points in Qdrant...");

  await qdrant.upsert(COLLECTION_NAME, {
    wait: true,
    points,
  });

  console.log(
    `Successfully stored ${points.length} chunks in Qdrant`
  );
}

main().catch((error) => {
  console.error("Embedding/storage failed:", error);
  process.exit(1);
});