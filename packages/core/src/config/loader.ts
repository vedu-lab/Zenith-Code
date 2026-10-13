import path from 'node:path';
import { IFileSystem } from '../interfaces/index.js';
import { ConfigError } from '../errors/index.js';
import { ForgeConfig, ForgeConfigSchema } from './schema.js';

export interface LoadConfigOptions {
  readonly cliOverrides?: Partial<ForgeConfig> | undefined;
  readonly projectRoot?: string | undefined;
  readonly homeDir?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly fs?: IFileSystem | undefined;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, val] of Object.entries(source)) {
    if (val !== undefined && val !== null) {
      if (
        typeof val === 'object' &&
        !Array.isArray(val) &&
        typeof target[key] === 'object' &&
        target[key] !== null
      ) {
        result[key] = deepMerge(
          target[key] as Record<string, unknown>,
          val as Record<string, unknown>,
        );
      } else {
        result[key] = val;
      }
    }
  }
  return result;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ForgeConfig> {
  const env = options.env ?? process.env;
  let merged: Record<string, unknown> = {};

  // 1. Load global config: ~/.forge/config.json
  const home = options.homeDir ?? env['HOME'] ?? env['USERPROFILE'] ?? '';
  if (home && options.fs) {
    const globalConfigPath = path.join(home, '.forge', 'config.json');
    if (await options.fs.exists(globalConfigPath)) {
      try {
        const raw = await options.fs.readFile(globalConfigPath);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        merged = deepMerge(merged, parsed);
      } catch (err) {
        throw new ConfigError(`Failed to parse global config at ${globalConfigPath}`, {
          cause: err,
        });
      }
    }
  }

  // 2. Load project config: <projectRoot>/.forge/config.json
  const projectRoot = options.projectRoot ?? process.cwd();
  if (options.fs) {
    const projectConfigPath = path.join(projectRoot, '.forge', 'config.json');
    if (await options.fs.exists(projectConfigPath)) {
      try {
        const raw = await options.fs.readFile(projectConfigPath);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        merged = deepMerge(merged, parsed);
      } catch (err) {
        throw new ConfigError(`Failed to parse project config at ${projectConfigPath}`, {
          cause: err,
        });
      }
    }
  }

  // 3. Apply Environment Variables
  const envConfig: Record<string, unknown> = {
    providers: {
      anthropic: {
        apiKey: env['ANTHROPIC_API_KEY'],
        baseUrl: env['ANTHROPIC_BASE_URL'],
      },
      openai: {
        apiKey: env['OPENAI_API_KEY'],
        baseUrl: env['OPENAI_BASE_URL'],
      },
      gemini: {
        apiKey: env['GEMINI_API_KEY'] ?? env['GOOGLE_API_KEY'],
        baseUrl: env['GEMINI_BASE_URL'],
      },
      ollama: {
        baseUrl: env['OLLAMA_HOST'] ?? env['OLLAMA_BASE_URL'],
      },
    },
    models: {
      main: env['FORGE_MAIN_MODEL'] ?? env['FORGE_MODEL'],
      fast: env['FORGE_FAST_MODEL'],
      planner: env['FORGE_PLANNER_MODEL'],
      summarizer: env['FORGE_SUMMARIZER_MODEL'],
      autocomplete: env['FORGE_AUTOCOMPLETE_MODEL'],
    },
    agent: {
      maxTurns: env['FORGE_MAX_TURNS'] ? Number(env['FORGE_MAX_TURNS']) : undefined,
      headless:
        env['FORGE_HEADLESS'] === 'true' || env['FORGE_HEADLESS'] === '1' ? true : undefined,
      json: env['FORGE_JSON'] === 'true' || env['FORGE_JSON'] === '1' ? true : undefined,
    },
  };

  merged = deepMerge(merged, envConfig);

  // 4. Apply CLI Overrides
  if (options.cliOverrides) {
    merged = deepMerge(merged, options.cliOverrides as Record<string, unknown>);
  }

  // 5. Parse and validate with defaults
  const parsed = ForgeConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ConfigError(`Config validation failed: ${parsed.error.message}`, {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}
