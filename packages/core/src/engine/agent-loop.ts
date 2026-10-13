import { IProvider, Message, ToolCall, StopReason } from '../provider/types.js';
import { globalCapabilityRegistry } from '../provider/capabilities.js';
import { ToolRegistry } from '../tools/registry.js';
import { IEventBus } from '../events/index.js';
import { IClock } from '../interfaces/index.js';
import { ForgeError, ErrorCode } from '../errors/index.js';
import {
  DoneGate,
  EvidenceCollector,
  TaskPlanner,
  TrustPlan,
  PlanDriftDetector,
  EscalationEngine,
  ComplexityClassifier,
  HumanHandoffManager,
  HandoffBrief,
  VerificationResult,
  AttemptLog,
} from '../trust/index.js';
import { FileChangeRecord, TestExecutionRecord } from '../trust/fake-detection.js';

export interface AgentLoopOptions {
  readonly sessionId: string;
  readonly model?: string | undefined;
  readonly maxTurns?: number | undefined;
  readonly systemPrompt?: string | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly temperature?: number | undefined;
  readonly enablePromptCaching?: boolean | undefined;

  // Trust and verification configurations
  readonly doneGate?: DoneGate | undefined;
  readonly planner?: TaskPlanner | undefined;
  readonly initialPlan?: TrustPlan | undefined;
  readonly driftDetector?: PlanDriftDetector | undefined;
  readonly escalator?: EscalationEngine | undefined;
  readonly handoffManager?: HumanHandoffManager | undefined;
  readonly fastModel?: string | undefined;
  readonly mainModel?: string | undefined;
  readonly evidenceCollector?: EvidenceCollector | undefined;
}

export interface AgentLoopRunResult {
  readonly sessionId: string;
  readonly totalTurns: number;
  readonly completed: boolean;
  readonly stopReason: string;
  readonly messages: readonly Message[];
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
  readonly activeModel: string;
  readonly handoffBrief?: HandoffBrief | undefined;
  readonly verificationResult?: VerificationResult | undefined;
  readonly trustReport?: string | undefined;
  readonly plan?: TrustPlan | undefined;
}

export class AgentLoop {
  constructor(
    private readonly provider: IProvider,
    private readonly tools: ToolRegistry,
    private readonly eventBus: IEventBus,
    private readonly clock: IClock,
  ) {}

  async run(initialUserMessage: string, options: AgentLoopOptions): Promise<AgentLoopRunResult> {
    const maxTurns = options.maxTurns ?? 30;

    // Fast Mode / Complexity routing
    const fastModel = options.fastModel ?? 'fast';
    const mainModel = options.mainModel ?? options.model ?? 'default';

    let currentModelRole: 'fast' | 'main' = 'main';
    let currentModel = mainModel;

    if (!options.model) {
      const classification = ComplexityClassifier.classify(initialUserMessage);
      currentModelRole = classification.modelRole;
      currentModel = currentModelRole === 'fast' ? fastModel : mainModel;
    } else {
      currentModel = options.model;
    }

    let caps = globalCapabilityRegistry.get(currentModel);

    // Trust tracking structures
    const changedFiles: FileChangeRecord[] = [];
    const testHistory: TestExecutionRecord[] = [];
    const touchedPaths = new Set<string>();
    const attemptLogs: AttemptLog[] = [];
    let toolValidationErrorsCount = 0;
    let failedVerificationCount = 0;
    let activePlan: TrustPlan | undefined = options.initialPlan;

    // Plan-first for non-trivial tasks if planner is injected and no initial plan was given
    if (options.planner && !activePlan) {
      const classification = ComplexityClassifier.classify(initialUserMessage);
      if (classification.level !== 'simple') {
        activePlan = options.planner.createPlan({
          steps: ['Analyze problem', 'Implement surgical modifications', 'Run verification'],
          files: [],
          verificationMethod: 'Multi-stage DoneGate loop',
        });
      }
    }

    const messages: Message[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: initialUserMessage });

    let turnIndex = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;
    let finalStopReason = 'end_turn';
    let lastHandoffBrief: HandoffBrief | undefined;
    let lastVerificationResult: VerificationResult | undefined;

