// The API logic, without Next.js, so it can be tested.
// The route (src/app/api/langgraph/route.ts) only passes the request body to handleRequest.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { graph, resumeAgent, runAgent, type Step } from "./agent";

// 1. What the caller may send: a question, or a decision for a run that is waiting for approval.
const RequestSchema = z
  .object({
    question: z.string().trim().min(1).max(2000).optional(),
    threadId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "threadId may only have letters, digits, _ and -").optional(),
    decision: z
      .object({
        approve: z.boolean(),
        args: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  })
  .refine((body) => !(body.question && body.decision), "Send a question or a decision, not both.")
  .refine((body) => body.question || (body.decision && body.threadId), "Send a question, or a decision together with the threadId of the paused run.");

// 2. The agent functions the API uses. Tests pass fake ones.
type Agent = {
  run: typeof runAgent;
  resume: typeof resumeAgent;
  isWaiting: (threadId: string) => Promise<boolean>;
};

const realAgent: Agent = {
  run: runAgent,
  resume: resumeAgent,
  // A run that is waiting for approval has a node left to run.
  isWaiting: async (threadId) => {
    const saved = await graph.getState({ configurable: { thread_id: threadId } });
    return saved.next.length > 0;
  },
};

export type ApiResponse = {
  status: number;
  body: Record<string, unknown>;
};

// Example: handleRequest({ question: "What is Kafka?" }) returns { status: 200, body: { requestId: "…", threadId: "…", status: "answered", answer: "Apache Kafka is …" } }
// Other results: 400 bad input, 409 nothing to approve, 502 empty answer, 504 too slow, 500 something broke
export async function handleRequest(body: unknown, agent: Agent = realAgent, timeoutMs = 60_000): Promise<ApiResponse> {
  const requestId = randomUUID();
  const startedAt = Date.now();
  let threadId = "-";

  // One log line per request. It has names and counts only, never the question or the answer.
  function finish(status: number, responseBody: Record<string, unknown>, steps: Step[] = []): ApiResponse {
    const inputTokens = steps.reduce((sum, step) => sum + step.inputTokens, 0);
    const outputTokens = steps.reduce((sum, step) => sum + step.outputTokens, 0);

    console.log(
      JSON.stringify({
        scope: "langgraph-api",
        requestId,
        threadId,
        status,
        ms: Date.now() - startedAt,
        steps: steps.length,
        inputTokens,
        outputTokens,
      }),
    );

    return { status, body: { requestId, ...responseBody } };
  }

  // 3. Check the input.
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => issue.message).join("; ");
    return finish(400, { error: problems });
  }

  const { question, decision } = parsed.data;
  threadId = parsed.data.threadId ?? randomUUID();

  // 4. The run has a time limit. When it is over, the run is cancelled.
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    // A decision is only accepted for a run that is waiting for one.
    if (decision && !(await agent.isWaiting(threadId))) {
      return finish(409, { error: "No run is waiting for approval on this thread." });
    }

    const result = question
      ? await agent.run(question, threadId, { signal })
      : await agent.resume(decision!, threadId, { signal });

    if (signal.aborted) {
      return finish(504, { error: "The agent took too long.", threadId }, result.steps);
    }

    // The run stopped at an approval: the caller must send a decision with the same threadId.
    if ("approval" in result) {
      return finish(200, { threadId, status: "needs_approval", approval: result.approval }, result.steps);
    }

    // 5. Check the output.
    if (!result.answer.trim()) {
      return finish(502, { error: "The agent returned an empty answer." }, result.steps);
    }

    return finish(200, { threadId, status: "answered", answer: result.answer }, result.steps);
  } catch (error) {
    // The details go to the server log, not to the caller.
    console.error(`[langgraph-api ${requestId}]`, error);

    if (signal.aborted) {
      return finish(504, { error: "The agent took too long.", threadId });
    }
    return finish(500, { error: "Something went wrong." });
  }
}
