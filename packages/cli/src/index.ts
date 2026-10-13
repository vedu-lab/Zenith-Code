export * from './io/filesystem.js';
export * from './io/process-runner.js';
export * from './bootstrap.js';

import fs from 'node:fs';
import path from 'node:path';
import { PolicyMode, verifyAuditFile } from '@forge/safety';
import { initProject, CostEstimator } from '@forge/state';
import { SessionReplayEngine, SessionDataToReplay, ReplayTurn } from '@forge/core';
import { bootstrapApp } from './bootstrap.js';
import { runEnhancedDoctor } from './commands/doctor.js';

export interface CliArgs {
  readonly command: 'run' | 'doctor' | 'caps' | 'audit' | 'init' | 'usage' | 'replay';
  readonly subcommand?: string | undefined;
  readonly task: string;
  readonly headless: boolean;
  readonly json: boolean;
  readonly offline: boolean;
  readonly estimate: boolean;
  readonly liveTools: boolean;
  readonly since?: string | undefined;
  readonly mode?: PolicyMode | undefined;
  readonly model?: string | undefined;
  readonly maxTurns?: number | undefined;
  readonly extraArgs: readonly string[];
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args = [...argv];
  let command: 'run' | 'doctor' | 'caps' | 'audit' | 'init' | 'usage' | 'replay' = 'run';
  let subcommand: string | undefined = undefined;
  let task = '';
  let headless = false;
  let json = false;
  let offline = false;
  let estimate = false;
  let liveTools = false;
  let since: string | undefined = undefined;
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
    } else if (arg === 'init') {
      command = 'init';
    } else if (arg === 'usage') {
      command = 'usage';
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
    } else if (arg === 'replay') {
      command = 'replay';
    } else if (arg === '--live-tools') {
      liveTools = true;
    } else if (arg === '--headless') {
      headless = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--offline') {
      offline = true;
    } else if (arg === '--estimate') {
      estimate = true;
    } else if (arg === '--since' && i + 1 < args.length) {
      since = args[++i];
    } else if (arg === '--mode' && i + 1 < args.length) {
      mode = args[++i] as PolicyMode;
    } else if (arg === '--model' && i + 1 < args.length) {
      model = args[++i];
    } else if (arg === '--max-turns' && i + 1 < args.length) {
      maxTurns = Number(args[++i]);
    } else if (!arg.startsWith('-')) {
      if (!task && (command === 'run' || command === 'replay')) {
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
    estimate,
    liveTools,
    since,
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
    const report = await runEnhancedDoctor();
    // eslint-disable-next-line no-console
    console.log('=== Forge Doctor: System & Environment Diagnostics ===');
    for (const item of report.checks) {
      const statusIcon = item.passed ? '✔' : '✖';
      // eslint-disable-next-line no-console
      console.log(`[${statusIcon}] [${item.category}] ${item.name}: ${item.value}`);
      if (item.details) {
        // eslint-disable-next-line no-console
        console.log(`    ↳ ${item.details}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log('------------------------------------------------------');
    // eslint-disable-next-line no-console
    console.log(
      report.allPassed
        ? 'System is fully ready for Forge.'
        : 'Some recommended tools or services are missing.',
    );
    process.exitCode = report.allPassed ? 0 : 1;
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

  // Command 4: forge init
  if (parsed.command === 'init') {
    const result = await initProject({ projectRoot: process.cwd() });
    if (parsed.json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
    } else {
      // eslint-disable-next-line no-console
      console.log('=== Forge Project Initialization ===');
      if (result.generatedFiles.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`Generated: ${result.generatedFiles.join(', ')}`);
      }
      if (result.syncedFiles.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`Synced: ${result.syncedFiles.join(', ')}`);
      }
      if (result.contradictions.length > 0) {
        console.warn('Contradictions detected:');
        for (const c of result.contradictions) {
          console.warn(`  - ${c}`);
        }
      } else {
        // eslint-disable-next-line no-console
        console.log('No instruction contradictions detected.');
      }
    }
    process.exitCode = 0;
    return;
  }

  // Command 5: forge usage [--since <period>] [--json]
  if (parsed.command === 'usage') {
    const container = await bootstrapApp();
    const period = parsed.since ?? '7d';
    const report = container.usageLedger.queryUsage({ since: period });
    if (parsed.json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(report, null, 2));
    } else {
      // eslint-disable-next-line no-console
      console.log(`=== Forge Usage Ledger (Since: ${period}) ===`);
      // eslint-disable-next-line no-console
      console.log(`Total Records: ${report.recordsCount}`);
      // eslint-disable-next-line no-console
      console.log(`Prompt Tokens: ${report.totalPromptTokens.toLocaleString()}`);
      // eslint-disable-next-line no-console
      console.log(`Completion Tokens: ${report.totalCompletionTokens.toLocaleString()}`);
      // eslint-disable-next-line no-console
      console.log(`Total Tokens: ${report.totalTokens.toLocaleString()}`);
      // eslint-disable-next-line no-console
      console.log(`Total Cost: $${report.totalCostUsd.toFixed(4)} USD`);
      // eslint-disable-next-line no-console
      console.log(`Avg Latency: ${report.averageLatencyMs.toFixed(1)} ms`);
    }
    process.exitCode = 0;
    return;
  }

  // Command 6: forge replay <sessionId> [--live-tools]
  if (parsed.command === 'replay') {
    const sessionId = parsed.task || parsed.extraArgs[0];
    if (!sessionId) {
      console.error(
        'Error: Provide session ID or file path: forge replay <sessionId> [--live-tools]',
      );
      process.exitCode = 1;
      return;
    }

    const container = await bootstrapApp();
    let sessionData: SessionDataToReplay | null = null;

    let sessionFilePath = sessionId;
    if (!fs.existsSync(sessionFilePath)) {
      sessionFilePath = path.join(process.cwd(), '.forge', 'sessions', `${sessionId}.json`);
    }

    if (fs.existsSync(sessionFilePath)) {
      try {
        const raw = fs.readFileSync(sessionFilePath, 'utf8');
        const parsedJson = JSON.parse(raw) as {
          id?: string;
          title?: string;
          turns?: readonly ReplayTurn[];
          messages?: ReadonlyArray<{ role?: string; content?: string }>;
          toolCalls?: ReadonlyArray<{
            id?: string;
            toolName?: string;
            parameters?: Record<string, unknown>;
            output?: unknown;
            turnIndex?: number;
          }>;
        };

        const turns: ReplayTurn[] = parsedJson.turns
          ? [...parsedJson.turns]
          : (parsedJson.messages ?? []).map((m, i) => ({
              turnIndex: i + 1,
              userMessage: m.role === 'user' ? m.content : undefined,
              modelOutput: m.role === 'assistant' ? (m.content ?? '') : '',
              toolCalls: (parsedJson.toolCalls ?? [])
                .filter((tc) => tc.turnIndex === i + 1)
                .map((tc) => ({
                  id: tc.id ?? `call-${i}`,
                  toolName: tc.toolName ?? 'unknown',
                  parameters: tc.parameters ?? {},
                  output: tc.output,
                })),
            }));

        sessionData = {
          id: parsedJson.id ?? sessionId,
          title: parsedJson.title,
          turns,
        };
      } catch (err) {
        console.error(`Failed to load session file ${sessionFilePath}:`, err);
        process.exitCode = 1;
        return;
      }
    }

    if (!sessionData) {
      console.error(`Session '${sessionId}' not found in .forge/sessions/ or specified path.`);
      process.exitCode = 1;
      return;
    }

    const replayEngine = new SessionReplayEngine(container.eventBus);
    // eslint-disable-next-line no-console
    console.log(
      `=== Replaying Session: ${sessionData.id} (${sessionData.turns.length} turns, liveTools=${parsed.liveTools}) ===`,
    );

    const result = await replayEngine.replay(sessionData, {
      liveTools: parsed.liveTools,
      toolRegistry: container.tools,
      onStep: (turn) => {
        // eslint-disable-next-line no-console
        console.log(
          `[Turn ${turn.turnIndex}] Model: ${turn.modelOutput.slice(0, 80)}... (${turn.toolCalls.length} tool calls)`,
        );
      },
    });

    if (result.driftDetected) {
      console.warn(
        `[DRIFT DETECTED] ${result.drifts.length} tool calls drifted from recorded outputs:`,
      );
      for (const d of result.drifts) {
        console.warn(`  - [Turn ${d.turnIndex}] ${d.toolName}: ${d.diffDescription}`);
      }
      process.exitCode = 1;
    } else {
      // eslint-disable-next-line no-console
      console.log(`✔ Replay completed successfully. All ${result.turnsReplayed} turns verified.`);
      process.exitCode = 0;
    }
    return;
  }

  // Command 7: forge run "<task>"
  if (!parsed.task) {
    // eslint-disable-next-line no-console
    console.log(
      'Usage: forge run "<task>" [--estimate] [--headless] [--json] [--offline] [--mode default|acceptEdits|plan|bypass] [--model <name>] [--max-turns <n>]',
    );
    process.exitCode = 2;
    return;
  }

  if (parsed.estimate) {
    const model = parsed.model ?? 'claude-3-5-sonnet';
    const estimator = new CostEstimator();
    const est = estimator.estimate(parsed.task, model);
    if (parsed.json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(est, null, 2));
    } else {
      // eslint-disable-next-line no-console
      console.log(`=== Cost Estimate for: "${parsed.task}" ===`);
      // eslint-disable-next-line no-console
      console.log(`Model: ${model}`);
      // eslint-disable-next-line no-console
      console.log(
        `Cost Range: $${est.low.toFixed(4)} - $${est.high.toFixed(4)} USD (Expected: $${est.expected.toFixed(4)})`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `Estimated Tokens: ~${est.tokensEstimated.input} in / ~${est.tokensEstimated.output} out`,
      );
      // eslint-disable-next-line no-console
      console.log('Assumptions:');
      for (const a of est.assumptions) {
        // eslint-disable-next-line no-console
        console.log(`  - ${a}`);
      }
    }
    process.exitCode = 0;
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
