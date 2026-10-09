import "dotenv/config";

import { QdrantClient } from "@qdrant/js-client-rest";

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
});

async function main() {
  const result = await qdrant.getCollections();

  console.log("Connected to Qdrant!");
  console.log(result);
}

main().catch((error) => {
  console.error("Qdrant connection failed:", error);
  process.exit(1);
});