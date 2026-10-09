import "dotenv/config";

import { QdrantClient } from "@qdrant/js-client-rest";

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
});

const COLLECTION_NAME = "rag_documents";

async function main() {
  const collections = await qdrant.getCollections();

  const exists = collections.collections.some(
    (collection) => collection.name === COLLECTION_NAME
  );

  if (exists) {
    console.log(`Collection "${COLLECTION_NAME}" already exists.`);
    return;
  }

  await qdrant.createCollection(COLLECTION_NAME, {
    vectors: {
      size: 3072,
      distance: "Cosine",
    },
  });

  console.log(`Collection "${COLLECTION_NAME}" created successfully.`);
}

main().catch((error) => {
  console.error("Qdrant setup failed:", error);
  process.exit(1);
});