import { describe, it, expect } from 'vitest';
import {
  slashCommands,
  findSlashCommand,
  SlashCommandContext,
  TuiMessage,
  TuiViewMode,
} from '../src/index.js';
import { PolicyMode } from '@forge/safety';

describe('Slash Commands Registry', () => {
  it('registers all 15 required slash commands', () => {
    const requiredCommands = [
      '/help',
      '/clear',
      '/compact',
      '/model',
      '/cost',
      '/permissions',
      '/sandbox',
      '/memory',
      '/checkpoints',
      '/rewind',
      '/branch',
      '/resume',
      '/handoff',
      '/doctor',
      '/exit',
    ];

    for (const cmd of requiredCommands) {
      const match = slashCommands.find((c) => c.name === cmd);
      expect(match, `Command ${cmd} should be registered`).toBeDefined();
    }
  });

  it('findSlashCommand: accurately parses command and arguments', () => {
    const parsedModel = findSlashCommand('/model claude-3-5-sonnet');
    expect(parsedModel?.cmd.name).toBe('/model');
    expect(parsedModel?.args).toBe('claude-3-5-sonnet');

    const parsedRewind = findSlashCommand('/rewind');
    expect(parsedRewind?.cmd.name).toBe('/rewind');
    expect(parsedRewind?.args).toBe('');

    const parsedUnknown = findSlashCommand('/nonexistent');
    expect(parsedUnknown).toBeNull();

    const parsedNormalText = findSlashCommand('regular prompt');
    expect(parsedNormalText).toBeNull();
  });

  it('executes /help, /memory, /checkpoints, /permissions, /doctor successfully', async () => {
    const messages: TuiMessage[] = [];
    let currentView: TuiViewMode = 'chat';
    let currentMode: PolicyMode = 'default';

    const ctx: SlashCommandContext = {
      setViewMode: (mode) => {
        currentView = mode;
      },
      addMessage: (msg) => {
        messages.push(msg);
      },
      clearMessages: () => {
        messages.length = 0;
      },
      currentModel: 'gpt-4o',
      cwd: '/workspace',
      mode: currentMode,
      setMode: (m) => {
        currentMode = m;
      },
    };

    // /help
    const helpCmd = findSlashCommand('/help');
    await helpCmd?.cmd.handler(helpCmd.args, ctx);
    expect(messages.some((m) => m.content.includes('Available Slash Commands'))).toBe(true);

    // /memory
    const memCmd = findSlashCommand('/memory');
    await memCmd?.cmd.handler(memCmd.args, ctx);
    expect(currentView).toBe('memory_browser');

    // /checkpoints
    const cpCmd = findSlashCommand('/checkpoints');
    await cpCmd?.cmd.handler(cpCmd.args, ctx);
    expect(currentView).toBe('checkpoints_tree');

    // /rewind
    const rwCmd = findSlashCommand('/rewind');
    await rwCmd?.cmd.handler(rwCmd.args, ctx);
    expect(currentView).toBe('rewind_picker');

    // /permissions
    const permCmd = findSlashCommand('/permissions plan');
    await permCmd?.cmd.handler(permCmd.args, ctx);
    expect(currentMode).toBe('plan');

    // /doctor
    const docCmd = findSlashCommand('/doctor');
    await docCmd?.cmd.handler(docCmd.args, ctx);
    expect(messages.some((m) => m.content.includes('Diagnostic Report'))).toBe(true);

    // /clear
    const clearCmd = findSlashCommand('/clear');
    await clearCmd?.cmd.handler(clearCmd.args, ctx);
    expect(messages.length).toBe(0);
  });
});