    while (turnIndex < maxTurns) {
      if (options.abortSignal?.aborted) {
        finalStopReason = 'cancelled';
        break;
      }

      turnIndex++;
      const turnStartMs = this.clock.nowMs();

      await this.eventBus.publish({
        id: `turn-start-${turnIndex}-${turnStartMs}`,
        type: 'turn.started',
        timestamp: turnStartMs,
        actor: 'agent',
        payload: {
          turnIndex,
          sessionId: options.sessionId,
          model: currentModel,
        },
      });

      const toolDefs = this.tools.getDefinitions();
      const collectedToolCalls: ToolCall[] = [];
      let accumulatedAssistantText = '';
      let turnStopReason: StopReason = 'end_turn';

      // Stream from LLM provider
      try {
        const stream = this.provider.stream(messages, toolDefs, {
          model: currentModel,
          temperature: options.temperature,
          abortSignal: options.abortSignal,
          enablePromptCaching: options.enablePromptCaching ?? caps.supportsPromptCaching,
        });

        for await (const event of stream) {
          if (options.abortSignal?.aborted) {
            turnStopReason = 'cancelled';
            break;
          }

          if (event.type === 'text_delta') {
            accumulatedAssistantText += event.delta;
            await this.eventBus.publish({
              id: `evt-delta-${this.clock.nowMs()}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'model.delta',
              timestamp: this.clock.nowMs(),
              actor: 'agent',
              payload: {
                turnIndex,
                delta: event.delta,
                role: 'assistant',
              },
            });
          } else if (event.type === 'tool_call') {
            collectedToolCalls.push(event);
          } else if (event.type === 'usage') {
            totalPromptTokens += event.inputTokens;
            totalCompletionTokens += event.outputTokens;
            totalCacheReadTokens += event.cacheReadTokens ?? 0;
            totalCacheWriteTokens += event.cacheWriteTokens ?? 0;

            const costUsd =
              (event.inputTokens / 1_000_000) * caps.pricing.inputPerMillion +
              (event.outputTokens / 1_000_000) * caps.pricing.outputPerMillion +
              ((event.cacheReadTokens ?? 0) / 1_000_000) * (caps.pricing.cacheReadPerMillion ?? 0) +
              ((event.cacheWriteTokens ?? 0) / 1_000_000) *
                (caps.pricing.cacheWritePerMillion ?? 0);

            await this.eventBus.publish({
              id: `evt-usage-${this.clock.nowMs()}`,
              type: 'usage.updated',
              timestamp: this.clock.nowMs(),
              actor: 'system',
              payload: {
                sessionId: options.sessionId,
                model: currentModel,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                totalTokens: event.inputTokens + event.outputTokens,
                costUsd,
                cacheReadTokens: event.cacheReadTokens,
                cacheWriteTokens: event.cacheWriteTokens,
              },
            });
          } else if (event.type === 'stop_reason') {
            turnStopReason = event.reason;
          }
        }
      } catch (streamError) {
        const errorMsg = streamError instanceof Error ? streamError.message : String(streamError);
        await this.eventBus.publish({
          id: `evt-err-${this.clock.nowMs()}`,
          type: 'error',
          timestamp: this.clock.nowMs(),
          actor: 'agent',
          payload: {
            code: streamError instanceof ForgeError ? streamError.code : ErrorCode.PROVIDER_ERROR,
            message: errorMsg,
          },
        });
        throw streamError;
      }

      // Add assistant response to conversation history
      messages.push({
        role: 'assistant',
        content: accumulatedAssistantText,
        toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
      });

      // DONE GATE CHECK: If no tool calls, the model is attempting to finish!
      if (collectedToolCalls.length === 0) {
        finalStopReason = turnStopReason;

        // If DoneGate is active, verification loop executes
        if (options.doneGate) {
          const verifResult = await options.doneGate.verify(changedFiles, testHistory);
          lastVerificationResult = verifResult;

          if (!verifResult.passed) {
            failedVerificationCount++;
            attemptLogs.push({
              attemptNumber: verifResult.attempt,
              action: `Verification attempt ${verifResult.attempt} for ${changedFiles.length} modified files`,
              failureReason: verifResult.error ?? 'Verification failed',
            });

            // Check if escalation to main model is needed
            if (options.escalator && currentModelRole === 'fast') {
              const esc = options.escalator.evaluateEscalation({
                currentModelRole,
                currentModelName: currentModel,
                mainModelName: mainModel,
                failedVerificationAttempts: failedVerificationCount,
                touchedFilesCount: touchedPaths.size,
                toolValidationErrorsCount,
                currentContextTokens: totalPromptTokens + totalCompletionTokens,
              });

              if (esc.shouldEscalate) {
                currentModelRole = 'main';
                currentModel = mainModel;
                caps = globalCapabilityRegistry.get(currentModel);
              }
            }

            // If verification attempts are exhausted, escalate to Human Handoff!
            if (options.doneGate.isAttemptsExhausted()) {
              finalStopReason = 'verification_failed';

              if (options.handoffManager) {
                lastHandoffBrief = options.handoffManager.createHandoffBrief({
                  goal: initialUserMessage,
                  reason: 'verification_failed',
                  currentDiffSummary: changedFiles
                    .map((c) => `--- ${c.path}\n+++ ${c.path}`)
                    .join('\n'),
                  attempts: attemptLogs,
                  leadingHypothesis: verifResult.error ?? 'Unknown failure condition',
                  hypothesisEvidence: verifResult.remediation ?? 'Verification attempts exhausted',
                  unverifiedItems: changedFiles.map((c) => c.path),
                  reproCommands: Array.from(
                    new Set([
                      ...testHistory.map((t) => t.command),
                      ...(options.doneGate ? options.doneGate.getVerificationCommands() : []),
                    ]),
                  ),
                });
              }

              const turnDurationMs = this.clock.nowMs() - turnStartMs;
              await this.eventBus.publish({
                id: `turn-comp-${turnIndex}-${this.clock.nowMs()}`,
                type: 'turn.completed',
                timestamp: this.clock.nowMs(),
                actor: 'agent',
                payload: {
                  turnIndex,
                  sessionId: options.sessionId,
                  stopReason: finalStopReason,
                  durationMs: turnDurationMs,
                },
              });
              break; // Stop loop and return unfixable handoff
            }

            // Retry loop: send verification failure details back to model
            messages.push({
              role: 'user',
              content: `Verification Failed (Attempt ${verifResult.attempt}):\n${verifResult.error}\n\nRemediation:\n${verifResult.remediation}\nPlease repair the issue, run required verification, and re-test.`,
            });
            continue; // Continue agent loop
          } else {
            // Verification passed cleanly!
            finalStopReason = 'verified';
          }
        }

        const turnDurationMs = this.clock.nowMs() - turnStartMs;
        await this.eventBus.publish({
          id: `turn-comp-${turnIndex}-${this.clock.nowMs()}`,
          type: 'turn.completed',
          timestamp: this.clock.nowMs(),
          actor: 'agent',
          payload: {
            turnIndex,
            sessionId: options.sessionId,
            stopReason: finalStopReason,
            durationMs: turnDurationMs,
          },
        });
        break;
      }

      // Separate read-only tools from mutating tools
      const readOnlyCalls: ToolCall[] = [];
      const mutatingCalls: ToolCall[] = [];

      for (const call of collectedToolCalls) {
        if (this.tools.isReadOnly(call.name)) {
          readOnlyCalls.push(call);
        } else {
          mutatingCalls.push(call);
        }
      }

      // Execute read-only tools in parallel
      const readOnlyResults = await Promise.all(
        readOnlyCalls.map(async (call) => {
          const tool = this.tools.get(call.name);
          if (!tool) {
            toolValidationErrorsCount++;
            return {
              call,
              output: `Error: Tool '${call.name}' not found.`,
              isError: true,
            };
          }
          try {
            const result = await tool.execute(call.arguments);
            return {
              call,
              output: typeof result === 'string' ? result : JSON.stringify(result),
              isError: false,
            };
          } catch (err) {
            toolValidationErrorsCount++;
            const msg = err instanceof Error ? err.message : String(err);
            return {
              call,
              output: `Error executing tool '${call.name}': ${msg}`,
              isError: true,
            };
          }
        }),
      );

      for (const res of readOnlyResults) {
        messages.push({
          role: 'tool',
          content: res.output,
          toolCallId: res.call.id,
          name: res.call.name,
          isError: res.isError,
        });
      }

      // Execute mutating tools sequentially
      for (const call of mutatingCalls) {
        const tool = this.tools.get(call.name);
        if (!tool) {
          toolValidationErrorsCount++;
          messages.push({
            role: 'tool',
            content: `Error: Tool '${call.name}' not found.`,
            toolCallId: call.id,
            name: call.name,
            isError: true,
          });
          continue;
        }

        try {
          const result = await tool.execute(call.arguments);
          const outputStr = typeof result === 'string' ? result : JSON.stringify(result);

          // Track modified files
          if (
            call.name === 'write_file' ||
            call.name === 'edit_file' ||
            call.name === 'multi_edit'
          ) {
            const p = String(call.arguments['filePath'] ?? '');
            if (p) {
              touchedPaths.add(p);
              changedFiles.push({
                path: p,
                beforeContent: '',
                afterContent: outputStr,
              });
            }
          }

          // Track test executions via bash tool
          if (call.name === 'bash') {
            const cmd = String(call.arguments['command'] ?? '');
            if (
              cmd.includes('test') ||
              cmd.includes('vitest') ||
              cmd.includes('jest') ||
              cmd.includes('pytest')
            ) {
              testHistory.push({
                command: cmd,
                exitCode: 0,
                output: outputStr,
              });
            }
          }

          // Check plan drift
          if (options.driftDetector && activePlan) {
            const currentCostUsd =
              (totalPromptTokens / 1_000_000) * caps.pricing.inputPerMillion +
              (totalCompletionTokens / 1_000_000) * caps.pricing.outputPerMillion;
            options.driftDetector.checkDrift(
              activePlan,
              Array.from(touchedPaths),
              currentCostUsd,
              turnIndex,
            );
          }

          messages.push({
            role: 'tool',
            content: outputStr,
            toolCallId: call.id,
            name: call.name,
            isError: false,
          });
        } catch (err) {
          toolValidationErrorsCount++;
          const msg = err instanceof Error ? err.message : String(err);

          // Track failed test commands
          if (call.name === 'bash') {
            const cmd = String(call.arguments['command'] ?? '');
            if (
              cmd.includes('test') ||
              cmd.includes('vitest') ||
              cmd.includes('jest') ||
              cmd.includes('pytest')
            ) {
              testHistory.push({
                command: cmd,
                exitCode: 1,
                output: msg,
              });
            }
          }

          messages.push({
            role: 'tool',
            content: `Error executing tool '${call.name}': ${msg}`,
            toolCallId: call.id,
            name: call.name,
            isError: true,
          });
        }
      }

      const turnDurationMs = this.clock.nowMs() - turnStartMs;
      await this.eventBus.publish({
        id: `turn-comp-${turnIndex}-${this.clock.nowMs()}`,
        type: 'turn.completed',
        timestamp: this.clock.nowMs(),
        actor: 'agent',
        payload: {
          turnIndex,
          sessionId: options.sessionId,
          stopReason: 'tool_use',
          durationMs: turnDurationMs,
        },
      });
    }

    const isCompleted =
      finalStopReason === 'verified' || (finalStopReason === 'end_turn' && !options.doneGate);

    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const estimatedCostUsd =
      (totalPromptTokens / 1_000_000) * caps.pricing.inputPerMillion +
      (totalCompletionTokens / 1_000_000) * caps.pricing.outputPerMillion +
      ((totalCacheReadTokens ?? 0) / 1_000_000) * (caps.pricing.cacheReadPerMillion ?? 0) +
      ((totalCacheWriteTokens ?? 0) / 1_000_000) * (caps.pricing.cacheWritePerMillion ?? 0);

    const trustReport = options.evidenceCollector
      ? options.evidenceCollector.formatTrustReport(
          isCompleted ? '### Final Verification Report' : '### Incomplete / Handoff Report',
        )
      : undefined;

    return {
      sessionId: options.sessionId,
      totalTurns: turnIndex,
      completed: isCompleted,
      stopReason: finalStopReason,
      messages,
      totalTokens,
      estimatedCostUsd,
      activeModel: currentModel,
      handoffBrief: lastHandoffBrief,
      verificationResult: lastVerificationResult,
      trustReport,
      plan: activePlan,
    };
  }
}
