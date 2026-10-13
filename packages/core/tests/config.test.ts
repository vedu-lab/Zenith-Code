import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/loader.js';
import { IFileSystem } from '../src/interfaces/index.js';

describe('Layered Configuration Loader', () => {
  it('should load default configuration when no files or env exist', async () => {
    const config = await loadConfig({ env: {} });
    expect(config.models.main).toBe('claude-3-5-sonnet');
    expect(config.models.fast).toBe('claude-3-5-haiku');
    expect(config.agent.maxTurns).toBe(30);
    expect(config.providers.ollama.baseUrl).toBe('http://127.0.0.1:11434');
  });

  it('should merge global, project, env, and CLI overrides with proper precedence', async () => {
    const mockFiles = new Map<string, string>([
      [
        '/home/user/.forge/config.json',
        JSON.stringify({
          models: { main: 'global-model', fast: 'global-fast' },
          agent: { maxTurns: 10 },
        }),
      ],
      [
        '/workspace/.forge/config.json',
        JSON.stringify({
          models: { main: 'project-model' },
          tools: { bashTimeoutMs: 15000 },
        }),
      ],
    ]);

    const mockFs: IFileSystem = {
      readFile: async (p) => mockFiles.get(p) ?? '',
      writeFile: async () => {},
      exists: async (p) => mockFiles.has(p),
      mkdir: async () => {},
      readDir: async () => [],
      stat: async () => ({ size: 0, isDirectory: false, mtimeMs: 0 }),
      preserveLineEndings: (_o, n) => n,
    };

    const env = {
      ANTHROPIC_API_KEY: 'sk-ant-test',
      FORGE_MAIN_MODEL: 'env-model',
    };

    const config = await loadConfig({
      fs: mockFs,
      homeDir: '/home/user',
      projectRoot: '/workspace',
      env,
      cliOverrides: {
        agent: {
          headless: true,
          json: true,
          maxTurns: 50,
          temperature: 0.2,
          maxRetries: 3,
          systemPromptVariant: 'standard',
        },
      },
    });

    // CLI overrides beat everything
    expect(config.agent.headless).toBe(true);
    expect(config.agent.maxTurns).toBe(50);
    // Env beats project config
    expect(config.models.main).toBe('env-model');
    // Project config overrides global config
    expect(config.tools.bashTimeoutMs).toBe(15000);
    // Global config provides fast model
    expect(config.models.fast).toBe('global-fast');
    // Env sets api key
    expect(config.providers.anthropic.apiKey).toBe('sk-ant-test');
  });
});
