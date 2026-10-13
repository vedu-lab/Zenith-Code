import { describe, it, expect } from 'vitest';
import { SystemPromptBuilder } from '../src/prompt/builder.js';
import { IFileSystem } from '../src/interfaces/index.js';

describe('SystemPromptBuilder & Precedence', () => {
  it('should load AGENTS.md over CLAUDE.md and GEMINI.md by precedence', async () => {
    const files = new Map<string, string>([
      ['/workspace/AGENTS.md', 'Highest priority agent rules'],
      ['/workspace/CLAUDE.md', 'Claude rules'],
      ['/workspace/GEMINI.md', 'Gemini rules'],
    ]);

    const mockFs: IFileSystem = {
      readFile: async (p) => files.get(p) ?? '',
      writeFile: async () => {},
      exists: async (p) => files.has(p),
      mkdir: async () => {},
      readDir: async () => [],
      stat: async () => ({ size: 0, isDirectory: false, mtimeMs: 0 }),
      preserveLineEndings: (_o, n) => n,
    };

    const builder = new SystemPromptBuilder(mockFs, '/workspace');
    const prompt = await builder.build();

    expect(prompt).toContain('[Loaded from AGENTS.md]');
    expect(prompt).toContain('Highest priority agent rules');
    expect(prompt).not.toContain('Claude rules');
  });

  it('should fallback to CLAUDE.md if AGENTS.md is absent', async () => {
    const files = new Map<string, string>([
      ['/workspace/CLAUDE.md', 'Claude specific instructions'],
      ['/workspace/GEMINI.md', 'Gemini rules'],
    ]);

    const mockFs: IFileSystem = {
      readFile: async (p) => files.get(p) ?? '',
      writeFile: async () => {},
      exists: async (p) => files.has(p),
      mkdir: async () => {},
      readDir: async () => [],
      stat: async () => ({ size: 0, isDirectory: false, mtimeMs: 0 }),
      preserveLineEndings: (_o, n) => n,
    };

    const builder = new SystemPromptBuilder(mockFs, '/workspace');
    const prompt = await builder.build();

    expect(prompt).toContain('[Loaded from CLAUDE.md]');
    expect(prompt).toContain('Claude specific instructions');
  });

  it('should support strict and compact variants for small models', async () => {
    const mockFs: IFileSystem = {
      readFile: async () => '',
      writeFile: async () => {},
      exists: async () => false,
      mkdir: async () => {},
      readDir: async () => [],
      stat: async () => ({ size: 0, isDirectory: false, mtimeMs: 0 }),
      preserveLineEndings: (_o, n) => n,
    };

    const builder = new SystemPromptBuilder(mockFs, '/workspace');
    const strictPrompt = await builder.build({ variant: 'strict' });
    const standardPrompt = await builder.build({ variant: 'standard' });

    expect(strictPrompt.length).toBeLessThan(standardPrompt.length);
    expect(strictPrompt).toContain('Read existing files before editing');
  });
});
