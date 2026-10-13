export * from './io/filesystem.js';
export * from './io/process-runner.js';
export * from './bootstrap.js';

import path from 'node:path';
import { PolicyMode, runSandboxDoctor, verifyAuditFile } from '@forge/safety';
import { bootstrapApp } from './bootstrap.js';

export interface CliArgs {
  readonly command: 'run' | 'doctor' | 'caps' | 'audit';
  readonly subcommand?: string | undefined;
  readonly task: string;
  readonly headless: boolean;
  readonly json: boolean;
  readonly offline: boolean;
  readonly mode?: PolicyMode | undefined;
  readonly model?: string | undefined;
  readonly maxTurns?: number | undefined;
  readonly extraArgs: readonly string[];
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args = [...argv];
  let command: 'run' | 'doctor' | 'caps' | 'audit' = 'run';
  let subcommand: string | undefined = undefined;
  let task = '';
  let headless = false;
  let json = false;
  let offline = false;
  let mode: PolicyMode | undefined = undefined;
  let model: string | undefined = undefined;
  let maxTurns: number | undefined = undefined;
  const extraArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === 'run') {
      command = 'run';
    } else if (arg === 'doctor') {
      command = 'doctor';
    } else if (arg === 'caps') {
      command = 'caps';
      if (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        subcommand = args[++i];
      }
    } else if (arg === 'audit') {
      command = 'audit';
      if (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        subcommand = args[++i];
      }
    } else if (arg === '--headless') {
      headless = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--offline') {
      offline = true;
    } else if (arg === '--mode' && i + 1 < args.length) {
      mode = args[++i] as PolicyMode;
    } else if (arg === '--model' && i + 1 < args.length) {
      model = args[++i];
    } else if (arg === '--max-turns' && i + 1 < args.length) {
      maxTurns = Number(args[++i]);
    } else if (!arg.startsWith('-')) {
      if (!task && command === 'run') {
        task = arg;
      } else {
        extraArgs.push(arg);
      }
    }
  }

  return {
    command,
    subcommand,
    task,
    headless,
    json,
    offline,
    mode,
    model,
    maxTurns,
    extraArgs,
  };
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(argv);

  // Command 1: forge doctor
  if (parsed.command === 'doctor') {
    const report = runSandboxDoctor();
    // eslint-disable-next-line no-console
    console.log('=== Forge Doctor: System & Sandbox Diagnostics ===');
    // eslint-disable-next-line no-console
    console.log(`OS: ${report.os}`);
    // eslint-disable-next-line no-console
    console.log(`Active Sandbox Backend: ${report.activeBackend}`);
    // eslint-disable-next-line no-console
    console.log(`Kernel Sandboxed: ${report.isOsSandboxed ? 'YES' : 'NO'}`);
    // eslint-disable-next-line no-console
    console.log(`Status: ${report.message}`);
    // eslint-disable-next-line no-console
    console.log(`Available Isolation Layers: ${report.availableBackends.join(', ')}`);
    process.exitCode = 0;
    return;
  }

  // Command 2: forge audit verify [filePath]
  if (parsed.command === 'audit') {
    if (parsed.subcommand === 'verify') {
      const auditPath = parsed.extraArgs[0] ?? path.join(process.cwd(), '.forge', 'audit.jsonl');
      const result = await verifyAuditFile(auditPath);
      if (result.valid) {
        // eslint-disable-next-line no-console
        console.log(
          `[PASS] Audit log verified: ${result.entriesCount} entries chained without tampering.`,
        );
        process.exitCode = 0;
      } else {
        console.error(
          `[FAIL] Audit log verification failed at entry ${result.tamperedIndex ?? 0}: ${result.error}`,
        );
        process.exitCode = 1;
      }
      return;
    }
    // eslint-disable-next-line no-console
    console.log('Usage: forge audit verify [path-to-audit.jsonl]');
    process.exitCode = 1;
    return;
  }

  // Command 3: forge caps list | revoke <id>
  if (parsed.command === 'caps') {
    const container = await bootstrapApp();
    if (parsed.subcommand === 'list') {
      const tokens = container.capabilities.listActiveTokens();
      // eslint-disable-next-line no-console
      console.log(`Active Capability Tokens (${tokens.length}):`);
      for (const t of tokens) {
        // eslint-disable-next-line no-console
        console.log(
          `  - [${t.id}] ${t.action} on '${t.resourcePattern}' (scope: ${t.scope}, uses: ${t.remainingUses ?? 'unlimited'})`,
        );
      }
      process.exitCode = 0;
      return;
    } else if (parsed.subcommand === 'revoke') {
      const tokenId = parsed.extraArgs[0];
      if (!tokenId) {
        console.error('Error: specify token ID to revoke: forge caps revoke <tokenId>');
        process.exitCode = 1;
        return;
      }
      const revoked = container.capabilities.revokeToken(tokenId);
      // eslint-disable-next-line no-console
      console.log(
        revoked ? `Revoked token: ${tokenId}` : `Token not found or already expired: ${tokenId}`,
      );
      process.exitCode = 0;
      return;
    }
    // eslint-disable-next-line no-console
    console.log('Usage: forge caps list | revoke <id>');
    process.exitCode = 1;
    return;
  }

  // Command 4: forge run "<task>"
  if (!parsed.task) {
    // eslint-disable-next-line no-console
    console.log(
      'Usage: forge run "<task>" [--headless] [--json] [--offline] [--mode default|acceptEdits|plan|bypass] [--model <name>] [--max-turns <n>]',
    );
    process.exitCode = 2;
    return;
  }

  const container = await bootstrapApp({
    policyMode: parsed.mode,
    offline: parsed.offline,
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
