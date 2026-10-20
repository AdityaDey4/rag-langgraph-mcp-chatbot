import { handleRequest } from "@/langgraph/api";

const MAX_BODY_BYTES = 16 * 1024;

// POST { question, threadId? }  or  POST { decision: { approve, args? }, threadId }
export async function POST(request: Request) {
  // 1. Refuse a body that is too big before reading it.
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body is too large." }, { status: 413 });
  }

  // 2. The body must be JSON.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  // 3. The rest (validation, the agent, errors) is in src/langgraph/api.ts.
  const result = await handleRequest(body);

  return Response.json(result.body, { status: result.status });
}
