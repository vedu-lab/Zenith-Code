import React, { useState } from 'react';
import { Box } from 'ink';
import { IEventBus } from '@forge/core';
import { PolicyMode } from '@forge/safety';
import { Checkpoint, MemoryEntry } from '@forge/state';
import {
  TuiViewMode,
  PermissionRequest,
  CapabilityPromptRequest,
  PlanPreviewData,
  SlashCommandContext,
} from './types.js';
import { useAgentEvents } from './hooks/useAgentEvents.js';
import { Header } from './components/Header.js';
import { Footer } from './components/Footer.js';
import { MessageList } from './components/MessageList.js';
import { SpinnerTodoPanel } from './components/SpinnerTodoPanel.js';
import { InputBox } from './components/InputBox.js';
import { PermissionPrompt } from './components/PermissionPrompt.js';
import { CapabilityRequestPrompt } from './components/CapabilityRequestPrompt.js';
import { PlanPreview } from './components/PlanPreview.js';
import { RewindPicker } from './components/RewindPicker.js';
import { MemoryBrowser } from './components/MemoryBrowser.js';
import { ParallelDashboard } from './components/ParallelDashboard.js';
import { ReviewerReportView } from './components/ReviewerReportView.js';
import { findSlashCommand } from './commands/slash-commands.js';

export interface AppProps {
  readonly version?: string | undefined;
  readonly model: string;
  readonly cwd?: string | undefined;
  readonly initialMode?: PolicyMode | undefined;
  readonly sessionTitle?: string | undefined;
  readonly eventBus: IEventBus;
  readonly onUserSubmit?: ((prompt: string) => Promise<void> | void) | undefined;
  readonly onInterrupt?: (() => void) | undefined;
  readonly onExit?: (() => void) | undefined;
  readonly checkpoints?: readonly Checkpoint[] | undefined;
  readonly memories?: readonly MemoryEntry[] | undefined;
  readonly onRewind?:
    ((checkpointId: string, scope: 'code' | 'conversation' | 'both') => void) | undefined;
  readonly onBranch?: ((checkpointId: string, branchName: string) => void) | undefined;
  readonly onDeleteMemory?: ((id: string) => void) | undefined;
  readonly onTogglePinMemory?: ((id: string) => void) | undefined;
  readonly fileCandidates?: readonly string[] | undefined;
}

