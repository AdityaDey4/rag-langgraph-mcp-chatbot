import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { getOpenAI } from "../clients";
import type {
  ChatMessage,
  LlmChunk,
  LlmClient,
  LlmRequest,
  LlmToolCall,
  ToolDefinition,
} from "./types";

const RETRY_DELAY_MS = 500;

export function toOpenAITools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function toOpenAIMessages(
  messages: ChatMessage[]
): ChatCompletionMessageParam[] {
  return messages.map((message): ChatCompletionMessageParam => {
    switch (message.role) {
      case "system":
      case "user":
        return { role: message.role, content: message.content };
      case "tool":
        return {
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      case "assistant":
        return {
          role: "assistant",
          content: message.content || null,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function" as const,
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        };
    }
  });
}

export class OpenAILlmClient implements LlmClient {
  /**
   * Streams one model call. If it fails before any text has been yielded
   * (rate limit, dropped connection), it is retried once; after that,
   * retrying could duplicate output, so the error is surfaced.
   */
  async *stream(request: LlmRequest): AsyncGenerator<LlmChunk> {
    for (let attempt = 0; ; attempt++) {
      let yieldedText = false;

      try {
        for await (const chunk of this.streamOnce(request)) {
          if (chunk.type === "text") yieldedText = true;
          yield chunk;
        }
        return;
      } catch (error) {
        if (yieldedText || attempt >= 1 || request.signal?.aborted) throw error;
        await sleep(RETRY_DELAY_MS, request.signal);
      }
    }
  }

  private async *streamOnce(request: LlmRequest): AsyncGenerator<LlmChunk> {
    const hasTools = request.tools.length > 0;

    const stream = await getOpenAI().chat.completions.create(
      {
        model: request.model,
        messages: toOpenAIMessages(request.messages),
        ...(hasTools
          ? { tools: toOpenAITools(request.tools), tool_choice: "auto" as const }
          : {}),
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: request.signal }
    );

    let content = "";
    let inputTokens = 0;
    let outputTokens = 0;
    const toolCalls = new Map<number, LlmToolCall>();

    for await (const chunk of stream) {
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        yield { type: "text", text: delta.content };
      }

      for (const part of delta.tool_calls ?? []) {
        const existing = toolCalls.get(part.index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        if (part.id) existing.id = part.id;
        if (part.function?.name) existing.name += part.function.name;
        if (part.function?.arguments) {
          existing.arguments += part.function.arguments;
        }
        toolCalls.set(part.index, existing);
      }
    }

    yield {
      type: "done",
      reply: {
        content,
        toolCalls: [...toolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => call),
        usage: { inputTokens, outputTokens },
      },
    };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}
