import { z } from 'zod';
import { BaseTool } from './base.js';
import { PolicyGate, ToolActionIntent } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';

export const TaskItemSchema = z.object({
  id: z.string().optional().describe('Task identifier'),
  title: z.string().min(1).describe('Task description or title'),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).describe('Task status'),
});
export type TaskItem = z.infer<typeof TaskItemSchema>;

export const TodoWriteInputSchema = z.object({
  tasks: z.array(TaskItemSchema).describe('Complete list of tasks in the todo plan'),
});
export type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>;

export class TodoWriteTool extends BaseTool<TodoWriteInput, string> {
  readonly name = 'todo_write';
  readonly description =
    'Create or update the structured TODO list and task plan for tracking progress.';
  readonly schema = TodoWriteInputSchema;
  override readonly isReadOnly = false;

  private currentTasks: TaskItem[] = [];

  constructor(policyGate: PolicyGate, eventBus?: IEventBus) {
    super(policyGate, eventBus);
  }

  getCurrentTasks(): readonly TaskItem[] {
    return [...this.currentTasks];
  }

  override getParametersSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              },
            },
            required: ['title', 'status'],
          },
        },
      },
      required: ['tasks'],
    };
  }

  protected createIntent(input: TodoWriteInput): ToolActionIntent {
    return {
      toolName: this.name,
      actionType: 'state:modify',
      target: 'session:todos',
      parameters: { count: input.tasks.length },
    };
  }

  protected async executeAction(input: TodoWriteInput): Promise<string> {
    this.currentTasks = input.tasks.map((t, idx) => ({
      ...t,
      id: t.id ?? `task-${idx + 1}`,
    }));

    const formatted = this.currentTasks
      .map((t) => {
        const symbol =
          t.status === 'completed'
            ? '[x]'
            : t.status === 'in_progress'
              ? '[/]'
              : t.status === 'cancelled'
                ? '[-]'
                : '[ ]';
        return `${symbol} ${t.id}: ${t.title} (${t.status})`;
      })
      .join('\n');

    return `Updated TODO list (${this.currentTasks.length} tasks):\n${formatted}`;
  }
}
