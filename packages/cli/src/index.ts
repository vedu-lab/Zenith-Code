export * from './io/filesystem.js';
export * from './io/process-runner.js';
export * from './bootstrap.js';

import { bootstrapApp } from './bootstrap.js';

export interface CliArgs {
  readonly command: string;
  readonly task: string;
  readonly headless: boolean;
  readonly json: boolean;
  readonly model?: string | undefined;
  readonly maxTurns?: number | undefined;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args = [...argv];
  let command = 'run';
  let task = '';
  let headless = false;
  let json = false;
  let model: string | undefined = undefined;
  let maxTurns: number | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === 'run') {
      command = 'run';
    } else if (arg === '--headless') {
      headless = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--model' && i + 1 < args.length) {
      model = args[++i];
    } else if (arg === '--max-turns' && i + 1 < args.length) {
      maxTurns = Number(args[++i]);
    } else if (!arg.startsWith('-') && !task) {
      task = arg;
    }
  }

  return {
    command,
    task,
    headless,
    json,
    model,
    maxTurns,
  };
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(argv);

  if (!parsed.task) {
    // If no task specified, print usage
    // eslint-disable-next-line no-console
    console.log(
      'Usage: forge run "<task>" [--headless] [--json] [--model <name>] [--max-turns <n>]',
    );
    process.exitCode = 2;
    return;
  }

  const container = await bootstrapApp({
    configOverrides: {
      agent: {
        headless: parsed.headless,
        json: parsed.json,
        maxTurns: parsed.maxTurns ?? 30,
        temperature: 0,
        maxRetries: 3,
        systemPromptVariant: 'standard',
      },
      ...(parsed.model
        ? {
            models: {
              main: parsed.model,
              fast: parsed.model,
              planner: parsed.model,
              summarizer: parsed.model,
              autocomplete: parsed.model,
            },
          }
        : {}),
    },
  });

  if (parsed.headless || parsed.json) {
    const result = await container.headlessRunner.run({
      task: parsed.task,
      json: parsed.json,
      model: parsed.model,
      maxTurns: parsed.maxTurns,
    });
    process.exitCode = result.exitCode;
  } else {
    // Interactive / standard run
    const session = await container.sessionManager.createSession(`Task: ${parsed.task}`);
    const systemPrompt = await container.promptBuilder.build();
    const result = await container.agentLoop.run(parsed.task, {
      sessionId: session.id,
      systemPrompt,
      model: parsed.model,
      maxTurns: parsed.maxTurns,
    });
    await container.sessionManager.closeSession(session.id, result.stopReason);
    process.exitCode = result.completed ? 0 : 1;
  }
}
