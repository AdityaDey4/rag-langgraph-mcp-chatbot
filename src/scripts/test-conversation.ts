import "dotenv/config";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const history = [
  {
    role: "user",
    content: "What is kafka?",
  },
  {
    role: "assistant",
    content:
      "Kafka is a distributed event-streaming platform designed to handle large volumes of events reliably.",
  },
  {
    role: "user",
    content: "What is consumer group?",
  },
  {
    role: "assistant",
    content:
      "A consumer group in Kafka is a collection of consumers that work together to read events from topics.",
  },
  {
    role: "user",
    content: "What is acknowledgement in kafka?",
  },
  {
    role: "assistant",
    content:
      "In Kafka, acknowledgements (acks) can be configured by producers to control how much broker confirmation is required.",
  },
  {
    role: "user",
    content: "What is producer in kafka?",
  },
  {
    role: "assistant",
    content:
      "A Kafka producer is an entity that publishes events to topics within the Kafka event-streaming platform.",
  },
];

function buildConversationContext() {
  return history
    .map((message) => {
      const role = message.role === "user" ? "User" : "Assistant";

      return `${role}: ${message.content}`;
    })
    .join("\n\n");
}

async function main() {
  const question = "What in consumer?";

  const conversationContext = buildConversationContext();

  console.log("Conversation Context:");
  console.log(conversationContext);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You answer questions about the conversation history.

Use only the conversation history as your source of truth.

Do not use external knowledge.
Do not invent conversation history.

Conversation history:

${conversationContext}
        `,
      },
      {
        role: "user",
        content: question,
      },
    ],
  });

  const answer = response.choices[0].message.content;

  console.log("\nQuestion:");
  console.log(question);

  console.log("\nAnswer:");
  console.log(answer);
}

main().catch(console.error);