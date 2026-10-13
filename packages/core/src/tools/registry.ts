import { ITool } from './base.js';
import { ToolDefinition } from '../provider/types.js';

export class ToolRegistry {
  private readonly tools = new Map<string, ITool<unknown, unknown>>();

  register(tool: ITool<unknown, unknown>): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ITool<unknown, unknown> | undefined {
    return this.tools.get(name);
  }

  list(): readonly ITool<unknown, unknown>[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): readonly ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.getParametersSchema(),
    }));
  }

  isReadOnly(toolName: string): boolean {
    const tool = this.tools.get(toolName);
    return tool ? tool.isReadOnly : false;
  }
}
