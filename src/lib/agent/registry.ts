import { z } from "zod";
import type {
  CallOptions,
  Tool,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./types";

export const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_OUTPUT_CHARS = 6_000;

const TRUNCATION_MARKER = "\n…[truncated]";

type Entry = {
  definition: ToolDefinition;
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
};

/** Identity helper: lets TypeScript infer the handler's argument type from the schema. */
export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool;
}

export class ToolRegistry {
  private readonly entries = new Map<string, Entry>();

  register<S extends z.ZodType>(tool: Tool<S>): this {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) {
      throw new Error(`Invalid tool name: "${tool.name}"`);
    }
    if (this.entries.has(tool.name)) {
      throw new Error(`Tool already registered: "${tool.name}"`);
    }

    this.entries.set(tool.name, {
      definition: {
        name: tool.name,
        description: tool.description,
        parameters: toParameters(tool.inputSchema),
      },
      execute: async (args, ctx) =>
        tool.run(tool.inputSchema.parse(args) as z.output<S>, ctx),
    });

    return this;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  list(): ToolDefinition[] {
    return [...this.entries.values()].map((entry) => entry.definition);
  }

  /**
   * Validate, run, time-limit and truncate one tool call. Never throws:
   * unknown tools, bad arguments, timeouts and handler exceptions all come
   * back as `isError` results so the model can recover.
   *
   * `rawArgs` may be the JSON string straight from the model, or an object.
   */
  async call(
    name: string,
    rawArgs: unknown,
    ctx: ToolContext,
    options: CallOptions = {}
  ): Promise<ToolResult> {
    const entry = this.entries.get(name);
    if (!entry) {
      const known = [...this.entries.keys()].join(", ");
      return errorResult(`Unknown tool "${name}". Available tools: ${known}.`);
    }

    const parsed = parseArguments(rawArgs);
    if (!parsed.ok) return errorResult(parsed.message);

    const validation = z
      .object({})
      .loose()
      .safeParse(parsed.value);
    if (!validation.success) {
      return errorResult("Arguments must be a JSON object.");
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const maxChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

    // A real (ref'd) timer rather than AbortSignal.timeout(): the latter does
    // not keep the process alive, so a hung tool could let a CLI exit silently.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const toolCtx: ToolContext = {
      ...ctx,
      signal: AbortSignal.any([ctx.signal, timeout.signal]),
    };

    try {
      const result = await raceWithAbort(
        entry.execute(parsed.value, toolCtx),
        toolCtx.signal,
        () =>
          timeout.signal.aborted
            ? new Error(`Tool "${name}" timed out after ${timeoutMs} ms.`)
            : new Error(`Tool "${name}" was aborted.`)
      );
      return truncate(result, maxChars);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorResult(
          `Invalid arguments for "${name}": ${formatIssues(error)}`
        );
      }
      return truncate(
        errorResult(error instanceof Error ? error.message : String(error)),
        maxChars
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function toParameters(schema: z.ZodType): Record<string, unknown> {
  // io: "input" so fields with defaults are described as optional to the model.
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}

function parseArguments(
  raw: unknown
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (typeof raw !== "string") return { ok: true, value: raw ?? {} };
  if (raw.trim() === "") return { ok: true, value: {} };

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, message: "Arguments were not valid JSON." };
  }
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  makeError: () => Error
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(makeError());

    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function truncate(result: ToolResult, maxChars: number): ToolResult {
  if (result.content.length <= maxChars) return result;

  return {
    ...result,
    content: result.content.slice(0, maxChars) + TRUNCATION_MARKER,
    truncated: true,
  };
}

function errorResult(message: string): ToolResult {
  return { content: `Error: ${message}`, isError: true };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
