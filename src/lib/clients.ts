import "./config";

import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

// Created lazily so that importing this module never requires every
// environment variable (e.g. the Qdrant setup script needs no OpenAI key).
let openaiClient: OpenAI | undefined;
let qdrantClient: QdrantClient | undefined;

export function getOpenAI(): OpenAI {
  openaiClient ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  return openaiClient;
}

export function getQdrant(): QdrantClient {
  qdrantClient ??= new QdrantClient({
    url: process.env.QDRANT_URL!,
  });
  return qdrantClient;
}