export const App: React.FC<AppProps> = ({
  version = '0.1.0',
  model,
  cwd = process.cwd(),
  initialMode = 'default',
  sessionTitle,
  eventBus,
  onUserSubmit,
  onInterrupt,
  onExit,
  checkpoints = [],
  memories = [],
  onRewind,
  onBranch,
  onDeleteMemory,
  onTogglePinMemory,
  fileCandidates = [],
}) => {
  const [viewMode, setViewMode] = useState<TuiViewMode>('chat');
  const [mode, setMode] = useState<PolicyMode>(initialMode);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [pendingCapability, setPendingCapability] = useState<CapabilityPromptRequest | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanPreviewData | null>(null);

  const {
    messages,
    streamingText,
    toolCalls,
    todos,
    status,
    liveCost,
    contextUsagePercent,
    activeCapabilitiesCount,
    parallelData,
    addMessage,
    clearMessages,
  } = useAgentEvents({
    eventBus,
    onPermissionRequested: (req) => {
      setPendingPermission(req);
      setViewMode('permission');
    },
    onCapabilityRequested: (req) => {
      setPendingCapability(req);
      setViewMode('capability');
    },
  });

  const handleInputSubmit = (input: string): void => {
    const slash = findSlashCommand(input);
    if (slash) {
      const slashCtx: SlashCommandContext = {
        setViewMode,
        addMessage,
        clearMessages,
        currentModel: model,
        cwd,
        mode,
        setMode,
        interruptRunning: onInterrupt,
        onExit,
      };
      void slash.cmd.handler(slash.args, slashCtx);
      return;
    }

    addMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    });

    if (onUserSubmit) {
      void onUserSubmit(input);
    }
  };

  const handleInterrupt = (): void => {
    if (onInterrupt) {
      onInterrupt();
    }
  };

  const handleOpenRewindPicker = (): void => {
    setViewMode('rewind_picker');
  };

  return (
    <Box flexDirection="column" padding={1} width="100%">
      <Header version={version} model={model} cwd={cwd} mode={mode} sessionTitle={sessionTitle} />

      {/* Main View Area */}
      {viewMode === 'permission' && pendingPermission ? (
        <PermissionPrompt
          toolName={pendingPermission.toolName}
          command={pendingPermission.command}
          filePath={pendingPermission.filePath}
          diff={pendingPermission.diff}
          parameters={pendingPermission.parameters}
          onDecide={(decision, feedback) => {
            pendingPermission.onDecide(decision, feedback);
            setPendingPermission(null);
            setViewMode('chat');
          }}
        />
      ) : viewMode === 'capability' && pendingCapability ? (
        <CapabilityRequestPrompt
          resourcePattern={pendingCapability.resourcePattern}
          action={pendingCapability.action}
          durationMs={pendingCapability.durationMs}
          scope={pendingCapability.scope}
          onDecide={(decision) => {
            pendingCapability.onDecide(decision);
            setPendingCapability(null);
            setViewMode('chat');
          }}
        />
      ) : viewMode === 'plan_preview' && pendingPlan ? (
        <PlanPreview
          plan={pendingPlan}
          onApprove={() => {
            setPendingPlan(null);
            setViewMode('chat');
          }}
          onCancel={() => {
            setPendingPlan(null);
            setViewMode('chat');
          }}
        />
      ) : viewMode === 'rewind_picker' || viewMode === 'checkpoints_tree' ? (
        <RewindPicker
          checkpoints={checkpoints}
          onRewind={(cpId, scope) => {
            if (onRewind) onRewind(cpId, scope);
            setViewMode('chat');
          }}
          onBranch={(cpId, branch) => {
            if (onBranch) onBranch(cpId, branch);
          }}
          onClose={() => setViewMode('chat')}
        />
      ) : viewMode === 'memory_browser' ? (
        <MemoryBrowser
          memories={memories}
          onDelete={onDeleteMemory}
          onTogglePin={onTogglePinMemory}
          onClose={() => setViewMode('chat')}
        />
      ) : viewMode === 'parallel_dashboard' ? (
        <ParallelDashboard
          data={
            parallelData ?? {
              runId: 'run-idle',
              mode: 'compete',
              costWarning:
                'Warning: Running 2 parallel agents costs approximately 2x as much. Total cap: $1.00, concurrency cap: 2.',
              totalCostUsd: 0,
              totalCostCapUsd: 1.0,
              maxConcurrency: 2,
              agents: [],
            }
          }
          onOpenReviewerReport={() => setViewMode('reviewer_report')}
          onClose={() => setViewMode('chat')}
        />
      ) : viewMode === 'reviewer_report' ? (
        <ReviewerReportView
          summary={parallelData?.reviewerSummary ?? 'Reviewer evaluation completed.'}
          winnerId={parallelData?.winnerId}
          recommendedStrategy="pick"
          diff={parallelData?.mergedDiff}
          onApprove={() => {
            addMessage({
              id: `merge-${Date.now()}`,
              role: 'system',
              content: 'User approved final merge. Changes merged into working tree.',
              timestamp: Date.now(),
            });
            setViewMode('chat');
          }}
          onReject={() => {
            addMessage({
              id: `reject-${Date.now()}`,
              role: 'system',
              content: 'User rejected final merge. Working tree remains clean.',
              timestamp: Date.now(),
            });
            setViewMode('chat');
          }}
          onBack={() => setViewMode('parallel_dashboard')}
        />
      ) : (
        <Box flexDirection="column">
          <MessageList messages={messages} streamingText={streamingText} toolCalls={toolCalls} />
          <SpinnerTodoPanel
            isRunning={status === 'running'}
            tokenCount={toolCalls.length * 100}
            todos={todos}
          />
          <InputBox
            onSubmit={handleInputSubmit}
            onInterrupt={handleInterrupt}
            onOpenRewindPicker={handleOpenRewindPicker}
            fileCandidates={fileCandidates}
            disabled={status === 'running'}
          />
        </Box>
      )}

      <Footer
        mode={mode}
        liveCost={liveCost}
        contextUsagePercent={contextUsagePercent}
        activeCapabilitiesCount={activeCapabilitiesCount}
      />
    </Box>
  );
};
