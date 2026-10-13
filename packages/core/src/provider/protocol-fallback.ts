import { ToolDefinition, Message, ToolCall } from './types.js';

export function formatFallbackSystemInstructions(tools: readonly ToolDefinition[]): string {
  if (tools.length === 0) {
    return '';
  }

  const toolList = tools
    .map(
      (t) =>
        `### Tool: ${t.name}\n${t.description}\nParameters JSON Schema:\n${JSON.stringify(t.parameters, null, 2)}`,
    )
    .join('\n\n');

  return `\n\n## AVAILABLE TOOLS
You can invoke tools when needed. To call a tool, respond with an XML block formatted exactly as:
<tool_call>
{
  "name": "TOOL_NAME",
  "arguments": { ... }
}
</tool_call>

You may call multiple tools sequentially if needed. Do not make up arguments; follow the schema exactly.
Available tools:\n${toolList}\n`;
}

export function parseFallbackToolCalls(text: string): {
  readonly toolCalls: readonly ToolCall[];
  readonly cleanedText: string;
} {
  const toolCalls: ToolCall[] = [];
  const regex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawJson = match[1]?.trim() ?? '';
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      if (typeof parsed['name'] === 'string') {
        const id = `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        toolCalls.push({
          id,
          name: parsed['name'],
          arguments: (parsed['arguments'] as Record<string, unknown>) ?? {},
        });
      }
    } catch {
      // Incomplete or invalid JSON
    }
  }

  const cleanedText = text.replace(regex, '').trim();
  return { toolCalls, cleanedText };
}

export function injectFallbackProtocol(
  messages: readonly Message[],
  tools: readonly ToolDefinition[],
): readonly Message[] {
  if (tools.length === 0) {
    return messages;
  }

  const fallbackInstructions = formatFallbackSystemInstructions(tools);
  const result: Message[] = [];
  let systemFound = false;

  for (const m of messages) {
    if (m.role === 'system' && !systemFound) {
      result.push({
        ...m,
        content: m.content + fallbackInstructions,
      });
      systemFound = true;
    } else {
      result.push(m);
    }
  }

  if (!systemFound) {
    result.unshift({
      role: 'system',
      content: fallbackInstructions,
    });
  }

  return result;
}
