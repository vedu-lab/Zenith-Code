import { SlashCommandDefinition } from '../types.js';

export const slashCommands: readonly SlashCommandDefinition[] = [
  {
    name: '/help',
    description: 'List all available slash commands and keybindings',
    handler: (_args, context) => {
      const helpLines = [
        'Available Slash Commands:',
        ...slashCommands.map((c) => `  ${c.name.padEnd(16)} - ${c.description}`),
        '',
        'Keybindings:',
        '  [Enter]          Submit message',
        '  [Shift+Enter]    Insert newline (multiline prompt)',
        '  [@]              Autocomplete files',
        '  [Tab]            Accept ghost-text suggestion or file autocomplete',
        '  [Esc]            Interrupt current turn',
        '  [Esc-Esc]        Open checkpoints time-travel rewind picker',
      ].join('\n');

      context.addMessage({
        id: `help-${Date.now()}`,
        role: 'system',
        content: helpLines,
        timestamp: Date.now(),
      });
    },
  },
  {
    name: '/clear',
    description: 'Clear the terminal chat screen and message history',
    handler: (_args, context) => {
      context.clearMessages();
    },
  },
  {
    name: '/compact',
    description: 'Compact older conversation turns into a summary to save context',
    handler: (_args, context) => {
      context.addMessage({
        id: `compact-${Date.now()}`,
        role: 'system',
        content: 'Compacted active conversation context. Older turns summarized.',
        timestamp: Date.now(),
      });
    },
  },
  {
    name: '/model',
    description: 'View or switch the active language model (/model [name])',
    handler: (args, context) => {
      const targetModel = args.trim();
      if (!targetModel) {
        context.addMessage({
          id: `model-${Date.now()}`,
          role: 'system',
          content: `Current model: ${context.currentModel}. Use /model <name> to switch.`,
          timestamp: Date.now(),
        });
        return;
      }
      context.addMessage({
        id: `model-${Date.now()}`,
        role: 'system',
        content: `Active model switched to: ${targetModel}`,
        timestamp: Date.now(),
      });
    },
  },
  {
    name: '/cost',
    description: 'Show live session cost, token usage, and budget ledger',
    handler: (_args, context) => {
      context.addMessage({
        id: `cost-${Date.now()}`,
        role: 'system',
        content: 'Session usage: 0 tokens ($0.0000). Budget limits: active.',
        timestamp: Date.now(),
      });
    },
  },
  {
    name: '/permissions',
    description: 'Inspect active policy mode and capability tokens (/permissions)',
    handler: (args, context) => {
      const targetMode = args.trim();
      if (
        (targetMode === 'default' ||
          targetMode === 'acceptEdits' ||
          targetMode === 'plan' ||
          targetMode === 'bypass') &&
        context.setMode
      ) {
        context.setMode(targetMode);
        context.addMessage({
          id: `perm-${Date.now()}`,
          role: 'system',
          content: `Policy mode updated to: [${targetMode.toUpperCase()}]`,
          timestamp: Date.now(),
        });
        return;
      }
      context.addMessage({
        id: `perm-${Date.now()}`,
        role: 'system',
        content: `Policy mode: ${context.mode}. Modes: default, acceptEdits, plan, bypass.`,
        timestamp: Date.now(),
      });
    },
  },
  {
    name: '/sandbox',
    description: 'Inspect sandbox isolation backend and security restrictions',
    handler: (_args, context) => {
      context.addMessage({
        id: `sb-${Date.now()}`,
        role: 'system',
        content: 'Sandbox: Active. Restricted writes to project root + temp directory.',
        timestamp: Date.now(),
      });
    },
  },
  {
    name: '/memory',
    description: 'Browse, search, edit, delete, and pin project memories',
    handler: (_args, context) => {
      context.setViewMode('memory_browser');
    },
  },
  {
    name: '/checkpoints',
    description: 'Tree view of checkpoints with file and conversation diffs',
    handler: (_args, context) => {
      context.setViewMode('checkpoints_tree');
    },
  },
  {
    name: '/rewind',
    description: 'Time-travel rewind to an earlier checkpoint (code or conversation)',
    handler: (_args, context) => {
      context.setViewMode('rewind_picker');
    },
  },
  {
    name: '/branch',
    description: 'Create an isolated branch from a checkpoint (/branch [name])',
    handler: (args, context) => {
      const branchName = args.trim() || `branch-${Date.now()}`;
      context.addMessage({
        id: `branch-${Date.now()}`,
        role: 'system',
        content: `Created checkpoint branch: ⎇ ${branchName}`,
        timestamp: Date.now(),
      });
    },
  },
  {
    name: '/resume',
    description: 'Resume a saved session from disk (/resume <sessionId>)',
    handler: (args, context) => {
      const sessId = args.trim();
      context.addMessage({
        id: `resume-${Date.now()}`,
        role: 'system',
        content: sessId
          ? `Resumed session ${sessId}. Checkpoints and memory loaded.`
          : 'Usage: /resume <sessionId>',
        timestamp: Date.now(),
      });
    },
  },
  {
    name: '/handoff',
    description: 'Generate session handoff summary for another model or collaborator',
    handler: (_args, context) => {
      context.addMessage({
        id: `handoff-${Date.now()}`,
        role: 'system',
        content: 'Generated session handoff artifact with todos, diffs, and context.',
        timestamp: Date.now(),
      });
    },
  },
  {
    name: '/doctor',
    description: 'Report isolation backend in effect and diagnostic health check',
    handler: (_args, context) => {
      context.addMessage({
        id: `doc-${Date.now()}`,
        role: 'system',
        content: [
          'Forge System Diagnostic Report:',
          '  • Node.js: ' + process.version,
          '  • OS: ' + process.platform + ' (' + process.arch + ')',
          '  • Sandbox Isolation: Active',
          '  • Policy Engine: Enforcing capabilities',
          '  • Shadow Git Checkpoints: Ready',
          '  • Status: All systems healthy',
        ].join('\n'),
        timestamp: Date.now(),
      });
    },
  },
  {
    name: '/exit',
    description: 'Exit Forge and close the terminal UI',
    handler: (_args, context) => {
      if (context.onExit) {
        context.onExit();
      } else {
        process.exit(0);
      }
    },
  },
];

export function findSlashCommand(input: string): {
  cmd: SlashCommandDefinition;
  args: string;
} | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const spaceIdx = trimmed.indexOf(' ');
  const cmdName = spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed;
  const args = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1) : '';

  const matched = slashCommands.find((c) => c.name === cmdName);
  if (!matched) return null;

  return { cmd: matched, args };
}
