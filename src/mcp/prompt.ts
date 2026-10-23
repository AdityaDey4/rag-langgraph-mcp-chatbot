// Marks a tool's output as untrusted data, so a model won't obey instructions found inside documents.
// (Copied from src/langgraph/prompt.ts, so this folder stands alone.)
// Example: wrapToolResult("calculate", "3 + 4 = 7") returns '<tool_result tool="calculate" untrusted="true">\n3 + 4 = 7\n</tool_result>'
export function wrapToolResult(toolName: string, text: string): string {
  // Remove tags inside the text, so it can't close the wrapper early.
  const safeText = text.replace(/<\/?tool_result[^>]*>/gi, "[tag removed]");

  return `<tool_result tool="${toolName}" untrusted="true">\n${safeText}\n</tool_result>`;
}
