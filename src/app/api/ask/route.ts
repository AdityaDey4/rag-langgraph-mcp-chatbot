import "dotenv/config";

import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { addMessage, getConversation } from "@/lib/conversation-memory";
import { understandQuery } from "@/lib/query-understanding";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
});

const COLLECTION_NAME = "rag_documents";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const question = body.question;
    const conversationId = body.conversationId;

    if (!question || typeof question !== "string") {
      return Response.json(
        {
          error: "question is required",
        },
        { status: 400 }
      );
    }

    if (
      !conversationId ||
      typeof conversationId !== "string"
    ) {
      return Response.json(
        { error: "conversationId is required" },
        { status: 400 }
      );
    }
    const history = getConversation(conversationId);
    const recentHistory = history
      .filter((message) => message.role === "user")
      .slice(-10);
    const understanding = await understandQuery(
      question,
      recentHistory
    );
    console.log("Query understanding:", understanding);

    // 1. Create embedding for the question
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: understanding.searchQuery,
    });

    console.log("Prompt Token : ", embeddingResponse.usage.prompt_tokens);
    console.log("Total Toke : ", embeddingResponse.usage.total_tokens);

    const questionEmbedding = embeddingResponse.data[0].embedding;

    console.log("Question embedding created");

    // 2. Search Qdrant
    const searchResult = await qdrant.query(COLLECTION_NAME, {
      query: questionEmbedding,
      limit: 3,
      with_payload: true,
    });

    console.log(
      searchResult.points.map((point) => ({
        score: point.score,
        chunkId: point.payload?.chunkIndex,
        section: point.payload?.section,
      }))
    );

    // 3. Build context from retrieved chunks
    const context = searchResult.points
    .map((point, index) => {
        const payload = point.payload as {
        section?: string;
        text?: string;
        pageNumbers?: number[];
        };

        return `
          Source ${index + 1}
          Section: ${payload.section}
          Pages: ${payload.pageNumbers?.join(", ")}
          Text:
          ${payload.text}
          `;
        })
        .join("\n\n");

    // 4. Ask the LLM to answer using the retrieved context
    const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    {
      role: "system",
      content: `
You are a helpful and friendly document question-answering assistant.

Answer the user's question using the retrieved document context when relevant.

Important:
- Carefully read ALL retrieved sources before deciding the answer is unavailable.
- The answer may be present in any of the retrieved sources.
- Do not require the exact wording of the question to appear in the context.
- Use the meaning of the retrieved text to answer.
- Do not use outside knowledge for document-specific questions.
- Do not invent information about the document.
- Follow the user's answer-format instruction when one is provided.

Special cases:
- If the user greets you casually (like "Hi, how are you?", "What are you doing?"), respond naturally and friendly in a conversational way.
- If the user asks about learning something (like "I wanna learn Python"), be encouraging and supportive. Offer guidance if relevant information is in the document, or encouragement if not.
- Only say "I couldn't find the answer in the document." when the user is asking a specific question about the document content and the retrieved context does NOT contain relevant information to answer it.

The answer-format instruction controls ONLY how you present the answer.
It must NOT cause you to add information that is not present in the document.
`,
    },
    ...history,
    {
      role: "user",
      content: `
Document context:

${context}

Question:

${question}

Answer instruction:

${understanding.answerInstruction ?? "No special answer format. Answer naturally."}

Answer the question using only the document context.
`,
    },
  ],
});
    console.log("Prompt Token : ", response.usage?.prompt_tokens);
    console.log("Completion Token : ", response.usage?.completion_tokens);
    console.log("Total Toke : ", response.usage?.total_tokens);

    const answer = response.choices[0].message.content;
    addMessage(conversationId, {
      role: "user",
      content: understanding.searchQuery ?? question,
    });

    addMessage(conversationId, {
      role: "assistant",
      content: answer ?? "",
    });

    // 5. Return retrieved chunks
    return Response.json({
        conversationId, 
        question,
        answer,
        sources: searchResult.points,
    });
  } catch (error) {
    console.error("Ask API error:", error);

    return Response.json(
      {
        error: "Something went wrong",
      },
      { status: 500 }
    );
  }
}