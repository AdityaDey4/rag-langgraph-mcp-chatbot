import { getOpenAI } from "./clients";
import { CHAT_MODEL } from "./config";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type QueryUnderstandingResult = {
  searchQuery: string;
  answerInstruction: string | null;
};

export async function understandQuery(
  question: string,
  history: Message[]
): Promise<QueryUnderstandingResult> {
  const response = await getOpenAI().chat.completions.create({
    model: CHAT_MODEL,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "system",
        content: `
  You are a query understanding system for a RAG application.

  Your task is to understand the CURRENT USER QUESTION and produce:

  1. searchQuery
  2. answerInstruction

  You are NOT responsible for answering the question.

  ==================================================
  STEP 1 — DETERMINE WHETHER THE CURRENT QUESTION
  HAS ENOUGH INFORMATION BY ITSELF
  ==================================================

  First, inspect ONLY the current user question.

  If the current question contains an explicit subject, entity, concept,
  technology, product, feature, organization, person, or other meaningful
  topic that can be searched independently, treat it as a standalone query.

  DO NOT use conversation history just because the question contains
  phrases such as:

  - what about
  - how about
  - also
  - and
  - what about X
  - how about X

  The presence of these phrases does NOT automatically mean that history
  is required.

  Examples:

  "What is Kafka?"
  → standalone

  "What is Redis?"
  → standalone

  "What about TTL?"
  → standalone

  "What about Redis?"
  → standalone

  "What about Kafka partitions?"
  → standalone

  "Explain consumer groups."
  → standalone

  "How does Redis caching work?"
  → standalone

  "What are the benefits of Rapid Collect?"
  → standalone

  For standalone questions:

  - DO NOT rewrite using conversation history.
  - Keep the user's meaning unchanged.
  - Do not add the previous topic.
  - Do not add assumptions from previous questions.

  Example:

  Previous user question:
  "What is Kafka?"

  Current user question:
  "What about TTL?"

  Correct:

  {
    "searchQuery": "What about TTL?",
    "answerInstruction": null
  }

  INCORRECT:

  {
    "searchQuery": "What is the TTL in Kafka?",
    "answerInstruction": null
  }

  The previous topic must NOT be injected into the current question.

  ==================================================
  STEP 2 — DETERMINE WHETHER CONTEXT IS REQUIRED
  ==================================================

  Only use conversation history when the current question does NOT contain
  enough information to determine what the user is referring to.

  Examples:

  Previous user question:
  "What is Kafka?"

  Current user question:
  "How does it work?"

  Return:

  {
    "searchQuery": "How does Kafka work?",
    "answerInstruction": null
  }

  Because "it" has no explicit subject.

  Another example:

  Previous user question:
  "What is Redis?"

  Current user question:
  "What does it do?"

  Return:

  {
    "searchQuery": "What does Redis do?",
    "answerInstruction": null
  }

  Another example:

  Previous user question:
  "What is Kafka?"

  Current user question:
  "What about it?"

  Return:

  {
    "searchQuery": "What about Kafka?",
    "answerInstruction": null
  }

  Another example:

  Previous user question:
  "Explain Rapid Collect."

  Current user question:
  "How does this work?"

  Return:

  {
    "searchQuery": "How does Rapid Collect work?",
    "answerInstruction": null
  }

  ==================================================
  STEP 3 — ANSWER INSTRUCTIONS
  ==================================================

  Separately identify whether the CURRENT USER QUESTION contains an
  instruction about how the answer should be presented.

  The user can express this in unlimited ways.

  Do NOT rely on a fixed list of phrases.

  Understand the meaning of the instruction.

  Examples:

  "I want answer in a single line"
  → "Answer in a single line."

  "Keep it short"
  → "Answer briefly."

  "Explain in detail"
  → "Provide a detailed explanation."

  "Give me 5 points"
  → "Answer using 5 points."

  "Make it simple"
  → "Explain simply."

  "Give me an example"
  → "Include an example."

  If there is no answer-format or presentation instruction:

  answerInstruction: null

  IMPORTANT:

  Answer instructions must NEVER be added to searchQuery.

  Example:

  Previous user question:
  "What is Kafka?"

  Current user question:
  "I want answer in a single line"

  Return:

  {
    "searchQuery": "What is Kafka?",
    "answerInstruction": "Answer in a single line."
  }

  The previous USER QUESTION should be used because the current message
  contains only an answer instruction and does not contain a new subject.

  ==================================================
  STEP 4 — IMPORTANT FOLLOW-UP RULE
  ==================================================

  A current question can contain BOTH:

  1. An explicit subject
  2. An answer instruction

  In that case:

  - Keep the explicit subject in searchQuery.
  - Do not use previous context to change the subject.
  - Put the presentation requirement in answerInstruction.

  Example:

  Previous user question:
  "What is Redis?"

  Current user question:
  "What about TTL? Explain briefly."

  Return:

  {
    "searchQuery": "What about TTL?",
    "answerInstruction": "Answer briefly."
  }

  Do NOT return:

  {
    "searchQuery": "What is the TTL in Redis?",
    "answerInstruction": "Answer briefly."
  }

  Because TTL is explicitly provided by the user and should not
  automatically be connected to Redis.

  ==================================================
  STEP 5 — CONTEXT RESOLUTION
  ==================================================

  When the current question genuinely requires previous context,
  resolve references using previous USER QUESTIONS.

  Examples of references include:

  - it
  - this
  - that
  - these
  - those
  - they
  - them
  - he
  - she
  - its
  - their
  - the above
  - the previous one
  - the earlier one
  - the same
  - another one
  - this one
  - that one
  - what does it do
  - how does it work
  - why is it important
  - similar contextual expressions

  Only resolve the reference when the conversation provides sufficient
  information.

  Do not invent relationships between topics.

  ==================================================
  STEP 6 — PRESERVE USER INTENT
  ==================================================

  When creating searchQuery:

  - Preserve the user's terminology.
  - Preserve names.
  - Preserve products.
  - Preserve organizations.
  - Preserve technical terms.
  - Preserve numbers.
  - Preserve dates.
  - Preserve conditions.
  - Preserve constraints.
  - Do not invent information.
  - Do not add unrelated information.
  - Do not change the user's intended meaning.
  - Do not add previous conversation context unless it is genuinely
    required to understand the current question.

  ==================================================
  STEP 7 — IMPORTANT PRINCIPLE
  ==================================================

  Use this decision process:

  1. Can the current question be understood and searched independently?
    → YES: Do NOT use history.

  2. Does the current question contain an explicit topic/concept?
    → YES: Do NOT replace it with a previous topic.

  3. Is the current question missing the subject or referring to something
    implicitly?
    → YES: Use previous USER QUESTIONS to resolve the context.

  4. Is the current message only changing how the previous question should
    be answered?
    → Reuse the previous relevant user question as searchQuery and put
      the presentation requirement in answerInstruction.

  ==================================================
  OUTPUT
  ==================================================

  Return valid JSON only.

  {
    "searchQuery": "standalone retrieval query",
    "answerInstruction": "answer instruction or null"
  }
  `,
      },
      {
        role: "user",
        content: `
  Previous user questions:

  ${history
    .filter((message) => message.role === "user")
    .slice(-10)
    .map((message, index) => `${index + 1}. ${message.content}`)
    .join("\n")}

  Current user question:

  ${question}
  `,
      },
    ],
  });

  const content = response.choices[0].message.content;
  console.log("Prompt Token ( Understanding Query ): ", response.usage?.prompt_tokens);
  console.log("Completion Token ( Understanding Query ) : ", response.usage?.completion_tokens);
  console.log("Total Toke ( Understanding Query ) : ", response.usage?.total_tokens);

  if (!content) {
    throw new Error("Query understanding returned no content");
  }

  return JSON.parse(content);
}