// The adapter: it turns the tools of an MCP server into tools that a LangChain model and LangGraph can use.
// An MCP tool is a definition (name, description, input schema). A LangChain tool is a function plus the same three things.
import { tool } from "@langchain/core/tools";
import { log } from "./log";

// 1. The two things the adapter needs from a client. The real client has more; tests pass a fake one.
type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

type McpToolResult = {
  content?: { type: string; text?: string }[];
  isError?: boolean;
};

export type ToolSource = {
  listTools(): Promise<{ tools: McpToolDefinition[] }>;
  callTool(call: { name: string; arguments: Record<string, unknown> }): Promise<McpToolResult>;
};

// 2. Read the text of a result. A result is a list of blocks; the text blocks are joined, any other block is only named.
// Example: textOf({ content: [{ type: "text", text: "Kafka is a log." }] }) returns "Kafka is a log."
export function textOf(result: McpToolResult): string {
  const blocks = result.content ?? [];

  return blocks.map((block) => (block.type === "text" ? (block.text ?? "") : `[${block.type} content]`)).join("\n");
}

// 3. One LangChain tool for every tool the server lists.
// Example: loadTools(client) returns [ a tool named "search_documents", a tool named "get_chunk", a tool named "list_documents" ]
export async function loadTools(client: ToolSource) {
  const { tools } = await client.listTools();
  log("agent", `asked the server for its tools (tools/list): ${tools.map((definition) => definition.name).join(", ")}`);

  return tools.map((definition) => {
    // The schema is passed on as it is, only without "$schema" (the model's API does not need it).
    const schema = { ...definition.inputSchema };
    delete schema.$schema;

    return tool(
      async (args) => {
        // This is the moment the call leaves the agent and goes to the server.
        log("agent", `→ tools/call ${definition.name} ${JSON.stringify(args)}   (sent to the server)`);
        const startedAt = Date.now();

        const result = await client.callTool({ name: definition.name, arguments: args as Record<string, unknown> });
        const text = textOf(result);

        log("agent", `← result from the server: ${text.length} characters, isError=${result.isError ?? false}, ${Date.now() - startedAt} ms`);

        // A failed tool call is thrown, and the tools node turns it into an error message for the model.
        if (result.isError) {
          throw new Error(text);
        }

        return text;
      },
      {
        name: definition.name,
        description: definition.description ?? "",
        schema,
      },
    );
  });
}
