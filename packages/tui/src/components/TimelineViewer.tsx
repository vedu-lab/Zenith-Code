import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface TimelineToolCallItem {
  readonly id: string;
  readonly toolName: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly output: unknown;
  readonly isDrift?: boolean | undefined;
}

export interface TimelineTurnItem {
  readonly turnIndex: number;
  readonly userMessage?: string | undefined;
  readonly modelOutput: string;
  readonly toolCalls: readonly TimelineToolCallItem[];
  readonly timestamp?: number | undefined;
}

export interface TimelineViewerProps {
  readonly sessionId: string;
  readonly turns: readonly TimelineTurnItem[];
  readonly onExit?: (() => void) | undefined;
  readonly liveToolsRan?: boolean | undefined;
}

export const TimelineViewer: React.FC<TimelineViewerProps> = ({
  sessionId,
  turns,
  onExit,
  liveToolsRan = false,
}) => {
  const [selectedTurnIndex, setSelectedTurnIndex] = useState(0);
  const [showToolDetails, setShowToolDetails] = useState(false);

  const totalTurns = turns.length;
  const currentTurn = turns[selectedTurnIndex];

  useInput((input, key) => {
    if (key.escape && onExit) {
      onExit();
      return;
    }

    if (key.leftArrow) {
      setSelectedTurnIndex((prev) => Math.max(0, prev - 1));
    } else if (key.rightArrow) {
      setSelectedTurnIndex((prev) => Math.min(totalTurns - 1, prev + 1));
    } else if (input === ' ') {
      setShowToolDetails((prev) => !prev);
    }
  });

  if (totalTurns === 0 || !currentTurn) {
    return (
      <Box borderStyle="round" borderColor="gray" padding={1}>
        <Text color="gray">No turns recorded in session {sessionId}</Text>
      </Box>
    );
  }

  const hasDrift = currentTurn.toolCalls.some((t) => t.isDrift);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          ⏮ REPLAY TIMELINE — Session: {sessionId}
        </Text>
        <Text color="gray">
          Turn {selectedTurnIndex + 1} of {totalTurns}
        </Text>
      </Box>

      {/* Progress Bar / Scrubber */}
      <Box marginBottom={1}>
        <Text color="gray">[</Text>
        {turns.map((turn, idx) => {
          const isCurrent = idx === selectedTurnIndex;
          const turnHasDrift = turn.toolCalls.some((t) => t.isDrift);
          let marker = '─';
          let color = 'gray';

          if (isCurrent) {
            marker = '●';
            color = turnHasDrift ? 'red' : 'cyan';
          } else if (turnHasDrift) {
            marker = '!';
            color = 'yellow';
          }

          return (
            <Text key={turn.turnIndex} color={color} bold={isCurrent}>
              {marker}
            </Text>
          );
        })}
        <Text color="gray">]</Text>
      </Box>

      {/* Turn Content */}
      <Box flexDirection="column" marginBottom={1}>
        {currentTurn.userMessage ? (
          <Box marginBottom={1}>
            <Text bold color="green">
              User:{' '}
            </Text>
            <Text>{currentTurn.userMessage}</Text>
          </Box>
        ) : null}

        <Box marginBottom={1}>
          <Text bold color="magenta">
            Model:{' '}
          </Text>
          <Text>{currentTurn.modelOutput || '(No text delta)'}</Text>
        </Box>

        {/* Tool calls */}
        {currentTurn.toolCalls.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="yellow">
              Tool Calls ({currentTurn.toolCalls.length}):
            </Text>
            {currentTurn.toolCalls.map((tc) => (
              <Box key={tc.id} flexDirection="column" marginLeft={2}>
                <Box>
                  <Text color={tc.isDrift ? 'red' : 'cyan'}>
                    {tc.isDrift ? '⚠ DRIFT: ' : '● '}
                    {tc.toolName}
                  </Text>
                </Box>
                {showToolDetails ? (
                  <Box flexDirection="column" marginLeft={2} marginBottom={1}>
                    <Text color="gray">Params: {JSON.stringify(tc.parameters)}</Text>
                    <Text color="gray">Output: {JSON.stringify(tc.output)}</Text>
                  </Box>
                ) : null}
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>

      {/* Drift banner */}
      {liveToolsRan ? (
        <Box marginBottom={1}>
          {hasDrift ? (
            <Text color="red" bold>
              ⚠ Drift detected between recorded and live tool executions in this turn!
            </Text>
          ) : (
            <Text color="green">✔ Live tools matched recorded execution.</Text>
          )}
        </Box>
      ) : null}

      {/* Footer key hints */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray">
          [◀/▶] Scrub turns | [Space] {showToolDetails ? 'Hide' : 'Show'} tool details | [Esc] Exit
        </Text>
      </Box>
    </Box>
  );
};
