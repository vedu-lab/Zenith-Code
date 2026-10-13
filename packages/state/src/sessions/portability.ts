import { z } from 'zod';
import { VersionedSessionFile } from './types.js';

const SessionFileSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  status: z.enum(['active', 'completed', 'failed', 'aborted']),
  messages: z.array(z.unknown()),
  toolCalls: z.array(z.unknown()),
  checkpointRefs: z.array(z.string()),
  memoryRefs: z.array(z.string()),
  usage: z.object({
    totalPromptTokens: z.number().nonnegative(),
    totalCompletionTokens: z.number().nonnegative(),
    totalCostUsd: z.number().nonnegative(),
  }),
  stopReason: z.string().optional(),
});

export function exportSession(
  session: VersionedSessionFile,
  format: 'json' | 'markdown' = 'json',
): string {
  if (format === 'json') {
    return JSON.stringify(session, null, 2);
  }

  // Format as readable session summary markdown
  const header = `# Session: ${session.title}\n\n- **ID**: \`${session.id}\`\n- **Status**: ${session.status}\n- **Tokens**: ${session.usage.totalPromptTokens + session.usage.totalCompletionTokens}\n- **Cost**: $${session.usage.totalCostUsd.toFixed(4)}\n\n`;
  const messages = `## Conversation (${session.messages.length} messages)\n\n${session.messages
    .map((m: unknown, i) => {
      const msg = m as { role?: string; content?: string };
      return `### Message ${i + 1} (${msg.role ?? 'unknown'})\n${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`;
    })
    .join('\n\n')}\n`;

  return header + messages;
}

export function importSession(content: string): VersionedSessionFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse session JSON: ${(err as Error).message}`);
  }

  const result = SessionFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid session file schema: ${result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
    );
  }

  return result.data as VersionedSessionFile;
}
